import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('publisher submits only a matching ZIP after successful upload and fails closed', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tabdone-publish-test-'));
  try {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    writeFileSync(join(cwd, 'manifest.json'), JSON.stringify({ version: '1.2.3', manifest_version: 3 }));
    execFileSync('zip', ['-q', 'tabdone-1.2.3.zip', 'manifest.json'], { cwd });
    const cases = [
      { replies: [{ uploadState: 'SUCCEEDED', crxVersion: '1.2.3' }, { state: 'PENDING_REVIEW' }], calls: 2, ok: true },
      { replies: [{ uploadState: 'IN_PROGRESS' }, { lastAsyncUploadState: 'IN_PROGRESS' }, { lastAsyncUploadState: 'SUCCEEDED' }, { state: 'PUBLISHED' }], calls: 4, ok: true },
      { replies: [{ uploadState: 'FAILED' }], calls: 1, ok: false },
      { replies: [{ uploadState: 'IN_PROGRESS' }, { lastAsyncUploadState: 'NOT_FOUND' }], calls: 2, ok: false },
      { replies: [{ uploadState: 'IN_PROGRESS' }, ...Array(30).fill({ lastAsyncUploadState: 'IN_PROGRESS' })], calls: 31, ok: false },
      { replies: [{ uploadState: 'SUCCEEDED', crxVersion: '1.2.2' }], calls: 1, ok: false },
      { replies: [{ status: 403 }], calls: 1, ok: false },
      { replies: [{ uploadState: 'SUCCEEDED' }, { status: 400 }], calls: 2, ok: false },
      { replies: [{ uploadState: 'SUCCEEDED' }, { state: 'REJECTED' }], calls: 2, ok: false },
      { replies: [], calls: 0, ok: false, ref: 'refs/tags/v9.9.9' },
      { replies: [], calls: 0, ok: false, token: '' },
      { replies: [], calls: 0, ok: false, badZip: true },
    ];
    for (const scenario of cases) {
      if (scenario.badZip) {
        writeFileSync(join(cwd, 'manifest.json'), JSON.stringify({ version: '1.2.2' }));
        execFileSync('zip', ['-q', 'tabdone-1.2.3.zip', 'manifest.json'], { cwd });
      }
      // Intercept every request in the real CLI process; no credentials or network.
      const preload = `
        import assert from 'node:assert/strict';
        const replies = ${JSON.stringify(scenario.replies)};
        let calls = 0;
        globalThis.setTimeout = fn => { queueMicrotask(fn); return 0; };
        globalThis.fetch = async (url, options) => {
          calls++;
          assert.equal(options.headers.Authorization, 'Bearer test-secret');
          assert.equal(options.redirect, 'error');
          assert.ok(options.signal instanceof AbortSignal);
          const base = 'https://chromewebstore.googleapis.com';
          const name = 'publishers/test-publisher/items/test-extension';
          if (calls === 1) {
            assert.equal(url, base + '/upload/v2/' + name + ':upload');
            assert.equal(options.method, 'POST');
            assert.equal(options.headers['Content-Type'], 'application/zip');
            assert.equal(options.body.subarray(0, 2).toString(), 'PK');
          } else if (url.endsWith(':publish')) {
            assert.equal(url, base + '/v2/' + name + ':publish');
            assert.equal(options.method, 'POST');
            assert.deepEqual(JSON.parse(options.body), { publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true });
          } else {
            assert.equal(url, base + '/v2/' + name + ':fetchStatus');
            assert.equal(options.method, undefined);
          }
          assert.ok(replies.length, 'Unexpected request');
          const reply = replies.shift();
          return Response.json(reply, { status: reply.status || 200 });
        };
        process.on('exit', () => console.log('calls=' + calls));
      `;
      const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, resolve('scripts/publish.mjs')], {
        cwd,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          PATH: process.env.PATH,
          CWS_ACCESS_TOKEN: scenario.token ?? 'test-secret',
          CWS_PUBLISHER_ID: 'test-publisher',
          CWS_EXTENSION_ID: 'test-extension',
          GITHUB_REF: scenario.ref ?? 'refs/tags/v1.2.3',
        },
      });
      assert.equal(result.status, scenario.ok ? 0 : 1, result.stderr);
      assert.match(result.stdout, new RegExp(`calls=${scenario.calls}\\n$`));
      assert.doesNotMatch(result.stdout + result.stderr, /test-secret|AssertionError/);
      if (scenario.ok) assert.match(result.stdout, /Submission accepted/);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
