import { defaults, groupUrl, hostPermission, inGroup, matchesPattern, pageUrl, validateRule, type Rule, type Settings } from './core';

type Observation = { url: string; ruleIds: string[]; armedRuleIds: string[]; documentId: string };
type Pending = { url: string; ruleId: string; sourceId: number; base: string };
type Session = { observations: Record<string, Observation>; pending: Record<string, Pending>; picking: Record<string, boolean>; picked?: { tabId: number; url: string; selector: string; text: string } };
const emptySession = (): Session => ({ observations: {}, pending: {}, picking: {} });
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(console.error);
  return next;
}
async function settings(): Promise<Settings> {
  const value = (await chrome.storage.local.get('settings')).settings as Settings | undefined;
  if (!value) return defaults;
  try { return { enabled: value.enabled === true, closeDuplicates: value.closeDuplicates !== false, rules: value.rules.map(validateRule) }; }
  catch { return { enabled: false, closeDuplicates: false, rules: [] }; }
}
async function session(): Promise<Session> {
  return (await chrome.storage.session.get('state')).state as Session || emptySession();
}
async function save(state: Session) { await chrome.storage.session.set({ state }); }
async function getTab(id: number) { try { return await chrome.tabs.get(id); } catch { return undefined; } }
async function allowed(rule: Rule) { return chrome.permissions.contains({ origins: [hostPermission(rule.pattern)] }); }
async function inject(tabId: number) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}
async function inspect(tabId: number, rule: Rule, url: string, documentId?: string, preview = false) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'inspect', rule, expectedUrl: url, preview },
      documentId ? { documentId } : { frameId: 0 }) as { url: string; dirty: boolean; matches: boolean; count: number; error?: string };
  } catch { return undefined; }
}

async function syncScripts() {
  const config = await settings();
  const origins: string[] = [];
  for (const rule of config.rules) if (config.enabled && rule.enabled && await allowed(rule)) origins.push(hostPermission(rule.pattern));
  await chrome.scripting.unregisterContentScripts();
  if (origins.length) {
    await chrome.scripting.registerContentScripts([{ id: 'tabdone-watch', matches: [...new Set(origins)], js: ['content.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true }]);
    for (const tab of await chrome.tabs.query({})) {
      if (tab.id && tab.url && config.rules.some(r => origins.includes(hostPermission(r.pattern)) && new URL(r.pattern.replace(/\*/g, '')).origin === new URL(tab.url!).origin)) {
        try { await inject(tab.id); } catch { /* Restricted or discarded page: leave open. */ }
      }
    }
  }
}

async function arm(state: Session, config: Settings) {
  const tabs = await chrome.tabs.query({});
  for (const [key, observation] of Object.entries(state.observations)) {
    const sourceId = Number(key);
    const source = tabs.find(t => t.id === sourceId);
    if (!source || source.url !== observation.url || source.pendingUrl || source.status === 'loading') {
      delete state.observations[key];
      continue;
    }
    // Active tabs in ANY window stay open; switching apps never triggers closure.
    if (source.active || state.picking[key]) continue;
    for (const ruleId of observation.ruleIds) {
      if (observation.armedRuleIds.includes(ruleId)) continue;
      const rule = config.rules.find(r => r.id === ruleId && r.enabled);
      if (!rule || !matchesPattern(rule.pattern, source.url!) || !await allowed(rule)) continue;
      const proof = await inspect(sourceId, rule, observation.url, observation.documentId);
      if (!proof || proof.error || proof.url !== observation.url || !proof.matches || proof.dirty) continue;
      const base = groupUrl(source.url!, rule.baseDepth);
      if (!base) continue;
      for (const tab of tabs) {
        if (!tab.id || !tab.url || tab.pinned || tab.pendingUrl || tab.status === 'loading' || state.picking[tab.id]) continue;
        if (rule.closeRelated ? inGroup(tab.url, base) : tab.id === sourceId) {
          state.pending[tab.id] = { url: tab.url, ruleId, sourceId, base };
        }
      }
      observation.armedRuleIds.push(ruleId);
    }
  }
}
async function closePending(state: Session, config: Settings) {
  for (const [key, pending] of Object.entries(state.pending)) {
    const id = Number(key);
    const rule = config.rules.find(r => r.id === pending.ruleId && r.enabled);
    let tab = await getTab(id);
    if (!rule || !tab || tab.url !== pending.url || tab.pendingUrl || tab.status === 'loading' || !inGroup(tab.url, pending.base) || !await allowed(rule)) {
      delete state.pending[key];
      continue;
    }
    if (tab.active || tab.pinned || state.picking[key]) continue;
    // An unresponsive/discarded page or unknown edit state must never be closed.
    const result = await inspect(id, rule, pending.url);
    if (!result || result.error || result.url !== pending.url || result.dirty) continue;
    tab = await getTab(id);
    const latest = await settings();
    if (!latest.enabled || !latest.rules.some(r => JSON.stringify(r) === JSON.stringify(rule)) || !await allowed(rule)) continue;
    if (!tab || tab.active || tab.pinned || tab.pendingUrl || tab.status === 'loading' || tab.url !== pending.url) continue;
    try { await chrome.tabs.remove(id); delete state.pending[key]; delete state.observations[key]; }
    catch { /* The tab may already have closed. */ }
  }
}
// Edits are detectable only where TabDone's page script already runs.
async function edited(tabId: number, url: string) {
  try { return (await chrome.tabs.sendMessage(tabId, { type: 'inspect', expectedUrl: url }, { frameId: 0 }))?.dirty === true; }
  catch { return false; }
}
// URL commit order, recorded as events arrive: queued handlers can run after later commits.
const commits = new Map<number, number>();
let commitCount = 0;
// A tab that just committed a URL replaces older tabs showing exactly that URL.
async function closeDuplicates(id: number, url: string, order: number) {
  const config = await settings();
  const tab = await getTab(id);
  if (!config.enabled || !config.closeDuplicates || !tab || tab.url !== url || tab.pendingUrl) return;
  try { pageUrl(url); } catch { return; }
  const state = await session();
  const duplicate = (t?: chrome.tabs.Tab) => Boolean(t?.id && t.id !== id && t.url === url && t.incognito === tab.incognito &&
    (commits.get(t.id) ?? 0) < order && !t.active && !t.pinned && !t.pendingUrl && !state.picking[t.id]);
  for (const candidate of await chrome.tabs.query({})) {
    if (!duplicate(candidate) || await edited(candidate.id!, url)) continue;
    const source = await getTab(id);
    if (!source || source.url !== url || source.pendingUrl || !duplicate(await getTab(candidate.id!))) continue;
    try { await chrome.tabs.remove(candidate.id!); } catch { /* Already closed. */ }
  }
}
async function badges(state: Session, config: Settings) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    let text = '', color = '#64748b', title = 'TabDone — no matching rule';
    if (!config.enabled) { text = 'Ⅱ'; title = 'TabDone — paused'; }
    else if (tab.url) {
      const rule = config.rules.find(r => r.enabled && matchesPattern(r.pattern, tab.url!));
      if (rule && await allowed(rule)) {
        const base = groupUrl(tab.url, rule.baseDepth);
        if (base) {
          const count = rule.closeRelated ? tabs.filter(t => t.url && inGroup(t.url, base)).length : 1;
          const ready = Boolean(state.pending[tab.id]) || Object.entries(state.observations).some(([id, o]) => o.ruleIds.includes(rule.id) && (rule.closeRelated ? groupUrl(o.url, rule.baseDepth) === base : Number(id) === tab.id));
          text = String(count); color = ready ? '#8957e5' : '#64748b';
          title = `TabDone — ${count} matching tab${count === 1 ? '' : 's'} · ${ready ? 'done' : 'watching'} · pinned tabs stay open`;
        }
      }
    }
    try {
      await chrome.action.setBadgeText({ tabId: tab.id, text });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color });
      await chrome.action.setTitle({ tabId: tab.id, title });
    } catch { /* Tab closed during update. */ }
  }
}
async function reconcile() {
  const config = await settings();
  const state = await session();
  if (config.enabled) { await arm(state, config); await closePending(state, config); }
  else { state.observations = {}; state.pending = {}; }
  await save(state);
  await badges(state, config);
}
function trustedUI(sender: chrome.runtime.MessageSender) {
  return sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
}
async function message(msg: any, sender: chrome.runtime.MessageSender) {
  const state = await session();
  if (!trustedUI(sender) && sender.tab?.id && sender.frameId === 0 && sender.id === chrome.runtime.id) {
    const id = sender.tab.id;
    const tab = await getTab(id);
    if (!tab || tab.url !== msg.url || tab.pendingUrl || tab.status === 'loading') return { ok: false };
    if (msg.type === 'observe') {
      const config = await settings();
      const ids: string[] = [];
      if (config.enabled && !msg.dirty && !state.picking[id] && Array.isArray(msg.readyRuleIds)) {
        for (const rule of config.rules) if (rule.enabled && msg.readyRuleIds.includes(rule.id) && matchesPattern(rule.pattern, msg.url) && await allowed(rule)) ids.push(rule.id);
      }
      const previous = state.observations[id];
      if (ids.length && sender.documentId) {
        const armedRuleIds = previous?.url === msg.url && previous.documentId === sender.documentId
          ? previous.armedRuleIds.filter(ruleId => ids.includes(ruleId)) : [];
        state.observations[id] = { url: msg.url, ruleIds: ids, armedRuleIds, documentId: sender.documentId };
      } else delete state.observations[id];
      for (const [key, p] of Object.entries(state.pending)) if (p.sourceId === id && !ids.includes(p.ruleId)) delete state.pending[key];
      await save(state); await reconcile();
      return { ok: true };
    }
    if (msg.type === 'picked' && state.picking[id] && typeof msg.selector === 'string' && typeof msg.text === 'string' && msg.selector.length <= 2000 && msg.text.length <= 2000) {
      state.picked = { tabId: id, url: msg.url, selector: msg.selector, text: msg.text };
      // Keep this tab protected until the editor saves/cancels the pick.
      await save(state);
      const editorUrl = chrome.runtime.getURL(`options.html?tab=${id}`);
      const editors = await chrome.tabs.query({ url: chrome.runtime.getURL('options.html') + '*' });
      const editor = editors.find(t => t.url === editorUrl);
      if (editor?.id) await chrome.tabs.update(editor.id, { active: true });
      else await chrome.tabs.create({ url: editorUrl });
      return { ok: true };
    }
    if (msg.type === 'pickCancelled') { delete state.picking[id]; await save(state); return { ok: true }; }
    return { ok: false };
  }
  if (!trustedUI(sender)) throw new Error('Extension page required.');
  if (msg.type === 'status') {
    const tab = msg.tabId ? await getTab(msg.tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    return { config: await settings(), state, tab, tabs: await chrome.tabs.query({}) };
  }
  if (msg.type === 'saveSettings') {
    const config: Settings = { enabled: msg.config.enabled === true, closeDuplicates: msg.config.closeDuplicates !== false, rules: msg.config.rules.map(validateRule) };
    if (config.rules.length > 100 || new Set(config.rules.map(r => r.id)).size !== config.rules.length) throw new Error('Use at most 100 rules with unique IDs.');
    for (const rule of config.rules) if (config.enabled && rule.enabled && !await allowed(rule)) throw new Error('Grant site access before enabling this rule.');
    await chrome.storage.local.set({ settings: config });
    for (const id of Object.keys(state.picking)) {
      try { await chrome.tabs.sendMessage(Number(id), { type: 'endPick' }, { frameId: 0 }); } catch { /* Closed tab. */ }
    }
    await save(emptySession()); await syncScripts(); await reconcile();
    return { ok: true };
  }
  if (msg.type === 'setCloseDuplicates') {
    // Change only this preference; rule state and site-access checks stay untouched.
    const stored = (await chrome.storage.local.get('settings')).settings ?? defaults;
    await chrome.storage.local.set({ settings: { ...stored, closeDuplicates: msg.value === true } });
    return { ok: true };
  }
  if (msg.type === 'pick' || msg.type === 'test') {
    const tab = await getTab(msg.tabId);
    if (!tab?.id || !tab.url) throw new Error('Open a normal website tab first.');
    if (msg.type === 'test') {
      const rule = validateRule(msg.rule);
      if (!matchesPattern(rule.pattern, tab.url)) throw new Error('This page does not match the URL pattern.');
      await inject(tab.id);
      const result = await inspect(tab.id, rule, tab.url, undefined, true);
      if (!result) throw new Error('Reload the page and try again.');
      return result;
    }
    state.picking[tab.id] = true; delete state.observations[tab.id]; delete state.pending[tab.id]; delete state.picked;
    await save(state);
    try {
      await inject(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type: 'pick' }, { frameId: 0 });
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
    } catch (error) { delete state.picking[tab.id]; await save(state); throw error; }
    return { ok: true };
  }
  if (msg.type === 'endPick') {
    delete state.picking[msg.tabId]; delete state.picked;
    try { await chrome.tabs.sendMessage(msg.tabId, { type: 'endPick' }, { frameId: 0 }); } catch { /* Closed tab. */ }
    await save(state); return { ok: true };
  }
  throw new Error('Unknown request.');
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  serial(() => message(msg, sender)).then(respond, error => respond({ error: String(error.message || error) }));
  return true;
});
chrome.runtime.onInstalled.addListener(() => { void serial(async () => { await syncScripts(); await reconcile(); }); });
chrome.runtime.onStartup.addListener(() => { void serial(async () => { await save(emptySession()); await syncScripts(); await reconcile(); }); });
chrome.tabs.onActivated.addListener(() => { void serial(reconcile); });
chrome.tabs.onCreated.addListener(() => { void serial(async () => badges(await session(), await settings())); });
chrome.tabs.onUpdated.addListener((id, change) => {
  let order = 0;
  if (change.url) commits.set(id, order = ++commitCount);
  void serial(async () => {
    if (change.url || change.status === 'loading') {
      const state = await session(); delete state.observations[id]; delete state.pending[id]; delete state.picking[id];
      for (const [key, p] of Object.entries(state.pending)) if (p.sourceId === id) delete state.pending[key];
      await save(state);
    }
    if (change.url) await closeDuplicates(id, change.url, order);
    if (change.status === 'complete') {
      // document_idle can run before slow subresources finish. Reannounce after
      // the loading guard lifts, even if the DOM's completion state is unchanged.
      const config = await settings();
      const tab = await getTab(id);
      if (config.enabled && tab?.url) {
        for (const rule of config.rules) {
          if (rule.enabled && matchesPattern(rule.pattern, tab.url) && await allowed(rule)) {
            try { await inject(id); } catch { /* Restricted/discarded page: leave open. */ }
            break;
          }
        }
      }
    }
    if (change.status === 'complete' || change.url || change.pinned !== undefined) await reconcile();
  });
});
chrome.tabs.onRemoved.addListener(id => {
  commits.delete(id);
  void serial(async () => { const state = await session(); delete state.observations[id]; delete state.pending[id]; delete state.picking[id]; await save(state); await reconcile(); });
});
chrome.permissions.onRemoved.addListener(() => {
  void serial(async () => { await save(emptySession()); await syncScripts(); await reconcile(); });
});
