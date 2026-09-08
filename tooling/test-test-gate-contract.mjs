import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
console.log('测试门禁唯一入口：本地、PR CI 与发布流水线编排一致');
