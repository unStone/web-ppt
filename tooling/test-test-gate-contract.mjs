import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

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
for (const workflow of ['ci.yml', 'release.yml']) {
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
// 官网是独立流水线；凡运行 PDF 独立读取的入口，都必须先安装同一份固定依赖。
const workflows = resolve(root, '.github/workflows');
for (const workflow of readdirSync(workflows).filter(name => /\.ya?ml$/.test(name))) {
  const source = readFileSync(resolve(workflows, workflow), 'utf8');
  const test = source.search(/run:.*(?:npm run (?:test:functional|test:site:i18n|verify)|node tooling\/test-site-i18n-static\.mjs)/);
  if (test < 0) continue;
  const setup = source.indexOf('uses: actions/setup-python@');
  const install = source.indexOf('run: python3 -m pip install --target out/font-glyphs/python -r tooling/font-glyph-requirements.txt');
  assert.ok(setup >= 0 && install > setup && install < test,
    `${workflow} 的 PDF 验证必须先准备 Python 和固定字体 / PDF 依赖`);
}
console.log('测试门禁唯一入口：本地、PR CI 与发布流水线编排一致');
