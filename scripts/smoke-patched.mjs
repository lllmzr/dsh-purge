import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const clean = path.join(root, '.local/host-clean');
const base = path.join(clean, 'dsh/node_modules/@deepseek-ai');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/runtime-verification.json')));
process.env.DSH_HOME = fixture.home; process.env.DSH_BASE = base; process.env.DSH_SURFACE = 'desktop';
const core = await import('../lib/core.js');
const files = [...new Set(Object.values(core.targetFiles(base)).flat().filter(Boolean))];
if (files.some((file) => !file.startsWith(clean + path.sep) && !file.startsWith(fixture.home + path.sep))) throw new Error('Smoke target outside fixtures');
const hash = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before = new Map(files.map((p) => [p, hash(p)]));
let smoke;
try {
  const backup = await core.backupAll(base); if (backup.errors.length) throw new Error(JSON.stringify(backup.errors));
  const report = await core.applyPatches(base);
  if (core.summarizeApplyReport(report).failed.length) throw new Error('Patch apply failed');
  console.log('Starting patched runtime in the disposable profile');
  smoke = spawnSync(process.execPath, ['scripts/smoke-runtime.mjs'], { cwd: root, encoding: 'utf8', env: process.env,
    windowsHide: true, timeout: 55000, maxBuffer: 4 * 1024 * 1024 });
  console.log(smoke.stdout); if (smoke.status !== 0) throw new Error(smoke.stderr || 'Patched smoke failed');
} finally {
  const restored = await core.revertAll(base);
  const mismatches = files.filter((p) => hash(p) !== before.get(p));
  const output = { ok: smoke?.status === 0 && !restored.errors.length && !mismatches.length,
    patchedRuntimeStarted: smoke?.status === 0, restoredFiles: files.length, restoreErrors: restored.errors, restoreMismatch: mismatches };
  fs.writeFileSync(path.join(root, 'artifacts/patched-runtime-verification.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}
