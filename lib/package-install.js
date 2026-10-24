import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const PACKAGE_FILES = Object.freeze([
  'lib', 'bin', 'docs', 'presets', 'skills', 'scripts', 'client.js',
  'cordis.patch.yml', 'screenshots.json', 'package.json', 'README.md',
  'README.zh-CN.md', 'LICENSE', 'NOTICE', 'release-notes.md',
]);
const REQUIRED = ['lib/index.js', 'bin/dsh-purge.js', 'presets/redteam/preset.yml',
  'skills/redteam', 'scripts/build-client.mjs', 'client.js', 'cordis.patch.yml'];

async function renamePackagePath(from, to) {
  // Windows scanners can retain a just-copied file briefly. Retry the same
  // atomic rename with a bound; never delete the destination to force it.
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(from, to); return; }
    catch (error) {
      if (attempt >= 6 || !['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}

async function validateTree(root) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'dsh-purge' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version || '')) {
    throw new Error('更新包身份或版本不正确');
  }
  for (const relative of REQUIRED) await fs.access(path.join(root, relative));
  return pkg;
}

async function copyEntry(from, to) {
  const stat = await fs.lstat(from);
  if (stat.isSymbolicLink()) throw new Error('更新包不得包含符号链接');
  if (stat.isDirectory()) {
    await fs.mkdir(to, { recursive: true });
    for (const child of await fs.readdir(from)) await copyEntry(path.join(from, child), path.join(to, child));
  } else if (stat.isFile()) {
    await fs.copyFile(from, to);
  } else throw new Error('更新包包含不支持的文件类型');
}

// Stage and validate the entire package before touching the active tree. Both
// renames stay on the destination filesystem; backups survive until reapply.
export async function replacePackageTree(source, destination) {
  const dest = await fs.realpath(destination);
  const old = JSON.parse(await fs.readFile(path.join(dest, 'package.json'), 'utf8'));
  if (old.name !== 'dsh-purge') throw new Error('拒绝覆盖非 dsh-purge 目录');
  try { await fs.access(path.join(dest, '.git')); throw new Error('源码安装请通过 Git 管理，不执行覆盖更新'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await validateTree(source);
  const stage = await fs.mkdtemp(path.join(path.dirname(dest), '.dsh-purge-next-'));
  const backup = path.join(path.dirname(dest), `.dsh-purge-prev-${randomUUID()}`);
  let moved = false;
  try {
    for (const name of PACKAGE_FILES) {
      const from = path.join(source, name);
      try { await fs.lstat(from); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      await copyEntry(from, path.join(stage, name));
    }
    await validateTree(stage);
    await renamePackagePath(dest, backup);
    moved = true;
    await renamePackagePath(stage, dest);
    return { dest, backup };
  } catch (error) {
    if (moved) {
      try { await renamePackagePath(backup, dest); }
      catch (restoreError) { error.message += `；恢复失败，备份保留于 ${backup}: ${restoreError.message}`; }
    }
    throw error;
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

export async function rollbackPackageTree(swap) {
  const failed = `${swap.dest}.failed-${randomUUID()}`;
  await renamePackagePath(swap.dest, failed);
  try { await renamePackagePath(swap.backup, swap.dest); }
  catch (error) { await renamePackagePath(failed, swap.dest).catch(() => {}); throw error; }
  await fs.rm(failed, { recursive: true, force: true });
}

export async function finalizePackageTree(swap) {
  await fs.rm(swap.backup, { recursive: true, force: true });
}
