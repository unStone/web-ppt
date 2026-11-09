import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ALL_OFFICE_ARTIFACTS, EDIT_SAVE_OFFICE_ARTIFACTS } from './lib/edit-save-office-artifacts.mjs';
import { selectEditOfficeArtifacts } from './lib/edit-office-selection.mjs';

const model = selectEditOfficeArtifacts([]);
const site = selectEditOfficeArtifacts(['--site-only']);
const all = selectEditOfficeArtifacts(['--include-site']);
const paths = (artifacts) => artifacts.map((artifact) => artifact.path);

assert.deepEqual(all, ALL_OFFICE_ARTIFACTS, '原 --include-site 必须保留完整清单及元数据');
assert.deepEqual(
  model.map(({ path, ...artifact }) => artifact),
  EDIT_SAVE_OFFICE_ARTIFACTS,
  '默认模型验证必须保留原清单及页数回退',
);
assert.ok(site.length > 0, '官网外部打开门禁必须有实际工件');
assert.equal(new Set(paths(all)).size, all.length, '总清单的每件产物只能出现一次');
assert.equal(new Set([...paths(model), ...paths(site)]).size, model.length + site.length, '并行验证的模型与官网产物不能重复');
assert.deepEqual([...model, ...site], all, '两个独立入口必须恰好覆盖完整清单及全部验收元数据');
assert.equal(selectEditOfficeArtifacts(['--site-only', '--site-only']).length, site.length, '重复同一布尔标志不能改变覆盖范围');
assert.throws(() => selectEditOfficeArtifacts(['--include-site', '--site-only']), /不能同时使用/);
assert.throws(() => selectEditOfficeArtifacts(['--unknown']), { code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' });
assert.throws(() => selectEditOfficeArtifacts(['sample.pptx']), { code: 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL' });

const root = resolve(import.meta.dirname, '..');
const entry = resolve(root, 'tooling/test-edit-libreoffice-all.mjs');
for (const args of [['--include-site', '--site-only'], ['--unknown'], ['sample.pptx']]) {
  const result = spawnSync(process.execPath, [entry, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1, `CLI 必须拒绝参数：${args.join(' ')}`);
  assert.match(result.stderr, /不能同时使用|ERR_PARSE_ARGS_/, '无效参数必须在调用 LibreOffice 前失败');
  assert.doesNotMatch(result.stderr, /找不到待验证|未找到 LibreOffice/);
}
console.log('Office 并行清单：模型与官网无重复且完整覆盖，旧入口和无效参数边界通过');
