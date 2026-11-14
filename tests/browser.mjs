import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
let context;
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
  const { execFileSync } = await import('node:child_process');
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
  // Leaving to a sibling protects that active sibling, closing only the old source.
  await activate(sibling);
  await until(() => source.isClosed(), 'source closes after leaving');
  assert.equal(sibling.isClosed(), false); assert.equal(pinned.isClosed(), false); assert.equal(dirty.isClosed(), false); assert.equal(other.isClosed(), false);
  await activate(other); await until(() => sibling.isClosed(), 'active sibling closes only after leaving');
  assert.equal(pinned.isClosed(), false); assert.equal(dirty.isClosed(), false);
  console.log('Grouping, active sibling, pinned, dirty, URL boundary safeguards passed');

  // Hidden completion indicators must never arm a group.
  const hidden = await open('/owner/repo/pull/119'); await hidden.evaluate(() => { const s=document.querySelector('#status'); s.textContent='Merged'; s.style.display='none'; });
  await sleep(1200); await activate(other); await sleep(500); assert.equal(hidden.isClosed(), false);
  // Rule applies to other PR numbers, and observes a background page immediately.
  await hidden.evaluate(() => document.querySelector('#status').style.display = 'inline-block');
  await until(() => hidden.isClosed(), 'background completion');

  const pausePage = await open('/owner/repo/pull/120');
  await editor.bringToFront(); await editor.locator('#global-enabled').uncheck();
  await until(() => worker.evaluate(async () => !(await chrome.storage.local.get('settings')).settings.enabled), 'pause saved');
  await done(pausePage); await activate(other); await sleep(1200); assert.equal(pausePage.isClosed(), false);
  await editor.locator('#global-enabled').check();
  await until(() => pausePage.isClosed(), 'resume rechecks background completion');
  console.log('Hidden indicators, reusable groups, background completion, pause/resume passed');

  const navigation = await open('/owner/repo/pull/121'); await done(navigation);
  const navigationId = await tabId(navigation);
  await until(async () => (await state()).observations[navigationId], 'ready before navigation');
  await navigation.goto(origin + '/unrelated'); await activate(other); await sleep(1000); assert.equal(navigation.isClosed(), false);
  console.log('Navigation invalidates stale completion');

  // A suspended MV3 worker must restore pending completion from session storage.
  const restart = await open('/owner/repo/pull/122'); await done(restart);
  const restartId = await tabId(restart);
  await until(async () => (await state()).observations[restartId], 'completion saved before worker restart');
  const cdp = await context.newCDPSession(other);
  let versions = [];
  cdp.on('ServiceWorker.workerVersionUpdated', event => { versions = event.versions; });
  await cdp.send('ServiceWorker.enable');
  await until(() => versions.some(v => v.scriptURL === worker.url() && v.runningStatus === 'running'), 'service worker version');
  const versionId = versions.find(v => v.scriptURL === worker.url() && v.runningStatus === 'running').versionId;
  await cdp.send('ServiceWorker.stopWorker', { versionId });
  await other.bringToFront();
  await until(() => restart.isClosed(), 'completion survives worker restart');
  worker = context.serviceWorkers().find(w => w.url() === ext + '/background.js') || await context.waitForEvent('serviceworker');
  await cdp.detach();
  console.log('Service-worker restart preserves completion');

  // Native focus moving away is not a close trigger; another window's selected tab stays protected.
  const multi = await open('/owner/repo/pull/123');
  const multiId = await tabId(multi);
  await worker.evaluate(id => chrome.windows.create({ tabId: id, focused: true }), multiId);
  await done(multi); await until(async () => (await state()).observations[multiId], 'completion in second window');
  await activate(other); await sleep(500); assert.equal(multi.isClosed(), false);
  const second = await worker.evaluate(async id => { const tab=await chrome.tabs.get(id); return chrome.tabs.create({windowId:tab.windowId,url:'about:blank',active:true}); }, multiId);
  await until(() => multi.isClosed(), 'second-window tab closes when its selection changes');
  await worker.evaluate(id => chrome.tabs.remove(id), second.id);
  console.log('Active tabs in unfocused windows remain protected');
  const initial = await open('/owner/repo/pull/initial');
  const initialId = await tabId(initial);
  await until(async () => (await state()).observations[initialId], 'initial completion with delayed page load');
  await activate(other); await until(() => initial.isClosed(), 'initially complete page closes after leaving');

  // Rendered line breaks are whitespace, never concatenated words.
  const textPage = await open('/owner/repo/pull/text');
  await textPage.evaluate(() => { const s=document.querySelector('#status'); s.replaceChildren(document.createTextNode('Merged'), document.createElement('br'), document.createTextNode('now')); });
  const textId = await tabId(textPage);
  const rule = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.rules[0]);
  const inspectText = text => worker.evaluate(async ({ id, rule, text }) => chrome.tabs.sendMessage(id, { type:'inspect', rule:{ ...rule, text } }), { id:textId, rule, text });
  await until(async () => (await inspectText('Merged now')).matches, 'visible line-break matching');
  assert.equal((await inspectText('Mergednow')).matches, false);
  console.log('Initial completion and rendered text boundary regressions passed');
  console.log(`Screenshots: ${shots}`);
} finally {
  await context?.close(); await new Promise(r => server.close(r)); await rm(profile, { recursive: true, force: true });
}
