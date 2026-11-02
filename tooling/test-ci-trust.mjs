import assert from 'node:assert/strict';
import { selectLatestPushCI, evaluateCITrust, readGitHubCIPages } from './lib/ci-trust.mjs';
import { SOURCE_GROUPS, DIST_GROUPS } from './ci/plan.mjs';

const repository = 'unStone/web-ppt';
const sha = 'f0f7a15e8a68669878359f2c26071c79ddad537d';
const identity = { repository, sha };
const run = {
  id: 41370894820, name: 'CI', event: 'push', head_branch: 'master', head_sha: sha,
  path: '.github/workflows/ci.yml', repository: { full_name: repository },
  head_repository: { full_name: repository }, created_at: '2026-11-02T01:08:45Z',
  updated_at: '2026-11-02T01:50:27Z', status: 'completed', conclusion: 'success',
};
const step = name => ({ name, status: 'completed', conclusion: 'success' });
const job = (name, steps = []) => ({
  name, run_id: run.id, head_sha: sha, status: 'completed', conclusion: 'success', steps,
});
const legacy = [job('check', [
  '类型检查', '重新生成测试文件', '校验固件确定性', '全量功能测试',
  '浏览器 DOM 编辑层性能采样', '保存产物外部打开测试', '0.7 统一清单外部打开测试',
  'OLE 嵌入文档外部打开测试', '编辑性能预算', '构建', '官网双语生产回归', '跨产物一致性',
].map(step))];
const modern = [
  ...['changes', 'build', 'editing', 'browser', 'verify', 'site', 'office', 'performance'].map(name => job(name)),
  ...SOURCE_GROUPS.filter(group => !['editing', 'browser'].includes(group))
    .map(group => job(`source (${group})`)),
  ...DIST_GROUPS.filter(group => group !== 'base').map(group => job(`dist (${group})`)),
  job('check', [step('核对全部门禁结论'), step('核对全部执行计划')]),
];
const evaluate = (jobs, candidate = run) => evaluateCITrust({ ...identity, run: candidate, jobs });
const full = (jobs, candidate = run) => assert.equal(evaluate(jobs, candidate).result, 'full');

assert.equal(evaluate(legacy).result, 'green', '旧 CI 的完整原始 steps 保持可信');
assert.equal(evaluate(modern).result, 'green', '现代 CI 的完整 job 和执行计划保持可信');
assert.equal(evaluate(modern, { ...run, head_branch: 'main' }).result, 'green');
assert.equal(selectLatestPushCI([run], identity), run);

for (const change of [
  { event: 'pull_request' }, { event: 'workflow_dispatch' }, { head_branch: 'feature' },
  { head_sha: '0'.repeat(40) }, { name: 'CI-copy' }, { path: '.github/workflows/copied-ci.yml' },
  { repository: { full_name: 'other/web-ppt' } }, { head_repository: { full_name: 'fork/web-ppt' } },
  { repository: null }, { head_repository: null }, { created_at: null },
]) {
  const wrong = { ...run, ...change };
  assert.equal(selectLatestPushCI([wrong], identity), null, `拒绝异源 CI：${JSON.stringify(change)}`);
  full(modern, wrong);
}
const newer = { ...run, id: run.id + 1, created_at: '2026-11-02T02:00:00Z', status: 'in_progress', conclusion: null };
assert.equal(selectLatestPushCI([run, newer], identity), newer, '不得越过最新未完成 run 复用旧绿色');
full(modern, newer);
const sameTime = { ...run, id: run.id + 1 };
assert.equal(selectLatestPushCI([run, sameTime], identity), sameTime, '相同时间戳按 run id 确定最新');
assert.equal(selectLatestPushCI([newer, { ...run, event: 'pull_request' }], identity), newer);
assert.equal(selectLatestPushCI([], identity), null);

for (const state of ['failure', 'skipped', 'cancelled', 'neutral', null]) {
  full(modern, { ...run, conclusion: state });
  for (const jobs of [legacy, modern]) {
    const changed = structuredClone(jobs);
    changed[0].conclusion = state;
    full(changed);
  }
}
for (const state of ['queued', 'in_progress', 'waiting', null]) {
  full(modern, { ...run, status: state });
  const changed = structuredClone(modern);
  changed[0].status = state;
  full(changed);
}
for (let index = 0; index < modern.length; index++) {
  full(modern.filter((_, position) => position !== index));
  const changed = structuredClone(modern);
  changed[index].conclusion = 'skipped';
  full(changed);
}
const documentation = modern.map(item => item.name === 'changes' || item.name === 'check'
  ? item : { ...item, conclusion: 'skipped' });
full(documentation, run);
full([job('check', [step('核对全部门禁结论')])], run);
full([...modern, job('future-check', [])].map(item => item.name === 'future-check' ? { ...item, conclusion: 'failure' } : item));
full([...modern, job('build')]);
for (const field of ['run_id', 'head_sha']) {
  const changed = structuredClone(modern);
  changed[0][field] = field === 'run_id' ? run.id + 1 : '0'.repeat(40);
  full(changed);
}
for (const name of ['核对全部门禁结论', '核对全部执行计划']) {
  const changed = structuredClone(modern);
  changed.at(-1).steps = changed.at(-1).steps.filter(item => item.name !== name);
  full(changed);
}
for (let index = 0; index < legacy[0].steps.length; index++) {
  const changed = structuredClone(legacy);
  changed[0].steps[index].conclusion = 'skipped';
  full(changed);
  changed[0].steps.splice(index, 1);
  full(changed);
}

const requests = [];
const jobsAcrossPages = Array.from({ length: 101 }, (_, id) => ({ id }));
const paginated = await readGitHubCIPages({
  repository, token: 'test-token', endpoint: `actions/runs/${run.id}/jobs?filter=latest`, field: 'jobs',
  request: async (url, options) => {
    const page = Number(new URL(url).searchParams.get('page'));
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(new URL(url).searchParams.get('filter'), 'latest');
    requests.push(page);
    return Response.json({ total_count: 101, jobs: jobsAcrossPages.slice((page - 1) * 100, page * 100) });
  },
});
assert.deepEqual(requests, [1, 2]);
assert.deepEqual(paginated, jobsAcrossPages, '信任判定必须包含后续分页中的 job');
const readResponse = response => readGitHubCIPages({
  repository, token: 'test-token', endpoint: `actions/runs?head_sha=${sha}`, field: 'workflow_runs',
  request: async () => response,
});
assert.deepEqual(await readResponse(Response.json({ total_count: 0, workflow_runs: [] })), []);
for (const status of [401, 403, 404, 429, 500]) {
  await assert.rejects(readResponse(new Response('', { status })), new RegExp(`HTTP ${status}`));
}
for (const payload of [
  {}, { total_count: 1, workflow_runs: [] }, { total_count: 0, workflow_runs: [run] },
  { total_count: -1, workflow_runs: [] }, { total_count: '1', workflow_runs: [run] },
]) await assert.rejects(readResponse(Response.json(payload)), /完整|变化/);
await assert.rejects(readResponse(new Response('{invalid')), SyntaxError);
await assert.rejects(readGitHubCIPages({
  repository, token: 'test-token', endpoint: 'actions/runs?event=push', field: 'workflow_runs',
  request: async () => { throw new Error('network unavailable'); },
}), /network unavailable/);
console.log('发布 CI 信任链：运行身份、最新记录、文档跳过、完整 job/step、分页及 API 故障边界全部通过');
