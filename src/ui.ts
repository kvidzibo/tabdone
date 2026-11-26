import { defaults, groupUrl, hostPermission, inGroup, matchesPattern, normalizedText, pageUrl, pathSegments, validateRule, type Rule, type Settings } from './core';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const popup = document.body.classList.contains('popup');
const params = new URLSearchParams(location.search);
let sourceId = Number(params.get('tab')) || undefined;
let sourceUrl = '';
let config: Settings = defaults;
let editingId = '';
let busy = false;
let lastPick = '';
const draftKey = () => `draft-${sourceId ?? 'manager'}`;
async function send(message: object): Promise<any> {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.error) throw new Error(result.error);
  return result;
}
function error(err: unknown) { $('error').textContent = err instanceof Error ? err.message : String(err); }
function clearError() { $('error').textContent = ''; }
async function run(fn: () => Promise<void>) {
  if (busy) return;
  busy = true; clearError();
  try { await fn(); } catch (err) { error(err); } finally { busy = false; }
}
async function access(pattern: string) {
  if (!await chrome.permissions.request({ origins: [hostPermission(pattern)] })) throw new Error('Site access was declined. No rule was enabled.');
}
function card(rule: Rule, onClick: () => void) {
  const button = document.createElement('button'); button.className = 'rule-card';
  const name = document.createElement('strong'); name.textContent = rule.name;
  const detail = document.createElement('small'); detail.textContent = `${rule.enabled ? '' : 'Paused · '}${new URL(rule.pattern).host} · ${rule.text || '(empty text)'}`;
  button.append(name, detail); button.onclick = onClick; return button;
}
async function openEditor(tabId?: number, ruleId?: string) {
  const query = new URLSearchParams(); if (tabId) query.set('tab', String(tabId)); if (ruleId) query.set('rule', ruleId);
  await chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + (query.size ? '?' + query : '') });
  if (popup) window.close();
}
async function renderPopup() {
  const status = await send({ type: 'status' }); config = status.config; input('global-enabled').checked = config.enabled;
  const tab = status.tab as chrome.tabs.Tab | undefined;
  sourceId = tab?.id; sourceUrl = tab?.url || '';
  const rules = config.rules.filter(r => r.enabled && matchesPattern(r.pattern, sourceUrl));
  const ready = Boolean(status.state.pending[sourceId!]) || rules.some(r => Object.entries(status.state.observations).some(([id, value]) => {
    const o = value as { ruleIds: string[]; url: string };
    return o.ruleIds.includes(r.id) && (r.closeRelated ? groupUrl(o.url, r.baseDepth) === groupUrl(sourceUrl, r.baseDepth) : Number(id) === sourceId);
  }));
  const granted = rules.length > 0 && await chrome.permissions.contains({ origins: [hostPermission(rules[0].pattern)] });
  $('page-status').textContent = !config.enabled ? 'Paused — nothing will close' : !rules.length ? 'No matching rule' : !granted ? 'Site access needed — edit the rule' : ready ? '● Done — closes when you leave' : 'Watching for completion';
  const rule = rules[0], base = rule ? groupUrl(sourceUrl, rule.baseDepth) : null;
  const count = base && rule.closeRelated ? status.tabs.filter((t: chrome.tabs.Tab) => t.url && inGroup(t.url, base)).length : rule ? 1 : 0;
  $('count').textContent = count ? `${count} matching tab${count === 1 ? '' : 's'} · pinned tabs stay open` : 'Choose an element that means this page is done.';
  $('popup-rules').replaceChildren(...rules.map(r => card(r, () => { void openEditor(sourceId, r.id); })));
  try { pageUrl(sourceUrl); input('new-rule').disabled = false; } catch { input('new-rule').disabled = true; }
}
function readRule(): Rule {
  return validateRule({ id: editingId || crypto.randomUUID(), name: input('name').value, pattern: input('pattern').value.trim(), selector: input('selector').value.trim(), text: input('text').value, baseDepth: Number(input('scope').value), closeRelated: input('related').checked, enabled: input('rule-enabled').checked });
}
function validateSelector(selector: string) {
  try { document.querySelector(selector); } catch { throw new Error('Invalid CSS selector. Pick another element or edit the selector.'); }
}
function renderScopes(depth: number) {
  const select = $<HTMLSelectElement>('scope');
  let max = Math.max(depth, 1);
  try { max = Math.max(max, pathSegments(sourceUrl).length); } catch { /* No source tab in manager. */ }
  const options = [];
  for (let n = max; n >= 0; n--) {
    const option = document.createElement('option'); option.value = String(n);
    option.textContent = sourceUrl ? groupUrl(sourceUrl, n) || `${n} path segments` : `${n} path segments${n === 0 ? ' — entire site' : ''}`;
    if (n === 0 && sourceUrl) option.textContent += ' — entire site';
    options.push(option);
  }
  select.replaceChildren(...options); select.value = String(depth); preview();
}
function preview() {
  const depth = Number(input('scope').value);
  input('scope').disabled = !input('related').checked;
  $('scope-preview').textContent = input('related').checked ? (sourceUrl ? `${groupUrl(sourceUrl, depth)} + /subpages; query and fragment ignored.` : `Group each matching page by its first ${depth} path segments.`) : 'Only the completed tab will close. Other matching tabs stay open.';
}
function fill(rule?: Rule) {
  editingId = rule?.id || '';
  input('name').value = rule?.name || '';
  input('pattern').value = rule?.pattern || (sourceUrl ? pageUrl(sourceUrl).origin + pageUrl(sourceUrl).pathname : '');
  input('selector').value = rule?.selector || ''; input('text').value = rule?.text || '';
  input('related').checked = rule?.closeRelated ?? true; input('rule-enabled').checked = rule?.enabled ?? true;
  renderScopes(rule?.baseDepth ?? (sourceUrl ? pathSegments(sourceUrl).length : 1));
  $('editor-title').textContent = rule ? rule.name : 'New rule'; $('delete').hidden = !rule;
  $('test-result').textContent = 'Test before enabling automatic closing.'; $('saved').textContent = ''; clearError(); renderRules();
}
function renderRules() {
  const container = $('rule-list');
  container.replaceChildren(...config.rules.map(r => {
    const button = card(r, () => { fill(r); void storeDraft(); }); if (r.id === editingId) button.classList.add('selected'); return button;
  }));
  if (!config.rules.length) { const p = document.createElement('p'); p.className = 'muted small'; p.textContent = 'No rules yet. Start on a website using the toolbar button.'; container.append(p); }
}
async function storeDraft() {
  await chrome.storage.session.set({ [draftKey()]: { editingId, sourceUrl, name: input('name').value, pattern: input('pattern').value, selector: input('selector').value, text: input('text').value, depth: Number(input('scope').value), related: input('related').checked, enabled: input('rule-enabled').checked } });
}
async function receivePick() {
  const status = await send({ type: 'status', tabId: sourceId });
  const picked = status.state.picked;
  if (picked?.tabId === sourceId && JSON.stringify(picked) !== lastPick) {
    lastPick = JSON.stringify(picked);
    input('selector').value = picked.selector; input('text').value = picked.text;
    $('test-result').textContent = 'Element selected. Test this rule, then save.';
    await storeDraft();
  }
}
async function initEditor() {
  const status = await send({ type: 'status', tabId: sourceId }); config = status.config;
  input('global-enabled').checked = config.enabled; input('close-duplicates').checked = config.closeDuplicates;
  if (sourceId && status.tab?.id === sourceId) {
    try { sourceUrl = pageUrl(status.tab.url).href; } catch { sourceId = undefined; }
  } else sourceId = undefined;
  $('source-page').textContent = sourceUrl ? `Source page: ${sourceUrl}` : 'To pick or test, open a website and choose “New rule for this page” in the toolbar popup.';
  input('pick').disabled = !sourceId; input('test').disabled = !sourceId;
  const draft = (await chrome.storage.session.get(draftKey()))[draftKey()] as Record<string, any> | undefined;
  const requested = config.rules.find(r => r.id === params.get('rule'));
  fill(requested);
  if (!requested && draft && draft.sourceUrl === sourceUrl) {
    editingId = draft.editingId;
    for (const key of ['name', 'pattern', 'selector', 'text']) input(key).value = draft[key];
    input('related').checked = draft.related; input('rule-enabled').checked = draft.enabled; renderScopes(draft.depth);
    $('delete').hidden = !editingId; renderRules();
  }
  await receivePick();
  $('rule-form').addEventListener('input', () => { void storeDraft(); });
  $('related').addEventListener('change', preview); $('scope').addEventListener('change', preview);
  $('blank-rule').onclick = () => { fill(); void storeDraft(); if (!sourceId) error('Open a website and use the toolbar’s “New rule for this page” to start.'); };
  $('pick').onclick = () => { void run(async () => {
    // Request from this click, before awaiting other work, to preserve user activation.
    await access(pageUrl(sourceUrl).origin + '/**'); await storeDraft();
    await send({ type: 'pick', tabId: sourceId });
  }); };
  $('test').onclick = () => { void run(async () => {
    const rule = readRule(); validateSelector(rule.selector);
    await access(rule.pattern);
    const result = await send({ type: 'test', tabId: sourceId, rule });
    if (result.error) throw new Error(result.error);
    $('test-result').textContent = `${result.count} visible text match${result.count === 1 ? '' : 'es'} — ${result.matches ? 'completion detected' : 'not done'}${result.dirty ? '; detected edits protect this page' : ''}.`;
  }); };
  $('rule-form').onsubmit = event => { event.preventDefault(); void run(async () => {
    const rule = readRule(); validateSelector(rule.selector);
    if (rule.enabled) await access(rule.pattern);
    const fresh = await send({ type: 'status', tabId: sourceId });
    const rules = [...fresh.config.rules.filter((r: Rule) => r.id !== rule.id), rule];
    await send({ type: 'saveSettings', config: { ...fresh.config, rules } });
    config = { ...fresh.config, rules }; fill(rule);
    await chrome.storage.session.remove(draftKey());
    $('saved').textContent = 'Rule saved. Reload the source page if it was already open and is not being watched.';
  }); };
  $('delete').onclick = () => { void run(async () => {
    if (!confirm('Delete this rule?')) return;
    const fresh = await send({ type: 'status' });
    config = { ...fresh.config, rules: fresh.config.rules.filter((r: Rule) => r.id !== editingId) };
    await send({ type: 'saveSettings', config }); await chrome.storage.session.remove(draftKey()); fill(); $('saved').textContent = 'Rule deleted.';
  }); };
  $('cancel').onclick = () => { void run(async () => {
    await send({ type: 'endPick', tabId: sourceId }); await chrome.storage.session.remove(draftKey());
    fill(config.rules.find(r => r.id === editingId));
  }); };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.state) void receivePick().catch(error);
  });
}
function toggle(id: string, save: (checked: boolean) => Promise<void>) {
  const box = input(id);
  box.onchange = () => {
    // run() ignores clicks during another save; never show an unsaved state.
    if (busy) { box.checked = !box.checked; return; }
    void run(async () => {
      try { await save(box.checked); } catch (err) { box.checked = !box.checked; throw err; }
      if (popup) await renderPopup();
    });
  };
}
toggle('global-enabled', async enabled => {
  const fresh = await send({ type: 'status' });
  await send({ type: 'saveSettings', config: { ...fresh.config, enabled } }); config = { ...fresh.config, enabled };
});
if (!popup) toggle('close-duplicates', async value => {
  await send({ type: 'setCloseDuplicates', value }); config = { ...config, closeDuplicates: value };
});
if (popup) {
  $('new-rule').onclick = () => { void openEditor(sourceId); };
  $('manage').onclick = () => { void openEditor(); };
  void renderPopup().catch(error);
} else void initEditor().catch(error);
