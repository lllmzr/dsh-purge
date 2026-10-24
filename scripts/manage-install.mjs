// Reversible profile-local source installation. Does not patch or start a host.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteSync } from '../lib/core.js';
const args = process.argv.slice(2);
const option = (key) => args[args.indexOf(key) + 1];
const home = option('--home');
const profile = args.includes('--profile') ? option('--profile') : 'desktop';
const source = fileURLToPath(new URL('../', import.meta.url));
if (!home || !path.isAbsolute(home) || !['desktop', 'web'].includes(profile)) throw new Error('需要 --home <绝对 DSH_HOME>，profile 只能是 desktop/web');
const dir = path.join(home, 'profiles', profile);
const pkgFile = path.join(dir, 'package.json');
const patchFile = path.join(dir, 'cordis.patch.yml');
const modulePath = path.join(dir, 'node_modules', 'dsh-purge');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
if (pkg.name !== `dsh-profile-${profile}`) throw new Error('profile 身份不匹配');
const version = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version;
const spec = `link:${source.replace(/\\/g, '/').replace(/\/$/, '')}`;
const patch = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, 'utf8') : '';
const hasInsert = /(?:^|\n)\s*-\s+id:\s*['"]?dsh-purge['"]?\s*(?:\r?\n|$)/.test(patch);
const nextPatch = hasInsert ? patch : patch.replace(/^\[\][ \t]*\r?$/m, '').replace(/\s*$/, '') + '\n\n- insert:\n    - id: dsh-purge\n      name: dsh-purge\n      config:\n        autoApplyOnStart: false\n        autoUpdateOnStart: false\n';
pkg.dependencies ||= {}; pkg.dependencies['dsh-purge'] = spec;
pkg.dsh ||= {}; pkg.dsh.profile ||= {}; pkg.dsh.profile.bundles ||= [];
if (!pkg.dsh.profile.bundles.includes('dsh-purge')) pkg.dsh.profile.bundles.push('dsh-purge');
if (!args.includes('--apply')) {
  console.log(JSON.stringify({ mode: 'preview', home, profile, source, modulePath, version, spec }, null, 2));
  process.exit(0);
}
const backup = path.join(home, 'dsh-purge', 'install-backups', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(backup, { recursive: true });
fs.copyFileSync(pkgFile, path.join(backup, 'package.json'));
if (fs.existsSync(patchFile)) fs.copyFileSync(patchFile, path.join(backup, 'cordis.patch.yml'));
let previous = '';
let created = false;
try {
  let existing;
  try { existing = fs.lstatSync(modulePath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (existing && fs.realpathSync(modulePath).toLowerCase() !== fs.realpathSync(source).toLowerCase()) {
    const oldPackage = JSON.parse(fs.readFileSync(path.join(modulePath, 'package.json'), 'utf8'));
    if (oldPackage.name !== 'dsh-purge') throw new Error('同名目录不是此插件，拒绝覆盖');
    previous = `${modulePath}.before-${Date.now()}`;
    fs.renameSync(modulePath, previous);
  }
  if (!fs.existsSync(modulePath)) {
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.symlinkSync(source, modulePath, process.platform === 'win32' ? 'junction' : 'dir');
    created = true;
  }
  atomicWriteSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  atomicWriteSync(patchFile, nextPatch);
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify({ profile, source, previous, created, modulePath, patchExisted: fs.existsSync(path.join(backup, 'cordis.patch.yml')) }, null, 2));
  console.log(JSON.stringify({ ok: true, mode: 'source-link', profile, source, modulePath, version, backup }, null, 2));
} catch (error) {
  fs.copyFileSync(path.join(backup, 'package.json'), pkgFile);
  if (fs.existsSync(path.join(backup, 'cordis.patch.yml'))) fs.copyFileSync(path.join(backup, 'cordis.patch.yml'), patchFile);
  else if (fs.existsSync(patchFile)) fs.unlinkSync(patchFile);
  if (created && fs.existsSync(modulePath)) fs.unlinkSync(modulePath);
  if (previous && fs.existsSync(previous)) fs.renameSync(previous, modulePath);
  throw error;
}
