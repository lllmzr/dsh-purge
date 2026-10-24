import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/runtime-verification.json')));
const base = path.join(root, '.local/host-clean/dsh/node_modules/@deepseek-ai');
const env = { ...process.env, DSH_HOME: fixture.home, DSH_BASE: base, DSH_SURFACE: 'web' };
const child = spawn(process.execPath, ['--expose-internals', path.join(base, 'dsh/lib/bin.js'), '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
  { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; let exited = false;
child.stdout.on('data', (chunk) => { log += String(chunk); });
child.stderr.on('data', (chunk) => { log += String(chunk); });
child.on('exit', () => { exited = true; });
const deadline = Date.now() + 45000;
let url;
let verified = false;
try {
  while (Date.now() < deadline && !exited) {
    const matches = log.match(/https?:\/\/127\.0\.0\.1:\d+/g);
    if (matches) {
      url = matches.at(-1);
      try {
        const response = await fetch(url + '/dsh-purge/status', { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          const state = await response.json();
          const data = await fetch(url + '/redteam/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"op":"bootstrap"}', signal: AbortSignal.timeout(2000) });
          const bootstrap = await data.json();
          if (!bootstrap.ok) throw new Error(JSON.stringify(bootstrap));
          const foreign = await fetch(url + '/redteam/api', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://untrusted.invalid' }, body: '{"op":"bootstrap"}' });
          if (foreign.status !== 403) throw new Error('Foreign origin not rejected: ' + foreign.status);
          const declaration = path.join(fixture.home, 'redteam/preset-declare.json');
          const preset = fs.existsSync(declaration) ? JSON.parse(fs.readFileSync(declaration)) : null;
          if (preset?.phase !== 'registered') { await new Promise((r) => setTimeout(r, 500)); continue; }
          const report = { ok: true, url, stateKeys: Object.keys(state), bootstrap: bootstrap.ok, foreignOriginStatus: foreign.status, preset };
          fs.writeFileSync(path.join(root, 'artifacts/smoke-verification.json'), JSON.stringify(report, null, 2) + '\n');
          verified = true;
          console.log(JSON.stringify(report, null, 2));
          break;
        }
      } catch (error) { if (Date.now() + 1000 >= deadline) throw error; }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!verified) throw new Error('Runtime did not become ready.\n' + log.slice(-10000));
} finally {
  fs.writeFileSync(path.join(root, 'artifacts/smoke-runtime.log'), log);
  if (!exited) child.kill();
}
