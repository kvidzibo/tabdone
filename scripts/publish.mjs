import { readFile, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

try {
  const required = name => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const token = required('CWS_ACCESS_TOKEN');
  const publisher = encodeURIComponent(required('CWS_PUBLISHER_ID'));
  const extension = encodeURIComponent(required('CWS_EXTENSION_ID'));
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version) || required('GITHUB_REF') !== `refs/tags/v${version}`) {
    throw new Error('Release tag must match a stable package version');
  }
  const zip = `tabdone-${version}.zip`;
  const manifest = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' }));
  if (manifest.version !== version) throw new Error('ZIP manifest version must match release tag');

  const name = `publishers/${publisher}/items/${extension}`;
  const root = 'https://chromewebstore.googleapis.com';
  const request = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Chrome Web Store HTTP ${response.status}; check the developer dashboard before retrying`);
    return response.json();
  };
  const uploaded = await request(`${root}/upload/v2/${name}:upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: await readFile(zip),
  });
  let state = uploaded.uploadState;
  for (let attempt = 0; state === 'IN_PROGRESS' && attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5_000));
    state = (await request(`${root}/v2/${name}:fetchStatus`)).lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Error(`Upload did not succeed: ${state}`);
  if (uploaded.crxVersion && uploaded.crxVersion !== version) throw new Error('Uploaded version does not match release tag');

  const result = await request(`${root}/v2/${name}:publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true }),
  });
  if (!['PENDING_REVIEW', 'PUBLISHED', 'PUBLISHED_TO_TESTERS'].includes(result.state)) {
    throw new Error(`Unexpected submission state: ${result.state}; check the developer dashboard`);
  }
  const message = `TabDone ${version}: ${result.state}. Submission accepted; store approval and availability are separate.`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
