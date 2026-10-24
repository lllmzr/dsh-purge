import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteSync, findDshHome } from './core.js';

let pending;
export function cancelDefaultReset() { clearTimeout(pending); pending = undefined; }

export function repairSavedDefault(text) {
  return String(text).replace(
    /(^[ \t]*-[ \t]+id:[ \t]*['"]?agent-preset-registry['"]?[^\r\n]*[\s\S]*?)(?=^[ \t]*-[ \t]+(?:id|insert):|(?![\s\S]))/gm,
    (block) => block.replace(/^(\s*selectedDefault:\s*)(['"]?)redteam\2\s*(#.*)?$/gm, '$1standard $3'),
  );
}

export async function resetOwnedDefault({ ctx, home = findDshHome() } = {}) {
  const changed = [];
  const registry = ctx?.get?.('agentPresets') || ctx?.agentPresets;
  const selected = registry?.config?.selectedDefault;
  if (selected?.get?.() === 'redteam') {
    const fallback = registry.config.default && registry.config.default !== 'redteam' ? registry.config.default : 'standard';
    const settings = ctx?.get?.('settings') || ctx?.settings;
    if (typeof settings?.update === 'function') await settings.update('agent-preset-registry', { selectedDefault: fallback });
    else if (typeof selected.set === 'function') await selected.set(fallback);
    changed.push('live');
  }
  let profiles = [];
  try { profiles = fs.readdirSync(path.join(home, 'profiles'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const profile of profiles) for (const name of ['cordis.patch.yml', 'cordis.yml']) {
    const file = path.join(home, 'profiles', profile, name);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const next = repairSavedDefault(text);
    if (next !== text) { atomicWriteSync(file, next); changed.push(file); }
  }
  return changed;
}

export function scheduleDefaultReset(options) {
  cancelDefaultReset();
  pending = setTimeout(() => {
    pending = undefined;
    resetOwnedDefault(options).catch((error) => console.warn('[dsh-purge] reset default:', error.message));
  }, 800);
  pending.unref?.();
}
