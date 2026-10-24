import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureRoot = path.join(root, '.local/regression');
fs.mkdirSync(fixtureRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(fixtureRoot, 'run-'));
process.env.DSH_HOME = path.join(temp, 'home');
process.env.DSH_SURFACE = 'web';
const hostBase = path.join(root, '.local/host-clean/dsh/node_modules/@deepseek-ai');
if (fs.existsSync(hostBase)) process.env.DSH_BASE = hostBase;
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });
const core = await import('../lib/core.js');
const { hostFs } = await import('../lib/extract-asar.js');
const uninstall = await import('../lib/uninstall.js');
const updater = await import('../lib/update.js');
const net = await import('../lib/net-scope.js');
const { checkPluginRequest, READ_ONLY_RULE_OPS } = await import('../lib/http-policy.js');
const { replacePackageTree, rollbackPackageTree, finalizePackageTree } = await import('../lib/package-install.js');
const { repairSavedDefault, resetOwnedDefault } = await import('../lib/preset-default.js');
const { explicitObjectSchemas } = await import('../lib/schema-compat.js');
const { compatiblePresetDefinitions, leafDenial, apply: applyLeaf } = await import('../lib/redteam/leaf-policy.js');
const { readPresetDefinition } = await import('../lib/redteam/preset-composition.js');
const { extractZipBuffer } = await import('../lib/zip-extract.js');

test.after(() => { fs.rmSync(temp, { recursive: true, force: true }); });
const request = (extra = {}) => ({ method: 'POST', socket: { remoteAddress: '127.0.0.1' },
  headers: { host: '127.0.0.1:7777', 'content-type': 'application/json', ...extra } });

test('HTTP bridges reject foreign/null browser origins, simple-form POST and scheme mismatch', () => {
  for (const headers of [
    { origin: 'https://untrusted.invalid' },
    { origin: 'null', 'sec-fetch-site': 'cross-site' },
    { origin: 'null', 'sec-fetch-site': 'same-site' },
    { origin: 'https://127.0.0.1:7777' },
    { 'content-type': 'text/plain' },
    { 'content-type': 'application/x-www-form-urlencoded' },
    { host: 'rebound.invalid:7777' },
  ]) assert.equal(checkPluginRequest(request(headers)).ok, false, JSON.stringify(headers));
});
test('HTTP bridges support genuine same-origin JSON and native desktop JSON', () => {
  for (const headers of [
    { origin: 'http://127.0.0.1:7777' },
    { origin: 'app://dsh', 'sec-fetch-site': 'none' },
    { origin: 'null', 'sec-fetch-site': 'none' },
    {},
  ]) assert.equal(checkPluginRequest(request(headers)).ok, true, JSON.stringify(headers));
});

test('uninstall removes nested and legacy entries, preserves unrelated bundles', () => {
  const pkg = { dependencies: { 'dsh-purge': 'link:source', base: '1' }, bundles: ['dsh-purge', 'base'],
    dsh: { profile: { bundles: ['base', 'dsh-purge', { name: 'dsh-purge' }], plugins: ['dsh-purge'] } } };
  assert(uninstall.stripPluginFromPackage(pkg));
  assert.deepEqual(pkg.dsh.profile, { bundles: ['base'], plugins: [] });
  assert.deepEqual(pkg.dependencies, { base: '1' });
  assert.deepEqual(pkg.bundles, ['base']);
  assert.equal(uninstall.stripPluginFromPackage(pkg), false);
  const profile = path.join(process.env.DSH_HOME, 'profiles', 'desktop');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-purge'] } } }));
  assert.equal(uninstall.listInstalledProfiles(process.env.DSH_HOME).length, 1);
});

test('preset default reset affects only owned preset and keeps user presets', async () => {
  const source = '- id: other\n  config:\n    selectedDefault: redteam\n- id: agent-preset-registry\n  config:\n    selectedDefault: redteam\n- id: keep\n  config:\n    selectedDefault: other\n';
  const fixed = repairSavedDefault(source);
  assert.match(fixed, /id: other\n  config:\n    selectedDefault: redteam/);
  assert.match(fixed, /id: agent-preset-registry\n  config:\n    selectedDefault: standard/);
  assert.match(fixed, /selectedDefault: other/);
  let live = 'redteam';
  await resetOwnedDefault({ home: process.env.DSH_HOME, ctx: { get: (name) => name === 'agentPresets'
    ? { config: { default: 'standard', selectedDefault: { get: () => live, set: (v) => { live = v; } } } } : undefined } });
  assert.equal(live, 'standard');
});

test('fd routing reads and closes descriptors; text launchers are not binary', async () => {
  const dir = path.join(temp, 'shim'); fs.mkdirSync(dir);
  const file = path.join(dir, 'dsh.ps1'); fs.writeFileSync(file, '# inert launcher\n');
  const fd = hostFs.openSync(file, 'r'); const buffer = Buffer.alloc(6);
  assert.equal(hostFs.readSync(fd, buffer, 0, 6, 0), 6);
  assert.equal(buffer.toString(), '# iner'); hostFs.closeSync(fd);
  assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' });
  const result = await core.patchShim(dir);
  assert.equal(result['dsh.ps1'], 'patched');
  await core.revertShim(dir, { scrubDesktop: false });
  assert.equal(fs.readFileSync(file, 'utf8'), '# inert launcher\n');
});

test('concurrent same-millisecond atomic writes have unique temporary files', async () => {
  const file = path.join(temp, 'atomic.json'); const originalNow = Date.now;
  try {
    Date.now = () => 123456789;
    const results = await Promise.allSettled([core.atomicWriteFile(file, '{"value":1}'), core.atomicWriteFile(file, '{"value":2}')]);
    assert(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results));
  } finally { Date.now = originalNow; }
  assert([1, 2].includes(JSON.parse(fs.readFileSync(file, 'utf8')).value));
});

test('local archives are package installations, directories remain link installations', () => {
  for (const spec of ['file:./package.tgz', 'file:D:/build/package.tar.gz', 'file:../package.zip']) assert.equal(updater.isLinkSpec(spec), false);
  for (const spec of ['link:../source', 'file:../source', '.']) assert.equal(updater.isLinkSpec(spec), true);
  assert.equal(updater.REPO, 'lllmzr/dsh-purge');
});

test('local lab addresses exclude public, metadata, multicast and mapped public IPv6', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '::1', '::ffff:192.168.1.1']) assert(net.isLocalLabAddress(ip), ip);
  for (const ip of ['203.0.113.7', '169.254.169.254', '224.0.0.1', '0.0.0.0', '172.32.0.1', '::ffff:203.0.113.7']) assert(!net.isLocalLabAddress(ip), ip);
  const lookup = (ips) => async () => ips.map((address) => ({ address }));
  assert(await net.isLocalLabTarget('fixture.lab', lookup(['10.0.0.1', '::1'])));
  assert.equal(await net.isLocalLabTarget('fixture.lab', lookup(['10.0.0.1', '203.0.113.7'])), false);
  assert.equal(await net.isLocalLabTarget('fixture.lab', async () => { throw new Error('DNS failure'); }), false);
  assert(await net.taskTargetHit('端口扫描 203.0.113.7', process.env.DSH_HOME));
});

test('tool gate enforces later arguments for restricted sessions but leaves normal coding unscoped', async () => {
  const handlers = new Map(); net.installRegionGate({ on: (name, fn) => { handlers.set(name, fn); } });
  assert(handlers.has('tools/pre-execute'));
  const session = { header: { agentPreset: 'redteam' } };
  const blocked = await handlers.get('tools/pre-execute')({ agent: { session }, name: 'bash', arguments: { command: 'curl http://203.0.113.7/' } }, () => ({ kind: 'allow' }));
  assert.equal(blocked.kind, 'deny');
  const selected = { header: { agentPreset: 'standard' }, events: [{ type: 'agent-preset/selected', data: { agentPreset: 'redteam' } }] };
  const staleHeader = await handlers.get('tools/pre-execute')({ agent: { session: selected }, arguments: { url: 'http://203.0.113.7/' } }, () => ({ kind: 'allow' }));
  assert.equal(staleHeader.kind, 'deny');
  const allowed = await handlers.get('tools/pre-execute')({ agent: { session }, name: 'bash', arguments: { command: 'curl http://127.0.0.1/' } }, () => ({ kind: 'allow' }));
  assert.equal(allowed.kind, 'allow');
  const normal = await handlers.get('tools/pre-execute')({ agent: { session: { header: { agentPreset: 'standard' } } }, arguments: { url: 'https://example.invalid' } }, () => ({ kind: 'allow' }));
  assert.equal(normal.kind, 'allow');
});

test('rules mutation requires POST before invoking delete callback', async () => {
  const src = fs.readFileSync(path.join(root, 'lib/index.js'), 'utf8');
  const fragment = src.slice(src.indexOf('async function handleRulesOp('), src.indexOf('async function handleSkillsOp('));
  let deleted = 0; let status;
  const handler = vm.runInNewContext(fragment + '\nrulesHttpHandler("")', {
    URL, READ_ONLY_RULE_OPS, core: { findDshHome: () => process.env.DSH_HOME },
    rules: { validRuleId: () => true, deleteRule: async () => { deleted++; } },
    refreshHungOperator: () => {}, sendOptions: () => {},
    readJsonBody: async () => ({}), sendJson: (_r, code) => { status = code; },
    methodNotAllowed: (req, _res, methods) => { if (methods.includes(req.method)) return false; status = 405; return true; },
  });
  await handler({ method: 'GET', url: '/dsh-purge/rules/delete?id=fixture' }, {});
  assert.equal(deleted, 0); assert.equal(status, 405);
  await handler({ method: 'POST', url: '/dsh-purge/rules/delete?id=fixture' }, {});
  assert.equal(deleted, 1); assert.equal(status, 200);
});

async function packageFixture(dir, version) {
  const files = ['lib/index.js', 'bin/dsh-purge.js', 'presets/redteam/preset.yml', 'skills/redteam/fixture.md',
    'scripts/build-client.mjs', 'client.js', 'cordis.patch.yml', 'README.md', 'README.zh-CN.md', 'LICENSE'];
  for (const name of files) { const full = path.join(dir, name); await fsp.mkdir(path.dirname(full), { recursive: true }); await fsp.writeFile(full, version); }
  await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'dsh-purge', version }));
}
test('complete update stages all bundled directories and supports full rollback', async () => {
  const source = path.join(temp, 'next'); const dest = path.join(temp, 'installed');
  await packageFixture(source, '1.1.72'); await packageFixture(dest, '1.1.71');
  const swap = await replacePackageTree(source, dest);
  for (const name of ['lib/index.js', 'presets/redteam/preset.yml', 'skills/redteam/fixture.md', 'scripts/build-client.mjs']) assert.equal(fs.readFileSync(path.join(dest, name), 'utf8'), '1.1.72');
  await rollbackPackageTree(swap);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'package.json'))).version, '1.1.71');
  const second = await replacePackageTree(source, dest); await finalizePackageTree(second);
  assert(!fs.existsSync(second.backup));
  await fsp.unlink(path.join(source, 'lib/index.js'));
  await assert.rejects(replacePackageTree(source, dest));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'package.json'))).version, '1.1.72');
});

test('modern leaf preset preserves every old deny and removes delegation from children', () => {
  const original = readPresetDefinition('redteam', path.join(root, 'presets/redteam'));
  const { parent, worker } = compatiblePresetDefinitions(original);
  const flatten = (rows) => rows.flatMap((r) => r.group ? flatten(r.config) : [r]);
  const parentRows = flatten(parent.plugins); const workerRows = flatten(worker.plugins);
  const spawn = parentRows.find((r) => r.config?.agentPreset === 'redteam-leaf');
  assert(spawn); assert.equal(spawn.config.toolFilter, undefined);
  assert.deepEqual(spawn.config.allowedAgentPresets, ['redteam-leaf']);
  assert(workerRows.filter((r) => r.name === '@deepseek-ai/dsh-tool-subagent').every((r) => r.disabled));
  const guard = workerRows.find((r) => r.id === 'dsh-purge-leaf-policy');
  for (const name of ['subagent_fork', 'workflow', 'ralph']) assert(guard.config.deny.includes(name));
  assert(flatten(original.plugins).some((r) => r.config?.toolFilter));
  for (const name of ['subagent', 'subagent_fork', 'workflow', 'ralph']) assert(leafDenial({ name }));
  assert.equal(leafDenial({ name: 'read' }), undefined);
  assert.throws(() => applyLeaf({ tools: {} }), /tools.guard/);
  let guardFn; applyLeaf({ tools: { guard: (fn) => { guardFn = fn; return () => {}; } }, effect: (fn) => fn() });
  assert(guardFn({ name: 'workflow' }));
});

test('schema normalization sets explicit policies without mutating source', () => {
  const source = { type: 'object', properties: { children: { type: 'array', items: { type: 'object' } } } };
  const fixed = explicitObjectSchemas(source);
  assert.equal(fixed.additionalProperties, false);
  assert.equal(fixed.properties.children.items.additionalProperties, true);
  assert.equal(source.additionalProperties, undefined);
});

test('SQLite initializes with the supported runtime', async () => {
  const { RedteamStore } = await import('../lib/redteam/store-core.js');
  const store = new RedteamStore(path.join(temp, 'store'));
  try { assert.equal(store.db('fixture', { create: true }).prepare('SELECT 1 AS ok').get().ok, 1); }
  finally { store.close(); }
});

test('source checkout cannot be overwritten by in-plugin update', async () => {
  await assert.rejects(updater.applyUpdate([{ kind: 'git', dir: root }], {}), /Git/);
  await assert.rejects(updater.applyUpdate([{ kind: 'source', dir: temp }], {}), /Git/);
});

test('repeated apply never replaces an original backup with markerless patched text', async () => {
  const base = path.join(temp, 'backup-fixture/node_modules/@deepseek-ai');
  const pkg = path.join(base, 'dsh-agent-instructions');
  const file = path.join(pkg, 'lib/index.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"@deepseek-ai/dsh-agent-instructions","version":"0.2.1-rc.3"}');
  const original = 'export const fixture = "original";\n'; fs.writeFileSync(file, original);
  const patches = [{ id: 9001, name: 'fixture', file: 'agent-instructions', replacements: [{ pattern: '"original"', replace: '"changed"' }], markers: ['"changed"'] }];
  await core.backupAll(base); await core.applyPatches(base, patches); await core.applyPatches(base, patches);
  assert.equal(fs.readFileSync(file + '.dshpurge.bak', 'utf8'), original);
  const restored = await core.revertAll(base);
  assert.equal(restored.errors.length, 0); assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('unrecognized same-version host edits cannot replace a verified backup', async () => {
  const base = path.join(temp, 'changed-host/node_modules/@deepseek-ai');
  const pkg = path.join(base, 'dsh-agent-instructions'); const file = path.join(pkg, 'lib/index.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
  fs.writeFileSync(file, 'original'); await core.backupAll(base);
  fs.writeFileSync(file, 'external modification');
  assert.throws(() => core.refreshStaleBaksForUpgrade(base), /基线不符/);
  assert.equal(fs.readFileSync(file + '.dshpurge.bak', 'utf8'), 'original');
});

function storedZip(entries) {
  const locals = []; const directory = []; let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name); const body = Buffer.from(text); const crc = crc32(body);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, body); directory.push(central, n); offset += 30 + n.length + body.length;
  }
  const central = Buffer.concat(directory); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
test('ZIP extraction handles directories and rejects path escape or corrupt data', () => {
  const dest = path.join(temp, 'zip');
  extractZipBuffer(storedZip([['bundle/', ''], ['bundle/data.txt', 'fixture']]), dest);
  assert.equal(fs.readFileSync(path.join(dest, 'bundle/data.txt'), 'utf8'), 'fixture');
  for (const name of ['../escape', '/absolute', 'C:/outside']) assert.throws(() => extractZipBuffer(storedZip([[name, 'x']]), path.join(temp, 'badzip')));
  const corrupt = storedZip([['note.txt', 'content']]); corrupt[30 + Buffer.byteLength('note.txt')] ^= 1;
  assert.throws(() => extractZipBuffer(corrupt, path.join(temp, 'corrupt')), /CRC/);
});
