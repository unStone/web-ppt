import { SOURCE_GROUPS, DIST_GROUPS } from '../ci/plan.mjs';

const workflowPath = '.github/workflows/ci.yml';
const legacySteps = [
  '类型检查',
  '重新生成测试文件',
  '校验固件确定性',
  '全量功能测试',
  '浏览器 DOM 编辑层性能采样',
  '保存产物外部打开测试',
  '0.7 统一清单外部打开测试',
  'OLE 嵌入文档外部打开测试',
  '编辑性能预算',
  '构建',
  '官网双语生产回归',
  '跨产物一致性',
];
const modernJobs = [
  'changes',
  'build',
  'editing',
  'browser',
  'verify',
  'site',
  'office',
  'performance',
  'check',
  ...SOURCE_GROUPS.filter((group) => !['editing', 'browser'].includes(group)).map((group) => `source (${group})`),
  ...DIST_GROUPS.filter((group) => group !== 'base').map((group) => `dist (${group})`),
];
const succeeded = (item) => item?.status === 'completed' && item.conclusion === 'success';
const full = (reason) => ({ result: 'full', reason });

function hasRunIdentity(run, { repository, sha }) {
  return (
    run?.name === 'CI'
    && run.event === 'push'
    && ['master', 'main'].includes(run.head_branch)
    && run.head_sha === sha
    && run.path === workflowPath
    && run.repository?.full_name === repository
    && run.head_repository?.full_name === repository
    && Number.isSafeInteger(run.id)
    && run.id > 0
    && typeof run.created_at === 'string'
    && Number.isFinite(Date.parse(run.created_at))
  );
}

export function selectLatestPushCI(runs, identity) {
  if (!Array.isArray(runs)) throw new Error('GitHub workflow_runs 必须是数组');
  return (
    runs
      .filter((run) => hasRunIdentity(run, identity))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0] ?? null
  );
}

function missingStep(job, names) {
  if (!Array.isArray(job.steps)) return `${job.name} 缺少 step 证据`;
  for (const name of names) {
    const matches = job.steps.filter((step) => step.name === name);
    if (matches.length !== 1 || !succeeded(matches[0])) return `${job.name} 的 ${name} 未完整成功`;
  }
  return null;
}

export function evaluateCITrust({ run, jobs, ...identity }) {
  if (!hasRunIdentity(run, identity)) return full('CI 运行的仓库、提交、事件、分支或 workflow 身份不符');
  if (!succeeded(run)) return full(`run ${run.id} 未完成成功（${run.status} / ${run.conclusion}）`);
  if (!Array.isArray(jobs) || jobs.length === 0) return full(`run ${run.id} 没有完整 job 证据`);
  const byName = new Map();
  for (const job of jobs) {
    if (!job || typeof job.name !== 'string' || byName.has(job.name)) return full('CI job 名称为空或重复');
    if (job.run_id !== run.id || job.head_sha !== identity.sha) return full(`job ${job.name} 不属于目标运行与提交`);
    if (!succeeded(job)) return full(`job ${job.name} 未完成成功（${job.status} / ${job.conclusion}）`);
    byName.set(job.name, job);
  }
  if (jobs.length === 1 && byName.has('check')) {
    const problem = missingStep(byName.get('check'), legacySteps);
    return problem ? full(problem) : { result: 'green', reason: `旧 CI run ${run.id} 的全部必要 step 已成功` };
  }
  for (const name of modernJobs) {
    if (!byName.has(name)) return full(`现代 CI 缺少必要 job：${name}`);
  }
  // 文档运行的 check 也会成功；只有执行计划合并成功才能证明所有套件真正执行。
  const problem = missingStep(byName.get('check'), ['核对全部门禁结论', '核对全部执行计划']);
  return problem ? full(problem) : { result: 'green', reason: `CI run ${run.id} 的完整 job 与执行计划已成功` };
}

export async function readGitHubCIPages({ repository, token, endpoint, field, request = fetch }) {
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const response = await request(`https://api.github.com/repos/${repository}/${endpoint}&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${field} 查询返回 HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body[field]) || !Number.isSafeInteger(body.total_count) || body.total_count < 0) {
      throw new Error(`${field} 查询响应缺少完整列表或 total_count`);
    }
    items.push(...body[field]);
    if (items.length === body.total_count) return items;
    if (items.length > body.total_count || body[field].length < 100) throw new Error(`${field} 分页结果不完整或在查询时发生变化`);
  }
  throw new Error(`${field} 超过 1000 项，无法验证全部运行证据`);
}
