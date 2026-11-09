import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync,
  readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'out/ci-performance');
const summaries = join(root, '.turbo/runs');
const launcher = join(root, 'tooling/build.mjs');
const packages = ['core', 'edit-core', 'viewer-core', 'editor', 'react', 'vue', 'fonts', 'collab', 'agent-mcp'];
const proofs = ['agent-describe', 'agent-tools', 'agent-mcp']
  .map(name => `out/${name}/default-entry-proof.json`);
mkdirSync(output, { recursive: true });
mkdirSync(summaries, { recursive: true });

function dry(env = process.env) {
  const result = JSON.parse(execFileSync(process.execPath, [launcher, '--dry=json'], {
    cwd: root, encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024,
  }));
  assert.equal(result.tasks.length, 1, '只缓存原有完整串行构建任务');
  assert.equal(result.tasks[0].taskId, '//#build:packages');
  return result.tasks[0];
}

const initial = dry();
const tracked = execFileSync('git', ['ls-files', '-z', '--', 'packages', 'tooling', 'tsconfig.base.json'], {
  cwd: root, encoding: 'utf8',
}).split('\0').filter(Boolean);
for (const file of tracked) {
  if (!/^(?:tooling\/|tsconfig\.base\.json$|packages\/[^/]+\/(?:src\/|schemas\/|skills\/|[^/]+\.(?:ts|json|html)$))/.test(file)) continue;
  assert.ok(file in initial.inputs, `构建输入遗漏：${file}`);
}
for (const file of Object.keys(initial.inputs)) {
  assert.doesNotMatch(file, /^(?:out|\.tmp|\.turbo|node_modules)\/|\/dist\//, `生成文件不能使缓存自动失效：${file}`);
}
assert.notEqual(initial.hash, dry({ ...process.env, NODE_ENV: '__build_cache_invalidation__' }).hash,
  '实际构建环境发生变化时必须使缓存失效');
assert.notEqual(initial.hash, dry({
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, '--stack-trace-limit=97'].filter(Boolean).join(' '),
}).hash, 'Node 运行选项发生变化时必须使缓存失效');

const runs = [];
function build(name, force = false) {
  const previous = new Set(readdirSync(summaries));
  const log = join(output, `build-after-${name}.log`);
  const descriptor = openSync(log, 'w');
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const result = spawnSync(process.execPath, [launcher, '--summarize', ...(force ? ['--force'] : [])], {
    cwd: root, stdio: ['ignore', descriptor, descriptor],
  });
  closeSync(descriptor);
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `构建 ${name} 失败；日志：${log}`);
  const added = readdirSync(summaries).filter(file => !previous.has(file) && file.endsWith('.json'));
  assert.equal(added.length, 1, `构建 ${name} 必须生成一份运行摘要`);
  const summary = JSON.parse(readFileSync(join(summaries, added[0]), 'utf8'));
  assert.equal(summary.tasks.length, 1);
  const task = summary.tasks[0];
  const run = { name, startedAt, elapsedMs: performance.now() - start, cache: task.cache.status, hash: task.hash, log: relative(root, log) };
  runs.push(run);
  writeFileSync(join(output, 'build-after.json'), `${JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, runs }, null, 2)}\n`);
  console.log(JSON.stringify(run));
  return task;
}

function snapshot() {
  const hashes = {};
  function collect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) collect(file);
      else hashes[relative(root, file)] = createHash('sha256').update(readFileSync(file)).digest('hex');
    }
  }
  for (const name of packages) collect(join(root, 'packages', name, 'dist'));
  for (const proof of proofs) hashes[proof] = createHash('sha256').update(readFileSync(join(root, proof))).digest('hex');
  return hashes;
}

build('cold', true);
const expected = snapshot();
assert.equal(build('warm').cache.status, 'HIT', '连续构建必须命中缓存');
assert.deepEqual(snapshot(), expected, '连续构建的全部产物必须逐字节一致');

// 仅改动生成产物，验证缓存命中会恢复文件，而非只重放成功日志。
appendFileSync(join(root, 'packages/core/dist/core.js'), '\ninvalid cached output\n');
writeFileSync(join(root, 'packages/core/dist/stale.js'), 'export const stale = true;\n');
writeFileSync(join(root, 'packages/edit-core/dist/stale.d.ts'), 'export declare const stale: true;\n');
writeFileSync(join(root, proofs[0]), '{"expired":true}\n');
const damaged = snapshot();
dry();
assert.deepEqual(snapshot(), damaged, 'dry-run 不得清理或恢复已有产物');
execFileSync(process.execPath, [launcher, '--help'], { cwd: root, stdio: 'pipe' });
assert.deepEqual(snapshot(), damaged, 'help 不得清理或恢复已有产物');
const invalid = spawnSync(process.execPath, [launcher, '--unknown-build-option'], { cwd: root, encoding: 'utf8' });
assert.notEqual(invalid.status, 0, '未知参数必须在清理产物前失败');
assert.match(invalid.stderr, /构建参数不受支持/);
assert.deepEqual(snapshot(), damaged, '无效参数不得清理或恢复已有产物');
rmSync(join(root, 'packages/agent-mcp/dist'), { recursive: true });
for (const proof of proofs.slice(1)) {
  assert.ok(existsSync(join(root, proof)), `缺少独立入口证明：${proof}`);
  rmSync(join(root, proof));
}
assert.equal(build('restore').cache.status, 'HIT', '删除或篡改输出时仍应从缓存恢复');
assert.deepEqual(snapshot(), expected, '全部九包产物和独立入口证明必须从缓存逐字节恢复');
console.log('构建缓存通过：完整输入、环境失效、连续命中、只读参数与完整输出恢复');
