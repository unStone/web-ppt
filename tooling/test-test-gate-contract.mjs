import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPlan, shardCountForLeaf } from './ci/plan.mjs';

const root = resolve(import.meta.dirname, '..');
const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts;
assert.equal(
  scripts.test,
  'npm run test:functional && npm run test:editor:performance',
  '本地完整测试必须复用唯一功能门禁，并额外执行性能门禁',
);
assert.match(
  scripts['test:functional'],
  /test-v07-integration\.mjs/,
  '唯一功能门禁必须包含 0.7 集成行为契约',
);
for (const phase of ['source', 'dist']) {
  const plan = createPlan(scripts, phase);
  const assigned = Object.values(plan.groups).flat();
  for (const leaf of plan.leaves) {
    assert.equal(assigned.filter((command) => command.id === leaf.id).length, shardCountForLeaf(leaf, phase),
      `${phase} 唯一门禁命令必须完整进入 CI：${leaf.command}`);
  }
}
const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
for (const command of ['run-group.mjs source', 'run-group.mjs dist', 'merge-results.mjs source', 'merge-results.mjs all']) {
  assert.ok(ci.includes(`tooling/ci/${command}`), `CI 必须接入唯一门禁编排：${command}`);
}
for (const command of [
  'node tooling/test-edit-libreoffice-all.mjs --site-only',
  'node tooling/test-v07-libreoffice-all.mjs',
  'node tooling/ci/run-group.mjs external office',
]) {
  assert.equal(ci.split(`run: ${command}\n`).length - 1, 1,
    `CI 必须且只能执行一次外部软件门禁：${command}`);
}
assert.equal(scripts['test:ci:office'],
  'node tooling/test-edit-libreoffice-all.mjs && node tooling/test-ole-edit-libreoffice.mjs',
  '外部软件门禁必须保留完整模型清单及 OLE 嵌入文档真实打开');
for (const workflow of ['release.yml']) {
  const source = readFileSync(resolve(root, '.github/workflows', workflow), 'utf8');
  assert.equal(
    source.match(/run: npm run test:functional/g)?.length,
    1,
    `${workflow} 必须且只能执行一次唯一功能门禁`,
  );
  assert.match(
    source,
    /continue-on-error: true\n\s+run: npm run test:editor:performance/,
    `${workflow} 必须单独保留可观测的 beta 性能采样`,
  );
}
assert.match(ci, /continue-on-error: true\n\s+run: npm run test:editor:performance/,
  'CI 必须单独保留可观测的 beta 性能采样');
const setupAction = readFileSync(resolve(root, '.github/actions/setup/action.yml'), 'utf8');
assert.ok(setupAction.includes('uses: actions/setup-python@')
  && setupAction.includes('run: python3 -m pip install --target out/font-glyphs/python -r tooling/font-glyph-requirements.txt'),
'CI 共享环境必须安装固定字体 / PDF 依赖');
// 独立调用完整门禁的流水线仍须自行准备 PDF 读取依赖。
const workflows = resolve(root, '.github/workflows');
for (const workflow of readdirSync(workflows).filter(name => name !== 'ci.yml' && /\.ya?ml$/.test(name))) {
  const source = readFileSync(resolve(workflows, workflow), 'utf8');
  const test = source.search(/run:.*(?:npm run (?:test:functional|test:site:i18n|verify)|node tooling\/test-site-i18n-static\.mjs)/);
  if (test < 0) continue;
  const setup = source.indexOf('uses: actions/setup-python@');
  const install = source.indexOf('run: python3 -m pip install --target out/font-glyphs/python -r tooling/font-glyph-requirements.txt');
  assert.ok(setup >= 0 && install > setup && install < test,
    `${workflow} 的 PDF 验证必须先准备 Python 和固定字体 / PDF 依赖`);
}
execFileSync(process.execPath, [resolve(root, 'tooling/ci/test.mjs')], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [resolve(root, 'tooling/test-ci-trust.mjs')], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [resolve(root, 'tooling/test-edit-office-selection.mjs')], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [resolve(root, 'tooling/test-pages-release.mjs')], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [resolve(root, 'tooling/test-release-pack.mjs')], { cwd: root, stdio: 'inherit' });
console.log('测试门禁唯一入口：本地、PR CI 与发布流水线编排一致');
