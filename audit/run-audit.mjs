// Isolated audit of the unmodified 1.1.71 baseline. Never calls plugin apply,
// updater apply, host restart, shell tools, or an external network service.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version !== '1.1.71') {
  throw new Error('Historical 1.1.71 probe only. Use npm test for the maintained 1.1.72 regression suite.');
}
const auditDir = path.join(root, 'audit');
const tmpRoot = path.join(auditDir, '.tmp');
fs.mkdirSync(tmpRoot, { recursive: true });
const work = fs.mkdtempSync(path.join(tmpRoot, 'run-'));
process.env.DSH_HOME = path.join(work, 'home');
process.env.DSH_SURFACE = 'web';
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });
const results = [];
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

async function check(id, kind, fn) {
  try {
    const evidence = await fn();
    results.push({ id, kind, status: 'confirmed', evidence });
  } catch (error) {
    results.push({ id, kind, status: 'inconclusive', error: String(error?.stack || error) });
  }
}

await check('syntax', 'verification', () => {
  function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === '.git' || e.name === 'audit' || e.name === 'node_modules') return [];
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : /\.(?:js|mjs)$/.test(e.name) ? [p] : [];
    });
  }
  const files = walk(root);
  const failures = [];
  for (const file of files) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (r.status !== 0) failures.push({ file: path.relative(root, file), error: r.stderr || r.error?.message });
  }
  assert.equal(failures.length, 0, JSON.stringify(failures));
  return { files: files.length, failures };
});

const core = await import('../lib/core.js');
const uninstall = await import('../lib/uninstall.js');
const updater = await import('../lib/update.js');
const netScope = await import('../lib/net-scope.js');

await check('module-imports', 'verification', async () => {
  const modules = ['lib/index.js', 'lib/redteam/index.js', 'lib/redteam/store.js', 'lib/redteam/tools.js', 'lib/redteam/ui.js'];
  for (const rel of modules) await import(new URL('../' + rel, import.meta.url));
  return { modules, note: 'Imported only; no Cordis plugin apply invoked.' };
});

await check('nested-profile-uninstall', 'defect', () => {
  const pkg = {
    dependencies: { 'dsh-purge': 'file:../../plugins/dsh-purge', untouched: '1.0.0' },
    dsh: { profile: { bundles: ['base', 'dsh-purge'], plugins: ['dsh-purge'] } },
  };
  assert.equal(uninstall.stripPluginFromPackage(pkg), true);
  assert.equal(pkg.dependencies['dsh-purge'], undefined);
  assert(pkg.dsh.profile.bundles.includes('dsh-purge'));
  assert(pkg.dsh.profile.plugins.includes('dsh-purge'));
  return { remaining: pkg.dsh.profile, consequence: 'Dependency removed but real profile still requests dsh-purge.' };
});

await check('loopback-origin-validation', 'defect', () => {
  const src = read('lib/redteam/ui.js');
  const start = src.indexOf('      const remote = req.socket');
  const end = src.indexOf('      if (!originOk)', start);
  assert(start > 0 && end > start);
  const verdict = (remoteAddress, origin, host) => vm.runInNewContext(
    src.slice(start, end) + '\noriginOk',
    { req: { socket: { remoteAddress }, headers: { origin, host } }, URL },
    { timeout: 1000 },
  );
  const loopbackAllowsForeignOrigin = verdict('127.0.0.1', 'https://untrusted.invalid', '127.0.0.1:7777');
  const nonLoopbackBlocksForeignOrigin = !verdict('192.0.2.2', 'https://untrusted.invalid', 'lab.invalid:7777');
  assert(loopbackAllowsForeignOrigin && nonLoopbackBlocksForeignOrigin);
  return { loopbackAllowsForeignOrigin, nonLoopbackBlocksForeignOrigin, note: 'Mock request only; no browser exploit or server started.' };
});

await check('get-can-delete-rule', 'defect', async () => {
  const src = read('lib/index.js');
  const start = src.indexOf('async function handleRulesOp(');
  const end = src.indexOf('async function handleSkillsOp(', start);
  assert(start > 0 && end > start);
  let deleted = '';
  let status = 0;
  const context = {
    URL,
    core: { findDshHome: () => process.env.DSH_HOME },
    rules: { validRuleId: () => true, deleteRule: async (_home, id) => { deleted = id; } },
    refreshHungOperator: () => {},
    sendOptions: () => {},
    sendJson: (_response, code) => { status = code; },
    methodNotAllowed: (req, _res, allowed) => !allowed.includes(req.method),
  };
  const handler = vm.runInNewContext(src.slice(start, end) + '\nrulesHttpHandler("")', context, { timeout: 1000 });
  await handler({ method: 'GET', url: '/dsh-purge/rules/delete?id=audit-fixture' }, {});
  assert.equal(deleted, 'audit-fixture');
  assert.equal(status, 200);
  return { method: 'GET', operationExecuted: 'deleteRule', status, note: 'Deletion was a mock callback; no real rules were removed.' };
});

await check('file-archive-classified-as-directory', 'defect', () => {
  const profile = path.join(work, 'profile');
  const spec = 'file:./dsh-purge-1.1.71.tgz';
  fs.mkdirSync(profile, { recursive: true });
  const resolved = updater.resolveLinkDir(profile, spec);
  fs.writeFileSync(resolved, 'inert archive placeholder');
  assert(updater.isLinkSpec(spec));
  assert(fs.statSync(resolved).isFile());
  return { spec, classifiedAsLinkedDirectory: true, actualType: 'file', consequence: 'planUpdates passes archive file path as an update directory.' };
});

await check('concurrent-atomic-writes', 'defect', async () => {
  // Force both concurrent operations into the same millisecond to make the
  // existing temporary-name collision reproducible rather than timing-dependent.
  const file = path.join(work, 'atomic', 'state.json');
  const originalNow = Date.now;
  let outcome;
  try {
    Date.now = () => 1792886400000;
    outcome = await Promise.allSettled([
      core.atomicWriteFile(file, '{"request":1}\n'),
      core.atomicWriteFile(file, '{"request":2}\n'),
    ]);
  } finally {
    Date.now = originalNow;
  }
  assert(outcome.some((r) => r.status === 'rejected'));
  return { outcomes: outcome.map((r) => ({ status: r.status, code: r.reason?.code })), note: 'Only writes a fixture beneath audit/.tmp.' };
});

await check('network-gate-is-not-ip-isolation', 'defect', async () => {
  const syntheticTask = '端口扫描目标 203.0.113.7';
  assert(netScope.isAttackTask(syntheticTask));
  assert.equal(await netScope.taskTargetHit(syntheticTask, process.env.DSH_HOME), null);
  const registered = [];
  netScope.installRegionGate({ on: (event) => { registered.push(event); } });
  assert(registered.includes('agent/pre-step'));
  assert(!registered.includes('tools/pre-execute'));
  return { documentationAddressNotBlocked: true, registered, note: '203.0.113.7 is an inert documentation address; no network traffic was sent.' };
});

await check('text-launcher-misclassified-as-binary', 'defect', async () => {
  const dir = path.join(work, 'launcher-fixture');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'dsh.ps1'), '# text-only inert launcher fixture\n');
  const { hostFs } = await import('../lib/extract-asar.js');
  assert.equal(hostFs.readSync, undefined);
  assert.equal(hostFs.closeSync, undefined);
  const result = await core.patchShim(dir);
  assert.equal(result['dsh.ps1'], 'skipped_binary');
  return { missingMethods: ['readSync', 'closeSync'], result, consequence: 'isTextShim catches a missing-method TypeError and treats text launchers as binaries; opened fd is not closed.' };
});

await check('node-engine-mismatch', 'defect', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.engines.node, '>=18');
  assert.match(read('lib/redteam/store-core.js'), /from 'node:sqlite'/);
  assert.match(read('cordis.patch.yml'), /name: dsh-purge\/redteam\/store/);
  return { advertisedNode: pkg.engines.node, mandatoryBuiltin: 'node:sqlite', note: 'Runtime tested on Node 24 only; Node 18/20 cannot provide this builtin.' };
});

await check('update-payload-omits-bundled-directories', 'defect', () => {
  const src = read('lib/update.js');
  const start = src.indexOf('const COPY_NAMES = [');
  const end = src.indexOf('];', start);
  const copyNames = vm.runInNewContext(src.slice(start, end + 2) + '\nCOPY_NAMES', {}, { timeout: 1000 });
  for (const name of ['presets', 'skills', 'scripts']) assert(!copyNames.includes(name));
  return { copyNames: Array.from(copyNames), missing: ['presets', 'skills', 'scripts'], consequence: 'ZIP overlay update can mix new lib/package files with old preset, skill and script files.' };
});

await check('hardcoded-upstream-update', 'maintenance-risk', () => {
  const src = read('lib/update.js');
  assert.match(src, /const REPO = "YuJunZhiXue\/dsh-purge"/);
  assert.match(src, /\["reset", "--hard",/);
  assert.match(read('.github/workflows/release.yml'), /github\.repository == 'YuJunZhiXue\/dsh-purge'/);
  return { updateRepository: 'YuJunZhiXue/dsh-purge', destructiveGitUpdatePresent: true, releaseWorkflowRestrictedToUpstream: true, note: 'No update or git reset executed.' };
});

await check('embedded-prompt-inspection', 'verification', async () => {
  const { openSlot } = await import('../lib/table-read.js');
  const text = openSlot();
  assert(text.length > 1000);
  // Save metadata only. The decoded instructions are data, never instructions
  // for the audit runner, and are not executed or injected into any model.
  const domains = [...new Set(Array.from(text.matchAll(/https?:\/\/([^\s/<>"'`]+)/g), (m) => m[1]))];
  return { utf8Bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'), urlHosts: domains, note: 'AES key derivation is shipped alongside ciphertext; this is obfuscation, not a secret boundary.' };
});

await check('sqlite-fixture', 'verification', async () => {
  const { RedteamStore } = await import('../lib/redteam/store-core.js');
  const store = new RedteamStore(path.join(work, 'redteam'));
  try {
    const db = store.db('audit-fixture', { create: true });
    const result = db.prepare('SELECT 1 AS ok').get();
    assert.equal(result.ok, 1);
    return { selectOne: result.ok, note: 'New fixture database only, no real target, account or credential data.' };
  } finally {
    store.close();
  }
});

const report = {
  baseline: '5e757260a0be055892b48ec520d451cc82e1c191',
  version: JSON.parse(read('package.json')).version,
  platform: process.platform,
  node: process.version,
  scope: 'Isolated checks only; no host apply, uninstall, update, restart, scans or payloads executed.',
  results,
};
fs.writeFileSync(path.join(auditDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
for (const r of results) console.log(`${r.status.padEnd(12)} ${r.kind.padEnd(16)} ${r.id}`);
console.log(`Report: ${path.join(auditDir, 'results.json')}`);
if (results.some((r) => r.status === 'inconclusive')) process.exitCode = 1;
