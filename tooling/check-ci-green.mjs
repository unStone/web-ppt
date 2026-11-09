#!/usr/bin/env node
// 文档 CI 的 workflow 也会成功，发布只能复用同提交上完整执行过的可信门禁。
import { appendFileSync } from 'node:fs';
import { selectLatestPushCI, evaluateCITrust, readGitHubCIPages } from './lib/ci-trust.mjs';

const usage = '用法: node tooling/check-ci-green.mjs [--sha <commit>]';

const args = process.argv.slice(2);
let sha = process.env.GITHUB_SHA ?? '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--sha') sha = args[++i];
  else throw new Error(`未知参数 ${args[i]}；${usage}`);
}
if (!/^[0-9a-f]{40}$/.test(sha))
  throw new Error(`需要 40 位 commit SHA（--sha 或 GITHUB_TOKEN 同级的 GITHUB_SHA），收到：${sha || '(空)'}`);

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
if (!repository || !token) {
  throw new Error(`缺少 GITHUB_REPOSITORY / GH_TOKEN 环境变量；本地验证可用 GH_TOKEN=$(gh auth token) 传入`);
}

/** 输出结论给 workflow 的 if 条件用；green = 可跳过已验证门禁，full = 照旧全量跑 */
const conclude = (result, reason) => {
  console.log(`门禁信任判定：${result}${reason ? `（${reason}）` : ''}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `ci-green=${result}\n`);
  }
};

const readPages = (endpoint, field) => readGitHubCIPages({ repository, token, endpoint, field });

let decision;
try {
  const runs = await readPages(`actions/runs?head_sha=${sha}`, 'workflow_runs');
  const latest = selectLatestPushCI(runs, { repository, sha });
  if (!latest) decision = { result: 'full', reason: '该提交没有本仓库 master/main 的可信 push CI' };
  else if (latest.status !== 'completed' || latest.conclusion !== 'success') {
    decision = { result: 'full', reason: `最新 CI run ${latest.id} 未完成成功（${latest.status} / ${latest.conclusion}）` };
  } else {
    // latest 排除重跑前已被替代的失败 job；各分组最新证据仍须全部成功。
    const jobs = await readPages(`actions/runs/${latest.id}/jobs?filter=latest`, 'jobs');
    decision = evaluateCITrust({ repository, sha, run: latest, jobs });
  }
} catch (error) {
  // API 无法证明完整门禁时恢复为发布流水线的全量验证路径。
  decision = { result: 'full', reason: `无法验证完整 CI 证据：${error.message}` };
}
conclude(decision.result, decision.reason);
