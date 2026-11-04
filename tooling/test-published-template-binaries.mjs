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
const save = (path, value, base = project) => {
  const destination = join(base, path);
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

const clean = await auditPublishedTemplateBinaries(project);
assert.deepEqual(clean.map(({ name }) => name).sort(), ['@publish-audit/first', '@publish-audit/second'],
  '未声明 private 与显式 private:false 的公开包都必须进入 npm 发布审计');
assert.ok(clean.every(({ files }) => files.includes('dist/index.js')));
assert.ok(clean.every(({ files }) => files.every((path) => !/\.(?:pptx|potx)$/i.test(path))));
assert.equal(existsSync(join(project, 'packages/first/lifecycle-ran')), false, '审计不能执行 prepare/prepack/postpack');

// 文件确实进入 npm 清单后才应失败；tooling 名称不能为发布包内资产提供例外。
save('packages/first/dist/tooling/agent-eval/records/leaked.PPTX', binary);
await assert.rejects(() => auditPublishedTemplateBinaries(project), (error) => {
  assert.match(error.message, /@publish-audit\/first/);
  assert.match(error.message, /dist\/tooling\/agent-eval\/records\/leaked\.PPTX/);
  return true;
});
rmSync(join(project, 'packages/first/dist/tooling'), { recursive: true });
save('packages/second/dist/template.potx', binary);
await assert.rejects(() => auditPublishedTemplateBinaries(project), /@publish-audit\/second.*template\.potx/);
rmSync(join(project, 'packages/second/dist/template.potx'));

const extensions = ['ppt', 'pptm', 'pot', 'potm', 'pps', 'ppsx', 'ppsm', 'ppa', 'ppam', 'sldx', 'sldm', 'thmx', 'odp', 'otp'];
for (const extension of extensions) save(`packages/first/dist/templates/forbidden.${extension}`, binary);
await assert.rejects(() => auditPublishedTemplateBinaries(project), (error) => {
  for (const extension of extensions) assert.ok(error.message.includes(`forbidden.${extension}`));
  return true;
});
rmSync(join(project, 'packages/first/dist/templates'), { recursive: true });
assert.equal((await auditPublishedTemplateBinaries(project)).length, 2);
save('packages/agent/package.json', { name: '@publish-audit/agent', version: '1.0.0', files: ['skills'] });
save('packages/agent/skills/template.PPTM', binary);
await assert.rejects(() => auditPublishedTemplateBinaries(project), /@publish-audit\/agent.*skills\/template\.PPTM/);
rmSync(join(project, 'packages/agent'), { recursive: true });
save('package.json', { name: 'publish-audit-test', private: true, workspaces: ['packages/*', 'packages/first/dist/fixtures/*'] });
save('packages/first/dist/fixtures/nested/package.json', { name: '@publish-audit/nested-private', version: '1.0.0', private: true });
save('packages/first/dist/fixtures/nested/template.pptx', binary);
await assert.rejects(() => auditPublishedTemplateBinaries(project), /@publish-audit\/first.*dist\/fixtures\/nested\/template\.pptx/);
rmSync(join(project, 'packages/first/dist/fixtures'), { recursive: true });
save('package.json', { name: 'publish-audit-test', private: true, workspaces: ['packages/*'] });
assert.equal(existsSync(join(project, 'packages/first/lifecycle-ran')), false);
assert.ok(!readdirSync(project, { recursive: true }).some((path) => path.endsWith('.tgz')), '审计不能写 tarball');
for (const [directory, manifest] of Object.entries(manifests)) save(`packages/${directory}/package.json`, { ...manifest, private: true });
await assert.rejects(() => auditPublishedTemplateBinaries(project), /没有可发布的 npm workspace/);

// 祖先忽略规则属于 workspace 的打包语义，不能只在包目录内扫描。
const ignoredProject = mkdtempSync(join(work, 'ignores-'));
const ignoredSave = (path, value) => save(path, value, ignoredProject);
ignoredSave('package.json', { name: 'publish-ignore-test', private: true, workspaces: ['packages/group/*'] });
ignoredSave('packages/group/public/package.json', { name: '@publish-audit/ignored', version: '1.0.0' });
ignoredSave('packages/group/public/index.js', 'export const ready = true;\n');
ignoredSave('packages/group/public/from-root.pptx', binary);
ignoredSave('packages/group/public/from-middle.pptx', binary);
ignoredSave('.npmignore', 'from-root.pptx\n');
ignoredSave('packages/.npmignore', 'from-middle.pptx\n');
const checkIgnores = async () => {
  const result = await auditPublishedTemplateBinaries(ignoredProject);
  assert.equal(result.length, 1);
  assert.ok(result[0].files.includes('index.js'));
  assert.ok(result[0].files.every((path) => !path.endsWith('.pptx')));
  return result;
};
await checkIgnores();
rmSync(join(ignoredProject, '.npmignore'));
await assert.rejects(() => auditPublishedTemplateBinaries(ignoredProject), /from-root\.pptx/);
ignoredSave('.gitignore', 'from-root.pptx\n');
await checkIgnores();
ignoredSave('.npmignore', 'unrelated.txt\n');
await assert.rejects(() => auditPublishedTemplateBinaries(ignoredProject), /from-root\.pptx/);
ignoredSave('.npmignore', 'from-root.pptx\n');
rmSync(join(ignoredProject, 'packages/.npmignore'));
await assert.rejects(() => auditPublishedTemplateBinaries(ignoredProject), /from-middle\.pptx/);
ignoredSave('packages/.gitignore', 'from-middle.pptx\n');
await checkIgnores();
ignoredSave('packages/.npmignore', 'unrelated.txt\n');
await assert.rejects(() => auditPublishedTemplateBinaries(ignoredProject), /from-middle\.pptx/);
rmSync(join(ignoredProject, 'packages/.npmignore'));

// 对照项目无生命周期脚本，即使宿主 npm 10 忽略 ignore-scripts 也无写入路径。
const expected = await checkIgnores();
const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--workspaces',
  '--include-workspace-root=false', '--cache', join(work, 'npm-cache')], { cwd: ignoredProject, encoding: 'utf8' }));
assert.deepEqual(packed.map(({ name, files }) => ({ name, files: files.map(({ path }) => path).sort() })).sort((a, b) => a.name.localeCompare(b.name)),
  expected.map(({ name, files }) => ({ name, files: [...files].sort() })).sort((a, b) => a.name.localeCompare(b.name)));
assert.ok(!readdirSync(ignoredProject, { recursive: true }).some((path) => path.endsWith('.tgz')));

// 真实安装目录中的 bundled dependency 也属于交付内容，不能仅审计 workspace 自身文件。
const bundledProject = mkdtempSync(join(work, 'bundled-'));
const bundledSave = (path, value) => save(path, value, bundledProject);
bundledSave('package.json', { name: 'publish-bundle-test', private: true, workspaces: ['packages/*'] });
const bundledManifest = { name: '@publish-audit/bundled', version: '1.0.0', files: ['index.js'],
  dependencies: { 'template-dependency': '1.0.0' }, bundleDependencies: ['template-dependency'] };
bundledSave('packages/public/package.json', bundledManifest);
bundledSave('packages/public/index.js', 'export const ready = true;\n');
bundledSave('packages/public/node_modules/template-dependency/package.json', { name: 'template-dependency', version: '1.0.0' });
bundledSave('packages/public/node_modules/template-dependency/index.js', 'module.exports = true;\n');
bundledSave('packages/public/node_modules/template-dependency/template.PPTX', binary);
bundledSave('packages/public/node_modules/template-dependency/.npmignore', 'template.PPTX\n');
await assert.rejects(() => auditPublishedTemplateBinaries(bundledProject), /@publish-audit\/bundled.*node_modules\/template-dependency\/template\.PPTX/);
bundledSave('packages/public/package.json', { ...bundledManifest, bundleDependencies: [] });
const unbundled = await auditPublishedTemplateBinaries(bundledProject);
assert.ok(unbundled[0].files.every((path) => !path.startsWith('node_modules/')), '普通依赖不能被误作 bundled 交付');
console.log('npm 正式文件清单：私有证据、祖先忽略继承、bundled 依赖、CLI 独立对照与生命周期零执行通过');
