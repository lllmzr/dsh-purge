// Compose the real 0.2.1 runtime with a disposable desktop profile. No model
// request, network exercise, or installed-host write is performed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const home = fs.mkdtempSync(path.join(root, '.local/runtime-check-'));
const profile = path.join(home, 'profiles/desktop'); fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', private: true,
  dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }, null, 2));
fs.writeFileSync(path.join(profile, 'cordis.yml'), '[]\n'); fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), '[]\n');
const base = path.join(root, '.local/host-clean/dsh/node_modules/@deepseek-ai');
const env = { ...process.env, DSH_HOME: home, DSH_BASE: base, DSH_SURFACE: 'web' };
const install = spawnSync(process.execPath, ['scripts/manage-install.mjs', '--home', home, '--profile', 'desktop', '--apply'], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 15000 });
if (install.status !== 0) throw new Error(install.stderr || install.stdout);
const cli = path.join(base, 'dsh/lib/bin.js');
// The official CLI deliberately reserves desktop for Electron. Compose the
// same installed bundle layers through its supported web profile instead.
const web = path.join(home, 'profiles/web'); fs.mkdirSync(web, { recursive: true });
const webPkg = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'))); webPkg.name = 'dsh-profile-web';
fs.writeFileSync(path.join(web, 'package.json'), JSON.stringify(webPkg));
for (const name of ['cordis.yml', 'cordis.patch.yml']) fs.copyFileSync(path.join(profile, name), path.join(web, name));
fs.mkdirSync(path.join(web, 'node_modules'), { recursive: true });
fs.symlinkSync(root, path.join(web, 'node_modules/dsh-purge'), process.platform === 'win32' ? 'junction' : 'dir');
const dump = spawnSync(process.execPath, [cli, '--profile', 'web', '--dump-config'], { cwd: root, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: 30000 });
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts/runtime-config.yml'), dump.stdout || '');
if (dump.status !== 0) throw new Error(dump.stderr || dump.stdout);
const ids = (dump.stdout.match(/\bid: dsh-purge\s*$/gm) || []).length;
if (ids !== 1) throw new Error('dsh-purge body count must be exactly 1, got ' + ids);
process.env.DSH_HOME = home; process.env.DSH_BASE = base; process.env.DSH_SURFACE = 'web';
const { apply } = await import('../lib/redteam/tools.js');
const { RedteamStore } = await import('../lib/redteam/store-core.js');
const store = new RedteamStore(path.join(home, 'redteam'));
const definitions = [];
try {
  apply({ redteam: store, get: (name) => name === 'redteam' ? store : undefined,
    tools: { register: (definition) => { definitions.push(definition); return () => {}; } },
    effect: (fn) => fn(), on: () => () => {} });
} finally { store.close(); }
const report = { hostVersion: '0.2.1-rc.3', compositionSurface: 'web with the same bundles as desktop; no Electron bypass', uniquePluginBody: ids, registeredTools: definitions.length,
  profileInstall: JSON.parse(install.stdout), home, dumpWarnings: dump.stderr };
fs.writeFileSync(path.join(root, 'artifacts/runtime-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ uniquePluginBody: ids, registeredTools: definitions.length, home, warnings: dump.stderr }, null, 2));
