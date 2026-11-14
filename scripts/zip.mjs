import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const archive = `tabdone-${pkg.version}.zip`;
await rm(archive, { force: true });
execFileSync('zip', ['-qr', `../${archive}`, '.'], { cwd: 'dist', stdio: 'inherit' });
