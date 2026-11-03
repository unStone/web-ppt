import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPublishedTemplateBinaries } from './lib/published-template-binaries.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, 'out/agent-eval/published-template-binaries');
mkdirSync(work, { recursive: true });
const project = mkdtempSync(join(work, 'run-'));
const save = (path, value) => {
  const destination = join(project, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, typeof value === 'object' && !Buffer.isBuffer(value) ? `${JSON.stringify(value, null, 2)}\n` : value);
};
const binary = readFileSync(join(root, 'fixtures/sample-metafile.pptx'));
save('package.json', { name: 'publish-audit-test', private: true, workspaces: ['packages/*'] });
const manifests = {
  first: { name: '@publish-audit/first', version: '1.0.0', files: ['dist'], scripts: { prepack: 'node lifecycle.cjs', prepare: 'node lifecycle.cjs', postpack: 'node lifecycle.cjs' } },
  second: { name: '@publish-audit/second', version: '1.0.0', private: false, files: ['dist'] },
  private: { name: '@publish-audit/private', version: '1.0.0', private: true, files: ['dist'] },
};
for (const [directory, manifest] of Object.entries(manifests)) {
  save(`packages/${directory}/package.json`, manifest);
  save(`packages/${directory}/dist/index.js`, 'export const ready = true;\n');
}
save('packages/first/lifecycle.cjs', "require('node:fs').writeFileSync('lifecycle-ran', 'unexpected');\n");
save('packages/first/dist/recipe.pptx.json', { recipe: true });
save('packages/first/private-evidence/input.pptx', binary);
save('packages/private/dist/private-template.potx', binary);
save('tooling/agent-eval/fixtures/input.pptx', binary);
save('tooling/agent-eval/records/example/output.pptx', binary);
execFileSync('git', ['init', '--quiet'], { cwd: project });
execFileSync('git', ['add', '.'], { cwd: project });

const clean = auditPublishedTemplateBinaries(project);
assert.deepEqual(clean.map(({ name }) => name).sort(), ['@publish-audit/first', '@publish-audit/second']);
assert.ok(clean.every(({ files }) => files.includes('dist/index.js')));
assert.ok(clean.every(({ files }) => files.every((path) => !/\.(?:pptx|potx)$/i.test(path))));
assert.equal(existsSync(join(project, 'packages/first/lifecycle-ran')), false, '审计不能执行 prepare/prepack/postpack');

// 文件确实进入 npm 清单后才应失败；tooling 名称不能为发布包内资产提供例外。
save('packages/first/dist/tooling/agent-eval/records/leaked.PPTX', binary);
assert.throws(() => auditPublishedTemplateBinaries(project), (error) => {
  assert.match(error.message, /@publish-audit\/first/);
  assert.match(error.message, /dist\/tooling\/agent-eval\/records\/leaked\.PPTX/);
  return true;
});
rmSync(join(project, 'packages/first/dist/tooling'), { recursive: true });
save('packages/second/dist/template.potx', binary);
assert.throws(() => auditPublishedTemplateBinaries(project), /@publish-audit\/second.*template\.potx/);
rmSync(join(project, 'packages/second/dist/template.potx'));

const extensions = ['ppt', 'pptm', 'pot', 'potm', 'pps', 'ppsx', 'ppsm', 'ppa', 'ppam', 'sldx', 'sldm', 'thmx', 'odp', 'otp'];
for (const extension of extensions) save(`packages/first/dist/templates/forbidden.${extension}`, binary);
assert.throws(() => auditPublishedTemplateBinaries(project), (error) => {
  for (const extension of extensions) assert.ok(error.message.includes(`forbidden.${extension}`));
  return true;
});
rmSync(join(project, 'packages/first/dist/templates'), { recursive: true });
assert.equal(auditPublishedTemplateBinaries(project).length, 2);
save('packages/agent/package.json', { name: '@publish-audit/agent', version: '1.0.0', files: ['skills'] });
save('packages/agent/skills/template.PPTM', binary);
assert.throws(() => auditPublishedTemplateBinaries(project), /@publish-audit\/agent.*skills\/template\.PPTM/);
rmSync(join(project, 'packages/agent'), { recursive: true });
assert.equal(existsSync(join(project, 'packages/first/lifecycle-ran')), false);
assert.ok(!readdirSync(project, { recursive: true }).some((path) => path.endsWith('.tgz')), 'dry-run 不能写 tarball');
for (const [directory, manifest] of Object.entries(manifests)) save(`packages/${directory}/package.json`, { ...manifest, private: true });
assert.throws(() => auditPublishedTemplateBinaries(project), /没有可发布的 npm workspace/);
console.log('npm 实际发布清单：私有评测二进制允许，公开包夹带 PPT/PPTX/POTX 等模板拒绝，生命周期脚本未运行');
