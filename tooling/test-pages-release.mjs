import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const readYaml = (file) => parse(readFileSync(resolve(root, file), 'utf8'));
const pages = readYaml('.github/workflows/pages.yml');
const release = readYaml('.github/workflows/release.yml');
// 直接执行 workflow 内的信任判定，避免测试中的副本与真实部署条件分叉。
const source = pages.jobs.prepare.steps.find((step) => step.id === 'source').with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction('github', 'context', 'core', 'process', source);
let passed = 0;
const checks = [];
const run = async (options = {}) => {
  const trusted = {
    id: 42,
    repository: { id: 7 },
    head_repository: { id: 7 },
    event: 'push',
    head_branch: 'master',
    head_sha: 'abc',
    path: '.github/workflows/ci.yml',
    name: 'CI',
    status: 'completed',
    conclusion: 'success',
    ...options.run,
  };
  const artifacts = options.artifacts ?? [{ id: 1, name: 'site-dist', expired: false }];
  const outputs = {};
  const notices = [];
  const actions = {
    getWorkflowRun: async () => ({ data: trusted }),
    listWorkflowRunArtifacts: 'artifacts',
    listJobsForWorkflowRun: 'jobs',
  };
  const github = {
    rest: {
      actions,
      repos: {
        getBranch: async () => ({ data: { commit: { sha: options.head ?? 'abc' } } }),
      },
    },
    paginate: async (method) => {
      if (method === 'artifacts') return artifacts;
      if (method === 'jobs') return options.jobs ?? [];
      throw new Error(`未预期的分页请求: ${method}`);
    },
  };
  const context = {
    repo: { owner: 'owner', repo: 'repo' },
    eventName: options.manual ? 'workflow_dispatch' : 'workflow_run',
    payload: { repository: { id: 7 }, workflow_run: { id: options.input ?? 42 } },
  };
  const core = {
    setOutput: (key, value) => {
      outputs[key] = value;
    },
    notice: (text) => notices.push(text),
  };
  await execute(github, context, core, { env: { REQUESTED_RUN_ID: options.input ?? '42' } });
  return { outputs, notices };
};
const check = async (label, fn) => {
  await fn();
  passed++;
  checks.push(label);
};
await check('可信当前 push CI 部署', async () => {
  assert.deepEqual((await run()).outputs, { 'run-id': '42', 'artifact-id': '1', deploy: 'true' });
});
await check('main 与 master 都支持', async () => {
  assert.equal((await run({ run: { head_branch: 'main' } })).outputs.deploy, 'true');
});
for (const [label, patch] of [
  ['外部仓库', { repository: { id: 9 } }],
  ['fork 源分支', { head_repository: { id: 9 } }],
  ['源仓库缺失', { head_repository: null }],
  ['PR 事件', { event: 'pull_request' }],
  ['非可信分支', { head_branch: 'attacker' }],
  ['其他 workflow 路径', { path: '.github/workflows/other.yml' }],
  ['其他 workflow 名称', { name: 'fake CI' }],
  ['未完成', { status: 'in_progress' }],
  ['失败 CI', { conclusion: 'failure' }],
])
  await check(`拒绝${label}`, () => assert.rejects(run({ run: patch }), /必须是本仓库/));
for (const input of ['', '0', '-1', '1.5', '42;echo bad', '9007199254740993']) {
  await check(`拒绝无效 run_id ${input}`, () => assert.rejects(run({ manual: true, input }), /run_id/));
}
const docs = [
  { name: 'changes', conclusion: 'success' },
  { name: 'check', conclusion: 'success' },
  { name: 'build', conclusion: 'skipped' },
  { name: 'source', conclusion: 'skipped' },
];
await check('完整文档检查证据允许无产物跳过', async () => {
  assert.equal((await run({ artifacts: [], jobs: docs })).outputs.deploy, 'false');
});
await check('旧版完整 CI 缺产物不能当文档跳过', () =>
  assert.rejects(run({ artifacts: [], jobs: [{ name: 'check', conclusion: 'success' }] }), /site-dist/),
);
await check('运行过重测试的无产物 CI 不能当文档跳过', () =>
  assert.rejects(run({ artifacts: [], jobs: [...docs, { name: 'dist', conclusion: 'success' }] }), /site-dist/),
);
await check('手动缺产物明确失败', () => assert.rejects(run({ artifacts: [], manual: true }), /site-dist/));
await check('过期产物明确失败', () => assert.rejects(run({ artifacts: [{ id: 1, name: 'site-dist', expired: true }] }), /site-dist/));
await check('重复产物明确失败', () =>
  assert.rejects(
    run({
      artifacts: [
        { id: 1, name: 'site-dist' },
        { id: 2, name: 'site-dist' },
      ],
    }),
    /site-dist/,
  ),
);
await check('自动旧提交不覆盖新站点', async () => {
  assert.equal((await run({ head: 'new' })).outputs.deploy, 'false');
});
await check('手动允许历史可信产物重部署', async () => {
  assert.equal((await run({ head: 'new', manual: true })).outputs.deploy, 'true');
});
await check('下载精确 ID 且保持站点根目录', async () => {
  // 契约约束的是下载配置而不是 action 版本；版本由 dependabot 升级，写死会让每次升级误报。
  const download = pages.jobs.prepare.steps.find((step) => step.uses?.startsWith('actions/download-artifact@'));
  assert.ok(download, 'pages.yml 的 prepare 任务缺少 download-artifact 步骤');
  assert.equal(download.with['merge-multiple'], true);
  assert.equal(download.with.path, 'site');
  assert.ok(download.with['artifact-ids']);
  assert.ok(download.with['run-id']);
});
await check('发布 gate 早于安装与 Python，字体仍常备', async () => {
  const steps = release.jobs.publish.steps;
  const gate = steps.findIndex((step) => step.id === 'gate');
  const npm = steps.findIndex((step) => step.run?.startsWith('npm ci'));
  const python = steps.findIndex((step) => step.uses?.startsWith('actions/setup-python@'));
  assert.ok(gate >= 0 && gate < npm && gate < python);
  assert.equal(steps.find((step) => step.name === '安装中文字体').if, undefined);
  assert.equal(steps.find((step) => step.name === '安装图元真实样本依赖').if, "steps.gate.outputs.ci-green != 'green'");
  assert.equal(steps.filter((step) => step.run === 'npm run test:functional').length, 1);
});
const output = resolve(root, 'out/pages-release');
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'validation.json'), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
console.log(`Pages 信任边界与发布准备契约：${passed} 项通过`);
