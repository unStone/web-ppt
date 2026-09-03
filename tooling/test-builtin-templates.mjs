import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { runBuiltinTemplateContract } from './lib/builtin-template-contract.mjs';
import { recordCount } from './lib/measured.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/builtin-templates');
mkdirSync(out, { recursive: true });
const aliases = [
  ['@web-ppt/core/geometry/handles', join(root, 'packages/core/src/geometry/handles/index.ts')],
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
];
const [templates, generate, core, edit] = await Promise.all([
  bundleBrowser({
    root, aliases,
    entry: join(root, 'packages/edit-core/src/templates/index.ts'),
    output: join(out, 'templates.mjs'),
  }),
  bundleBrowser({
    root, aliases,
    entry: join(root, 'packages/edit-core/src/generate/index.ts'),
    output: join(out, 'generate.mjs'),
  }),
  bundleBrowser({
    root,
    entry: join(root, 'packages/core/src/index.ts'),
    output: join(out, 'core.mjs'),
  }),
  bundleBrowser({
    root, aliases,
    entry: join(root, 'packages/edit-core/src/index.ts'),
    output: join(out, 'edit.mjs'),
  }),
]);

let passed = 0;
const failures = [];
const check = (label, condition, detail = '') => {
  if (condition) passed++;
  else failures.push(`${label}${detail ? `：${detail}` : ''}`);
  return condition;
};

await runBuiltinTemplateContract({
  templates, generate, core, edit, check,
  sha256: (bytes) => createHash('sha256').update(bytes).digest('hex'),
  saveArtifact: (name, bytes) => {
    const path = join(out, name);
    writeFileSync(path, bytes);
    return path;
  },
  renderFingerprint: (file, mode) => {
    const path = isAbsolute(file) ? file : join(out, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/builtin-template-fingerprint.mjs'),
      join(out, 'core.mjs'), join(out, 'edit.mjs'), path, mode,
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});
if (failures.length) {
  console.error(`\n\x1b[31m✗ ${failures.length} 项内置模板验收失败\x1b[0m`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}
recordCount('templates', passed);
console.log(`\n\x1b[32m✓ 内置模板 ${passed} 项断言通过\x1b[0m`);
