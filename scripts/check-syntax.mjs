import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(?:js|mjs)$/.test(p) ? [p] : [];
  });
}
const files = ['client.js', ...['lib', 'bin', 'scripts'].flatMap(walk)];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (result.status !== 0) { console.error(file, result.stderr || result.error); process.exit(1); }
}
console.log(`Syntax OK: ${files.length} files`);
