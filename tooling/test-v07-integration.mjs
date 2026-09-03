import {
  copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import {
  runV07IntegrationContract, runV07PermissionContract,
} from './lib/v07-integration-contract.mjs';
import { recordCount } from './lib/measured.mjs';
import {
  V07_OFFICE_ARTIFACTS, V07_OFFICE_MANIFEST,
} from './lib/v07-office-artifacts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/v07-integration');
mkdirSync(out, { recursive: true });
for (const { file } of V07_OFFICE_ARTIFACTS) {
  const path = join(out, file);
  if (existsSync(path)) unlinkSync(path);
}
const manifestPath = join(out, V07_OFFICE_MANIFEST);
if (existsSync(manifestPath)) unlinkSync(manifestPath);
const aliases = [
  ['@web-ppt/core/geometry/handles', join(root, 'packages/core/src/geometry/handles/index.ts')],
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
];
const [templates, core, edit] = await Promise.all([
  bundleBrowser({
    root, aliases, entry: join(root, 'packages/edit-core/src/templates/index.ts'),
    output: join(out, 'templates.mjs'),
  }),
  bundleBrowser({
    root, entry: join(root, 'packages/core/src/index.ts'), output: join(out, 'core.mjs'),
  }),
  bundleBrowser({
    root, aliases, entry: join(root, 'packages/edit-core/src/index.ts'),
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

await runV07PermissionContract({ templates, core, edit, check });
const artifacts = await runV07IntegrationContract({
  templates, core, edit, check,
  load: (name) => new Uint8Array(readFileSync(join(root, 'fixtures', name))),
  saveArtifact: (name, bytes) => {
    const path = join(out, name);
    writeFileSync(path, bytes);
    return path;
  },
});
const copiedArtifacts = [
  ['out/edit-save', 'theme-editing.pptx'],
  ['out/edit-save', 'layout-editing.pptx'],
  ['out/edit-save', 'master-editing.pptx'],
  ['out/builtin-templates', 'aurora-edited.pptx'],
];
for (const [directory, file] of copiedArtifacts) {
  const source = join(root, directory, file);
  if (!existsSync(source)) throw new Error(`0.7 集成验收缺少上游保存产物：${file}`);
  copyFileSync(source, join(out, file));
}
const generated = new Map(artifacts.map((artifact) => [artifact.file, artifact.slides]));
const copied = new Set(copiedArtifacts.map(([, file]) => file));
for (const artifact of V07_OFFICE_ARTIFACTS) {
  if (copied.has(artifact.file)) continue;
  check(`Office 清单产物已由本轮生成：${artifact.file}`,
    generated.get(artifact.file) === artifact.slides && existsSync(join(out, artifact.file)));
}
if (failures.length) {
  console.error(`\n\x1b[31m✗ ${failures.length} 项 0.7 集成验收失败\x1b[0m`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}
writeFileSync(manifestPath, `${JSON.stringify({
  version: 1, artifacts: V07_OFFICE_ARTIFACTS,
}, null, 2)}\n`);
recordCount('v07', passed);
console.log(`\n\x1b[32m✓ 0.7 集成验收 ${passed} 项断言通过\x1b[0m`);
console.log(`  Office 产物 ${V07_OFFICE_ARTIFACTS.length} 份`);
