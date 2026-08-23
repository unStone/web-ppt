/** M1 只从发布入口取证，避免保存器内部 helper 与测试共享同一个错误。 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { runM1SaveContract } from './lib/m1-save-contract.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/edit-save');
mkdirSync(out, { recursive: true });

const aliases = [
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
];
const corePath = join(out, 'core.mjs');
const editPath = join(out, 'edit.mjs');
const core = await bundleBrowser({
  root, entry: join(root, 'packages/core/src/index.ts'), output: corePath,
});
const edit = await bundleBrowser({
  root, entry: join(root, 'packages/edit-core/src/index.ts'), output: editPath, aliases,
});
const fixturesDir = join(root, 'fixtures');
const load = (name) => new Uint8Array(readFileSync(join(fixturesDir, name)));
const fixtureNames = readdirSync(fixturesDir).sort();

const failures = [];
let passed = 0;
const check = (label, condition, detail = '') => {
  if (condition) passed++;
  else failures.push(`${label}${detail ? `：${detail}` : ''}`);
  return condition;
};
const eq = (label, actual, expected) => check(label, Object.is(actual, expected),
  `期望 ${String(expected)}，实际 ${String(actual)}`);

await runM1SaveContract({
  core,
  edit,
  fixtureNames,
  load,
  check,
  eq,
  saveArtifact: (name, bytes) => {
    const path = join(out, name);
    writeFileSync(path, bytes);
    return path;
  },
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.error(`\x1b[31m✗ ${failures.length} 项 M1 保存验收失败\x1b[0m`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\x1b[32m✓ M1 保存验收全部通过（${passed} 项断言）\x1b[0m`);
}
