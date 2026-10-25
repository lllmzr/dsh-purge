// Offline, reversible installation of a verified host overlay. Never kills or
// restarts processes. Requires the desktop application to be fully closed.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const value = (key) => args.includes(key) ? args[args.indexOf(key) + 1] : '';
const install = value('--install'); const home = value('--home');
if (!path.isAbsolute(install) || !path.isAbsolute(home)) throw new Error('需要 --install 和 --home 的绝对路径');
const root = fileURLToPath(new URL('../', import.meta.url));
const resources = path.join(install, 'resources');
const asar = path.join(resources, 'app.asar');
const app = path.join(resources, 'app');
const exe = path.join(install, 'DeepSeek Harness.exe');
const inside = (base, candidate) => path.resolve(candidate).startsWith(path.resolve(base) + path.sep);
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (!fs.existsSync(exe)) throw new Error('未找到官方桌面 EXE');
const running = execFileSync('powershell.exe', ['-NoProfile', '-Command',
  "@(Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -eq $env:DSH_CHECK_EXE } catch { $false } }).Count"],
  { env: { ...process.env, DSH_CHECK_EXE: exe }, encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
if (Number(running) > 0) throw new Error('请先完全退出此安装的 Harness（包括托盘）；没有停止任何进程');

if (value('--restore')) {
  const manifest = JSON.parse(fs.readFileSync(value('--restore'), 'utf8'));
  if (path.resolve(manifest.install) !== path.resolve(install) || !inside(resources, manifest.originalAsar)
      || !path.basename(manifest.originalAsar).startsWith('app.asar.dshpurge-original-')) throw new Error('还原点不属于指定安装');
  if (digest(manifest.originalAsar) !== manifest.originalSha256) throw new Error('原始归档校验失败');
  if (!args.includes('--apply')) { console.log(JSON.stringify({ mode: 'restore-preview', install, manifest }, null, 2)); process.exit(0); }
  const held = path.join(resources, `app.dshpurge-removed-${randomUUID()}`);
  if (fs.existsSync(asar)) throw new Error('已有 app.asar，拒绝覆盖；请先检查官方更新状态');
  if (fs.existsSync(app)) fs.renameSync(app, held);
  try { fs.renameSync(manifest.originalAsar, asar); }
  catch (error) { if (fs.existsSync(held)) fs.renameSync(held, app); throw error; }
  if (manifest.previousApp && fs.existsSync(manifest.previousApp)) {
    if (!inside(resources, manifest.previousApp)) throw new Error('旧目录越界');
    fs.renameSync(manifest.previousApp, app);
  }
  console.log(JSON.stringify({ ok: true, restored: asar, preservedPatchedTree: held }, null, 2)); process.exit(0);
}

if (!fs.existsSync(asar)) throw new Error('此安装已经解包或缺少原始 app.asar；拒绝重复转换，请先检查现有还原点');
const sha = digest(asar);
if (!args.includes('--apply')) { console.log(JSON.stringify({ mode: 'preview', install, home, originalSha256: sha }, null, 2)); process.exit(0); }
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const stage = path.join(resources, `app.dshpurge-next-${randomUUID()}`);
const originalAsar = path.join(resources, `app.asar.dshpurge-original-${stamp}`);
const previousApp = fs.existsSync(app) ? path.join(resources, `app.dshpurge-prev-${stamp}`) : '';
const backupDir = path.join(home, 'dsh-purge/desktop-backups', stamp);
if (![stage, originalAsar, ...(previousApp ? [previousApp] : [])].every((file) => inside(resources, file))) throw new Error('安装路径越界');
fs.mkdirSync(backupDir, { recursive: true });
process.env.DSH_HOME = path.join(root, '.local/offline-overlay-home');
process.env.DSH_SURFACE = 'desktop'; process.env.DSH_DESKTOP_INSTALL = install;
process.env.DSH_BASE = path.join(stage, 'dsh/node_modules/@deepseek-ai');
const core = await import('../lib/core.js');
const { extractAsar, overlayAsarUnpacked } = await import('../lib/extract-asar.js');
let oldMoved = false; let archiveMoved = false; let activated = false;
try {
  console.log('Preparing staged host; original archive remains active');
  extractAsar(asar, stage); overlayAsarUnpacked(asar, stage);
  const host = JSON.parse(fs.readFileSync(path.join(stage, 'package.json')));
  if (host.name !== '@deepseek-ai/dsh-desktop' || host.version !== '0.2.1-rc.3') throw new Error('宿主版本不在本次验证范围内');
  const targets = [...new Set(Object.values(core.targetFiles(process.env.DSH_BASE)).flat().filter(Boolean))];
  if (targets.some((file) => !inside(stage, file))) throw new Error('补丁目标超出暂存宿主，已停止');
  const backup = await core.backupAll(process.env.DSH_BASE);
  if (backup.errors.length) throw new Error(JSON.stringify(backup.errors));
  const report = await core.applyPatches(process.env.DSH_BASE);
  const summary = core.summarizeApplyReport(report);
  if (summary.failed.length) throw new Error(JSON.stringify(summary.failed));
  for (const file of targets.filter((file) => /\.(?:js|mjs)$/.test(file))) {
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (check.status !== 0) throw new Error(check.stderr || '语法检查失败');
  }
  if (digest(asar) !== sha) throw new Error('准备期间官方归档已变化，拒绝切换');
  if (previousApp) { fs.renameSync(app, previousApp); oldMoved = true; }
  fs.renameSync(asar, originalAsar); archiveMoved = true;
  fs.renameSync(stage, app); activated = true;
  const pluginVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  const manifest = { install, home, version: pluginVersion, hostVersion: host.version, originalAsar,
    originalSha256: sha, previousApp, applied: summary.applied, already: summary.already, targetFiles: targets.length };
  const file = path.join(backupDir, 'manifest.json'); fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, ...manifest, restoreManifest: file, note: '宿主未启动，可正常打开桌面应用' }, null, 2));
} catch (error) {
  if (activated && fs.existsSync(app)) fs.renameSync(app, stage);
  if (archiveMoved && fs.existsSync(originalAsar)) fs.renameSync(originalAsar, asar);
  if (oldMoved && fs.existsSync(previousApp)) fs.renameSync(previousApp, app);
  console.error('安装未完成；原归档及原目录已恢复。暂存数据保留供排查：' + stage);
  throw error;
}
