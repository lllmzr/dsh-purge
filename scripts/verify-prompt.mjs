// Exercise the actual host renderer without sending a model request.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installAssembleGuard, rewritePromptAssembly } from '../lib/identity.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const at = process.argv.indexOf('--base');
const base = at >= 0 ? process.argv[at + 1] : path.join(root, '.local/host-clean/dsh/node_modules/@deepseek-ai');
const { renderPrompt, renderContextSections } = await import(pathToFileURL(path.join(base, 'dsh-system-prompt/lib/index.js')));
const variables = { provider: 'fixture-provider', model: 'fixture-model' };
const legacy = { sections: [{ name: 'deployment:persona-suffix', text: 'Your working directory is {{cwd}}.' }], contexts: [], tools: [], variables };
assert.throws(() => renderPrompt(legacy), /unknown prompt variable.*cwd/);
let cases = 0;
for (const preset of ['standard', 'build', 'redteam', 'redteam-leaf']) {
  for (const cwd of ['D:/fixture', 'D:/fixture/{{literal}}', '']) {
    for (const sections of [[], legacy.sections]) {
      const context = { agent: { session: { header: { cwd, agentPreset: preset } } } };
      const original = { sections, contexts: [{ name: 'runtime:cwd', text: cwd, interpolate: false }], tools: [], variables };
      const snapshot = structuredClone(original);
      const prompt = { assemble: async () => original };
      const rewrite = (assembly, ctx) => rewritePromptAssembly(assembly, { fallbackInject: 'Fixture instructions.', capabilityProtocol: false, context: ctx });
      installAssembleGuard(prompt, rewrite);
      for (let turn = 0; turn < 2; turn++) {
        const assembled = await prompt.assemble(context);
        const rendered = renderPrompt(assembled);
        assert(rendered.includes('Fixture instructions.'));
        if (cwd) assert(rendered.includes(`Your working directory is ${cwd}.`));
        else assert(!rendered.includes('{{cwd}}'));
        assert.deepEqual(renderContextSections(assembled), cwd ? [{ name: 'runtime:cwd', text: cwd }] : []);
        assert.deepEqual(original, snapshot);
      }
      cases++;
    }
  }
}
const report = { ok: true, renderer: path.join(base, 'dsh-system-prompt/lib/index.js'), baselineReproduced: true, cases, turns: cases * 2, modelRequests: 0 };
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts/prompt-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
