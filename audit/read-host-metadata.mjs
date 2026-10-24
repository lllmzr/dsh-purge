// Read selected package metadata directly from an installed ASAR, without
// extracting, patching, starting or restarting the application.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const archive = process.argv[2];
if (!archive) throw new Error('Usage: node audit/read-host-metadata.mjs <absolute app.asar path>');
if (!path.isAbsolute(archive)) throw new Error('Expected an absolute archive path');
const fd = fs.openSync(archive, 'r');
const packages = [];
try {
  const pre = Buffer.alloc(16);
  if (fs.readSync(fd, pre, 0, 16, 0) !== 16 || pre.readUInt32LE(0) !== 4) throw new Error('Invalid ASAR header');
  const jsonSize = pre.readUInt32LE(12);
  if (jsonSize > 32 * 1024 * 1024) throw new Error('ASAR header too large');
  const bytes = Buffer.alloc(jsonSize);
  if (fs.readSync(fd, bytes, 0, bytes.length, 16) !== bytes.length) throw new Error('Truncated header');
  const header = JSON.parse(bytes.toString('utf8'));
  const baseOffset = 8 + pre.readUInt32LE(4);
  const wanted = [
    'package.json',
    'dsh/package.json',
    'dsh/node_modules/@deepseek-ai/dsh-system-prompt/package.json',
    'dsh/node_modules/@deepseek-ai/dsh-tools/package.json',
  ];
  for (const entry of wanted) {
    let node = header;
    for (const part of entry.split('/')) node = node?.files?.[part];
    if (!node || node.unpacked || !Number.isFinite(node.size) || node.size > 1024 * 1024) continue;
    const contents = Buffer.alloc(node.size);
    if (fs.readSync(fd, contents, 0, contents.length, baseOffset + Number(node.offset)) !== contents.length) throw new Error('Truncated package metadata');
    const pkg = JSON.parse(contents.toString('utf8'));
    packages.push({ entry, name: pkg.name, version: pkg.version, engines: pkg.engines });
  }
} finally {
  fs.closeSync(fd);
}
const output = { archive, mode: 'read-only ASAR metadata; no extraction or host execution', packages };
fs.writeFileSync(fileURLToPath(new URL('installed-host.json', import.meta.url)), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
