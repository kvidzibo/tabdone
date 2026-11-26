import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

// Run via xvfb-run + dbus-run-session. No real browser profile or desktop access.
const profile = await mkdtemp(join(tmpdir(), 'tabdone-browser-'));
const shots = process.env.TABDONE_SCREENSHOTS || '/tmp/tabdone-screenshots';
await mkdir(shots, { recursive: true });
const server = createServer((_req, res) => {
  if (_req.url === '/slow.png') { setTimeout(() => res.end(), 1500); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><head><title>Example pull request</title><style>body{font:16px system-ui;background:#0d1117;color:#e6edf3;padding:50px}#status{display:inline-block;background:#8957e5;border-radius:20px;padding:8px 18px}textarea{display:block;margin-top:30px;width:400px;height:100px}button{padding:12px}</style></head><body><h1>Example / Pull request #118</h1><span id="status" onclick="window.pageClicks=(window.pageClicks||0)+1">${_req.url.includes('initial') ? 'Merged' : 'Open'}</span>${_req.url.includes('initial') ? '<img src="/slow.png" alt="">' : ''}<p>A representative completion indicator. No account or live site is used.</p><textarea aria-label="Comment" placeholder="Leave a comment"></textarea><button id="action" onclick="window.pageClicks=(window.pageClicks||0)+1">Page action</button></body></html>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const extension = resolve('dist');
let context, away;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn()) return; await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: false,
    viewport: { width: 1160, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check'],
  });
  // Another app's window to switch to: ImageMagick's built-in logo, titled for lookup.
  away = spawn('display', ['-title', 'tabdone-away', '-geometry', '+700+700', 'logo:'], { stdio: 'ignore' });
  let awayWindow;
  await until(() => { try { awayWindow = execFileSync('xdotool', ['search', '--name', 'tabdone-away']).toString().trim().split('\n')[0]; return true; } catch { return false; } }, 'other app window');
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const ext = `chrome-extension://${id}`;
  const source = await context.newPage(); await source.goto(origin + '/owner/repo/pull/118');
  const sourceId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, source.url());
  const editor = await context.newPage(); await editor.goto(`${ext}/options.html?tab=${sourceId}`);
  await editor.locator('#name').fill('Merged PRs');
  await editor.locator('#pattern').fill(origin + '/**/pull/**');
  await editor.locator('#pick').click();
  // Chromium's optional-host permission confirmation is a native browser prompt.
  // Test-only, isolated X display: accept it with Return if shown.
  await sleep(600);
  execFileSync('import', ['-window', 'root', join(shots, 'permission-prompt.png')]);
  execFileSync('xdotool', ['key', 'Shift+Tab', 'Return']);
  await sleep(800);
  console.log('picker-start', await editor.locator('#error').innerText());
  await source.evaluate(() => document.querySelector('#status').textContent = 'Merged');
  await source.locator('#status').click();
  await until(async () => await editor.locator('#selector').inputValue() === '#status', 'picker selection reaches editor');
  assert.equal(await editor.locator('#text').inputValue(), 'Merged');
  assert.equal(await source.evaluate(() => window.pageClicks || 0), 0, 'picker must suppress the page click');
  await editor.locator('#test').click();
  await until(async () => (await editor.locator('#test-result').innerText()).includes('completion detected'), 'live rule test');
  await editor.screenshot({ path: join(shots, 'editor.png'), fullPage: true });
  await editor.setViewportSize({ width: 390, height: 1000 });
  await editor.screenshot({ path: join(shots, 'editor-narrow.png'), fullPage: true });
  assert.equal(await editor.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await editor.setViewportSize({ width: 1160, height: 1000 });
  // Save while the indicator is Open, then prove dynamic detection separately.
  await source.evaluate(() => document.querySelector('#status').textContent = 'Open');
  await editor.getByRole('button', { name: 'Save rule', exact: true }).click();
  await until(async () => (await editor.locator('#saved').innerText()).includes('Rule saved'), 'save rule');
  console.log('Rule setup through UI passed');

  async function open(path) { const p = await context.newPage(); await p.goto(origin + path); return p; }
  async function tabId(page) { return worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url)?.id, page.url()); }
  async function activate(page) { await worker.evaluate(id => chrome.tabs.update(id, { active: true }), await tabId(page)); }
  async function state() { return worker.evaluate(async () => (await chrome.storage.session.get('state')).state); }
  async function done(page) { await page.evaluate(() => document.querySelector('#status').textContent = 'Merged'); }
  const focused = () => worker.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['normal', 'popup', 'panel', 'app', 'devtools'] })).some(w => w.focused));
  const exists = id => worker.evaluate(async id => { try { await chrome.tabs.get(id); return true; } catch { return false; } }, id);
  const mainWindow = await worker.evaluate(async id => (await chrome.tabs.get(id)).windowId, sourceId);
  // Leave the browser for another X window, as when switching apps. Chromium on X11
  // reports no focus event, so fire the periodic check now instead of waiting 30 seconds
  // (unpacked extensions are exempt from the alarm minimum).
  async function leave() {
    execFileSync('xdotool', ['windowfocus', '--sync', awayWindow]);
    await until(async () => !await focused(), 'browser loses focus');
    await worker.evaluate(() => chrome.alarms.create('sweep', { when: Date.now(), periodInMinutes: 0.5 }));
  }
  async function back() {
    await worker.evaluate(id => chrome.windows.update(id, { focused: true }), mainWindow);
    await until(focused, 'browser regains focus');
  }
  // Negative checks: give a triggered sweep time to finish.
  async function awayFor(ms = 1500) { await leave(); await sleep(ms); await back(); }
  const sibling = await open('/owner/repo/pull/118/commits');
  const pinned = await open('/owner/repo/pull/118/changes');
  await worker.evaluate(id => chrome.tabs.update(id, { pinned: true }), await tabId(pinned));
  const dirty = await open('/owner/repo/pull/118?draft=1'); await dirty.locator('textarea').fill('Unsaved comment');
  const other = await open('/owner/repo/pull/1180');
  const popupPage = await context.newPage(); await popupPage.goto(`${ext}/popup.html`);
  await activate(source); await done(source);
  await until(async () => (await state()).observations[sourceId]?.ruleIds.length > 0, 'dynamic completion detection');
  await sleep(300);
  assert.equal(source.isClosed(), false); assert.equal(sibling.isClosed(), false);
  // Screenshot the actual extension popup document without changing the selected tab.
  await popupPage.reload();
  await until(async () => (await popupPage.locator('#page-status').innerText()).includes('Done'), 'popup ready state');
  await popupPage.screenshot({ path: join(shots, 'popup.png'), clip: { x: 0, y: 0, width: 340, height: 460 } });
  await popupPage.close();
  // Switching tabs alone closes nothing.
  await activate(sibling); await sleep(1000);
  assert.equal(source.isClosed(), false, 'tab switches never close tabs');
  // Leaving the browser closes the old source; the selected sibling stays.
  await leave(); await until(() => source.isClosed(), 'source closes after leaving the browser'); await back();
  assert.equal(sibling.isClosed(), false); assert.equal(pinned.isClosed(), false); assert.equal(dirty.isClosed(), false); assert.equal(other.isClosed(), false);
  await activate(other); await leave(); await until(() => sibling.isClosed(), 'queued sibling closes once no longer selected'); await back();
  assert.equal(pinned.isClosed(), false); assert.equal(dirty.isClosed(), false);
  console.log('Focus-loss closing, grouping, selected sibling, pinned, dirty, URL boundary safeguards passed');

  // Hidden completion indicators must never arm a group.
  const hidden = await open('/owner/repo/pull/119'); await hidden.evaluate(() => { const s=document.querySelector('#status'); s.textContent='Merged'; s.style.display='none'; });
  const hiddenId = await tabId(hidden);
  await sleep(1200); await activate(other); await awayFor(); assert.equal(hidden.isClosed(), false);
  // Rule applies to other PR numbers; background completion waits for focus loss.
  await hidden.evaluate(() => document.querySelector('#status').style.display = 'inline-block');
  await until(async () => (await state()).observations[hiddenId], 'background completion detected');
  await sleep(1000); assert.equal(hidden.isClosed(), false, 'background completion waits until you leave');
  await leave(); await until(() => hidden.isClosed(), 'background completion closes after leaving'); await back();

  const pausePage = await open('/owner/repo/pull/120');
  await editor.bringToFront(); await editor.locator('#global-enabled').uncheck();
  await until(() => worker.evaluate(async () => !(await chrome.storage.local.get('settings')).settings.enabled), 'pause saved');
  await done(pausePage); await activate(other); await awayFor(); assert.equal(pausePage.isClosed(), false);
  await editor.locator('#global-enabled').check();
  const pauseId = await tabId(pausePage);
  await until(async () => (await state()).observations[pauseId], 'resume rechecks completion');
  await activate(other); await leave(); await until(() => pausePage.isClosed(), 'resumed completion closes after leaving'); await back();
  console.log('Hidden indicators, reusable groups, background completion, pause/resume passed');

  const navigation = await open('/owner/repo/pull/121'); await done(navigation);
  const navigationId = await tabId(navigation);
  await until(async () => (await state()).observations[navigationId], 'ready before navigation');
  await navigation.goto(origin + '/unrelated'); await activate(other); await awayFor(); assert.equal(navigation.isClosed(), false);
  console.log('Navigation invalidates stale completion');

  // A suspended MV3 worker must restore completion from session storage, and the real
  // 30-second alarm must wake it after the browser loses focus without any focus event.
  const restart = await open('/owner/repo/pull/122'); await done(restart);
  const restartId = await tabId(restart);
  await until(async () => (await state()).observations[restartId], 'completion saved before worker restart');
  await activate(other);
  const cdp = await context.newCDPSession(other);
  let versions = [];
  cdp.on('ServiceWorker.workerVersionUpdated', event => { versions = event.versions; });
  await cdp.send('ServiceWorker.enable');
  await until(() => versions.some(v => v.scriptURL === worker.url() && v.runningStatus === 'running'), 'service worker version');
  const versionId = versions.find(v => v.scriptURL === worker.url() && v.runningStatus === 'running').versionId;
  await cdp.send('ServiceWorker.stopWorker', { versionId });
  execFileSync('xdotool', ['windowfocus', '--sync', awayWindow]);
  await until(() => restart.isClosed(), 'periodic check closes completion after worker restart', 45000);
  worker = context.serviceWorkers().find(w => w.url() === ext + '/background.js') || await context.waitForEvent('serviceworker');
  await cdp.detach(); await back();
  console.log('Service-worker restart and periodic focus check passed');

  // Another window's selected tab stays protected while the browser is unfocused.
  const multi = await open('/owner/repo/pull/123');
  const multiId = await tabId(multi);
  await worker.evaluate(id => chrome.windows.create({ tabId: id, focused: true }), multiId);
  await done(multi); await until(async () => (await state()).observations[multiId], 'completion in second window');
  await activate(other); await awayFor(); assert.equal(multi.isClosed(), false);
  const second = await worker.evaluate(async id => { const tab=await chrome.tabs.get(id); return chrome.tabs.create({windowId:tab.windowId,url:'about:blank',active:true}); }, multiId);
  await leave(); await until(() => multi.isClosed(), 'second-window tab closes once deselected'); await back();
  await worker.evaluate(id => chrome.tabs.remove(id), second.id);
  console.log('Selected tabs in unfocused windows remain protected');
  const initial = await open('/owner/repo/pull/initial');
  const initialId = await tabId(initial);
  await until(async () => (await state()).observations[initialId], 'initial completion with delayed page load');
  await activate(other); await leave(); await until(() => initial.isClosed(), 'initially complete page closes after leaving'); await back();

  // Rendered line breaks are whitespace, never concatenated words.
  const textPage = await open('/owner/repo/pull/text');
  await textPage.evaluate(() => { const s=document.querySelector('#status'); s.replaceChildren(document.createTextNode('Merged'), document.createElement('br'), document.createTextNode('now')); });
  const textId = await tabId(textPage);
  const rule = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.rules[0]);
  const inspectText = text => worker.evaluate(async ({ id, rule, text }) => chrome.tabs.sendMessage(id, { type:'inspect', rule:{ ...rule, text } }), { id:textId, rule, text });
  await until(async () => (await inspectText('Merged now')).matches, 'visible line-break matching');
  assert.equal((await inspectText('Mergednow')).matches, false);
  console.log('Initial completion and rendered text boundary regressions passed');

  // An already-armed pinned source must not sweep tabs opened later.
  const pinnedSource = await open('/owner/repo/pull/124');
  const pinnedSourceId = await tabId(pinnedSource);
  await worker.evaluate(id => chrome.tabs.update(id, { pinned: true }), pinnedSourceId);
  await done(pinnedSource);
  await until(async () => (await state()).observations[pinnedSourceId], 'pinned source completion');
  await activate(other); await leave();
  await until(async () => (await state()).observations[pinnedSourceId]?.armedRuleIds.length > 0, 'one-time group snapshot'); await back();
  const later = await open('/owner/repo/pull/124/new');
  await activate(other); await awayFor();
  assert.equal(later.isClosed(), false, 'new incomplete related tabs are not swept by an old observation');
  console.log('Completed groups queue only their initial tab snapshot');

  // Exact-URL duplicates close only after leaving the browser.
  assert.equal((await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings)).closeDuplicates, true, 'on by default');
  const dupUrl = origin + '/docs/page?x=1#top';
  await activate(other);
  const older = await open('/docs/page?x=1#top');
  const variant = await open('/docs/page?x=2#top');
  const newer = await open('/docs/page?x=1#top');
  await sleep(1000); assert.equal(older.isClosed(), false, 'opening a duplicate closes nothing while you browse');
  await leave(); await until(() => older.isClosed(), 'unselected duplicate closes after leaving'); await back();
  assert.equal(variant.isClosed(), false, 'a different query stays open'); assert.equal(newer.isClosed(), false, 'the selected copy stays open');
  // Without a selected copy, the most recently used one stays.
  const recent = await worker.evaluate(async url => {
    const tabs = await Promise.all([1, 2].map(() => chrome.tabs.create({ url, active: false })));
    return tabs.map(t => t.id);
  }, origin + '/docs/recent');
  await until(async () => (await worker.evaluate(async ids => Promise.all(ids.map(async id => (await chrome.tabs.get(id)).status)), recent)).every(s => s === 'complete'), 'background copies load');
  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), recent[0]);
  await activate(other); await leave();
  await until(async () => !await exists(recent[1]), 'less recently used copy closes'); await back();
  assert.equal(await exists(recent[0]), true, 'most recently used copy stays');
  const newerId = await tabId(newer);
  await activate(newer);
  const background = await worker.evaluate(url => chrome.tabs.create({ url, active: false }), dupUrl);
  await until(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status === 'complete', background.id), 'background duplicate loads');
  await leave(); await until(async () => !await exists(background.id), 'newer background copy of the selected tab closes'); await back();
  assert.equal(newer.isClosed(), false, 'the selected tab stays open');
  await worker.evaluate(id => chrome.tabs.update(id, { pinned: true }), newerId);
  await activate(other); await open('/docs/page?x=1#top');
  await awayFor(); assert.equal(newer.isClosed(), false, 'a pinned tab stays open');
  const inspectTab = id => worker.evaluate(async id => { try { return await chrome.tabs.sendMessage(id, { type: 'inspect' }, { frameId: 0 }); } catch { return undefined; } }, id);
  const edited = await open('/owner/repo/pull/dup');
  const editedId = await tabId(edited);
  await until(async () => await inspectTab(editedId), 'page script on watched page');
  await edited.locator('textarea').fill('Unsaved comment');
  await until(async () => (await inspectTab(editedId))?.dirty, 'edit detected');
  await activate(other); await open('/owner/repo/pull/dup');
  await awayFor(); assert.equal(edited.isClosed(), false, 'an edited watched page stays open');
  const editor2 = await context.newPage(); await editor2.goto(`${ext}/options.html`);
  await until(async () => (await editor2.locator('#rule-list').innerText()).includes('Merged PRs'), 'Manage rules page loads');
  // The second click lands while the first is saving; the checkbox must show the saved state.
  await editor.bringToFront(); await editor.locator('#close-duplicates').evaluate(box => { box.click(); box.click(); });
  await until(() => worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.closeDuplicates === false), 'duplicate setting saved');
  await sleep(300); assert.equal(await editor.locator('#close-duplicates').isChecked(), false);
  await until(async () => !await editor2.locator('#close-duplicates').isChecked(), 'other settings pages sync');
  assert.equal(await editor2.locator('#error').innerText(), '', 'Manage rules page initializes');
  await editor.screenshot({ path: join(shots, 'settings.png'), fullPage: true });
  const keptOld = await open('/docs/off');
  await activate(other); await open('/docs/off');
  await activate(other); await awayFor(); assert.equal(keptOld.isClosed(), false, 'disabled setting keeps duplicates');
  assert.equal(later.isClosed(), false, 'changing the duplicate setting keeps rule state');
  // A stale rule/pause save must not re-enable it.
  assert.deepEqual(await editor2.evaluate(async () => { const { config } = await chrome.runtime.sendMessage({ type: 'status' }); return chrome.runtime.sendMessage({ type: 'saveSettings', config: { ...config, closeDuplicates: true } }); }), { ok: true });
  assert.equal((await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings)).closeDuplicates, false);
  // A keep-duplicates rule, created through the editor, excludes matching pages.
  await editor.bringToFront(); await editor.locator('#blank-rule').click();
  await editor.locator('#rule-type').selectOption('keepDuplicates');
  assert.equal(await editor.locator('#completion-fields').isVisible(), false, 'completion fields hidden');
  await editor.locator('#name').fill('Keep docs'); await editor.locator('#pattern').fill(origin + '/docs/keep/**');
  await editor.getByRole('button', { name: 'Save rule', exact: true }).click();
  await until(async () => (await editor.locator('#saved').innerText()) === 'Rule saved.', 'save keep-duplicates rule');
  assert.equal(await editor.locator('#error').innerText(), '');
  assert.equal(await editor.locator('#rule-list').innerText().then(t => t.includes('Keeps duplicates open')), true);
  await editor.screenshot({ path: join(shots, 'editor-keep.png'), fullPage: true });
  const keepA = await open('/docs/keep/a'); await activate(other); const keepB = await open('/docs/keep/a');
  await activate(other); await awayFor();
  assert.equal(keepA.isClosed(), false, 'excluded duplicates stay open'); assert.equal(keepB.isClosed(), false);
  console.log('Duplicate sweep, protections, keep-duplicates rule, and setting passed');
  console.log(`Screenshots: ${shots}`);
} finally {
  away?.kill(); await context?.close(); await new Promise(r => server.close(r)); await rm(profile, { recursive: true, force: true });
}
