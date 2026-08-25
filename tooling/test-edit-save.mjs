/** M1 只从发布入口取证，避免保存器内部 helper 与测试共享同一个错误。 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { runM1SaveContract } from './lib/m1-save-contract.mjs';
import { runEngineTextSaveContract } from './lib/engine-text-save-contract.mjs';
import { runTableCellTextSaveContract } from './lib/table-cell-text-save-contract.mjs';
import { runShapeAutofitSaveContract } from './lib/shape-autofit-save-contract.mjs';
import { runBodyPropsSaveContract } from './lib/body-props-save-contract.mjs';
import { runTableRowInsertSaveContract } from './lib/table-row-insert-save-contract.mjs';
import { runAddShapeSaveContract } from './lib/add-shape-save-contract.mjs';
import { runAddImageSaveContract } from './lib/add-image-save-contract.mjs';
import { runAddTableSaveContract } from './lib/add-table-save-contract.mjs';
import { runAddSlideSaveContract } from './lib/add-slide-save-contract.mjs';
import { runMoveSlideSaveContract } from './lib/move-slide-save-contract.mjs';
import { runRemoveSlideSaveContract } from './lib/remove-slide-save-contract.mjs';
import { runDuplicateSlideSaveContract } from './lib/duplicate-slide-save-contract.mjs';
import {
  EDIT_SAVE_OFFICE_ARTIFACTS, EDIT_SAVE_OFFICE_MANIFEST,
} from './lib/edit-save-office-artifacts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/edit-save');
mkdirSync(out, { recursive: true });
const manifestPath = join(out, EDIT_SAVE_OFFICE_MANIFEST);
for (const { file } of EDIT_SAVE_OFFICE_ARTIFACTS) {
  const path = join(out, file);
  if (existsSync(path)) unlinkSync(path);
}
if (existsSync(manifestPath)) unlinkSync(manifestPath);

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
const savedArtifactNames = new Set();
const saveArtifact = (name, bytes) => {
  const path = join(out, name);
  writeFileSync(path, bytes);
  savedArtifactNames.add(name);
  return path;
};

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
  saveArtifact,
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

await runEngineTextSaveContract({
  core, edit, load, check, eq,
  saveArtifact,
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

await runTableCellTextSaveContract({
  core, edit, load, check, eq,
  saveArtifact,
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

await runShapeAutofitSaveContract({
  core, edit, load, check, eq,
  saveArtifact,
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

await runBodyPropsSaveContract({
  core, edit, load, check, eq,
  saveArtifact,
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

await runTableRowInsertSaveContract({
  core, edit, load, check, eq,
  saveArtifact,
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

await runAddShapeSaveContract({
  core, edit, load, check, eq,
  saveArtifact,
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

await runAddImageSaveContract({
  core, edit, load, check, eq,
  saveArtifact,
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

await runAddTableSaveContract({
  core, edit, load, check, eq,
  saveArtifact,
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

await runAddSlideSaveContract({
  core, edit, load, check, eq,
  saveArtifact,
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

await runMoveSlideSaveContract({
  core, edit, load, check, eq,
  saveArtifact,
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

await runRemoveSlideSaveContract({
  core, edit, load, check, eq, saveArtifact,
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

await runDuplicateSlideSaveContract({
  core, edit, load, check, eq, saveArtifact,
  renderFingerprint: (file, mode, scenario) => {
    const filePath = isAbsolute(file) ? file : join(fixturesDir, file);
    const stdout = execFileSync(process.execPath, [
      join(root, 'tooling/lib/m1-save-fingerprint.mjs'), corePath, editPath, filePath, mode,
      JSON.stringify(scenario),
    ], { cwd: root, encoding: 'utf8' });
    return JSON.parse(stdout);
  },
});

const expectedArtifactNames = EDIT_SAVE_OFFICE_ARTIFACTS.map(({ file }) => file).sort();
check('真实 Office 门禁覆盖本轮全部保存产物',
  [...savedArtifactNames].sort().join('\n') === expectedArtifactNames.join('\n'));

console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.error(`\x1b[31m✗ ${failures.length} 项 M1 保存验收失败\x1b[0m`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exitCode = 1;
} else {
  writeFileSync(manifestPath, `${JSON.stringify({
    version: 1,
    artifacts: EDIT_SAVE_OFFICE_ARTIFACTS,
  }, null, 2)}\n`);
  console.log(`\x1b[32m✓ M1 保存验收全部通过（${passed} 项断言）\x1b[0m`);
}
