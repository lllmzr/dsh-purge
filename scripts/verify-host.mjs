// Apply/restore only against a workspace-local copy of the installed host.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const clean = path.join(root, '.local/host-clean');
const run = fs.mkdtempSync(path.join(root, '.local/host-check-'));
const home = path.join(run, 'home');
const install = path.join(run, 'install');
const copy = path.join(install, 'resources/app');
fs.mkdirSync(path.join(copy, 'lib'), { recursive: true });
fs.writeFileSync(path.join(install, 'DeepSeek Harness.exe'), 'inert path-discovery fixture; never executed');
fs.copyFileSync(path.join(clean, 'lib/main.js'), path.join(copy, 'lib/main.js'));
process.env.DSH_DESKTOP_INSTALL = install;
process.env.DSH_HOME = home;
process.env.DSH_SURFACE = 'desktop';
process.env.DSH_BASE = path.join(clean, 'dsh/node_modules/@deepseek-ai');
fs.mkdirSync(home, { recursive: true });
const core = await import('../lib/core.js');
const flatten = (mapping) => [...new Set(Object.values(mapping).flat().filter(Boolean))];
const inside = (base, file) => file === base || file.startsWith(base + path.sep);
const initial = core.targetFiles(process.env.DSH_BASE, home);
for (const file of flatten(initial)) {
  if (!inside(clean, file) && !inside(home, file) && !inside(copy, file)) throw new Error('测试目标越界，未写入：' + file);
  if (!fs.existsSync(file)) continue;
  const to = inside(clean, file) ? path.join(copy, path.relative(clean, file)) : file;
  if (to !== file) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(file, to); }
}
for (const file of ['package.json', 'dsh/package.json']) {
  fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
  fs.copyFileSync(path.join(clean, file), path.join(copy, file));
}
process.env.DSH_BASE = path.join(copy, 'dsh/node_modules/@deepseek-ai');
core.resetPathMemo();
const targets = flatten(core.targetFiles(process.env.DSH_BASE, home));
for (const file of targets) if (!inside(copy, file) && !inside(home, file)) throw new Error('补丁目标越界，未写入：' + file);
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before = new Map(targets.map((file) => [file, hash(file)]));
console.log(`Isolated host copy: ${targets.length} target files`);
const backups = await core.backupAll(process.env.DSH_BASE);
if (backups.errors.length) throw new Error(JSON.stringify(backups.errors));
const applied = await core.applyPatches(process.env.DSH_BASE);
const afterFirst = new Map(targets.map((file) => [file, hash(file)]));
const syntax = [];
for (const file of targets.filter((file) => /\.(?:js|mjs)$/.test(file))) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (check.status !== 0) syntax.push({ file: path.relative(copy, file), error: check.stderr?.slice(0, 3000) });
}
await core.applyPatches(process.env.DSH_BASE);
const nonIdempotent = targets.filter((file) => hash(file) !== afterFirst.get(file)).map((file) => path.relative(copy, file));
const reverted = await core.revertAll(process.env.DSH_BASE);
const restoreMismatch = targets.filter((file) => hash(file) !== before.get(file)).map((file) => path.relative(copy, file));
const report = {
  hostVersion: JSON.parse(fs.readFileSync(path.join(clean, 'package.json'))).version,
  scope: 'workspace copy only; installed application unchanged',
  targets: targets.length,
  patches: applied.map(({ patch_id, name, status, applied, missing }) => ({ id: patch_id, name, status, applied, missing })),
  summary: core.summarizeApplyReport(applied), syntaxFailures: syntax, nonIdempotent,
  restoreErrors: reverted.errors, restoreMismatch,
};
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts/host-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ applied: report.summary.applied, already: report.summary.already,
  failed: report.summary.failed, syntaxFailures: syntax, nonIdempotent, restoreErrors: reverted.errors, restoreMismatch }, null, 2));
if (syntax.length || nonIdempotent.length || reverted.errors.length || restoreMismatch.length) process.exitCode = 1;
