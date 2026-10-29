#!/usr/bin/env node
/**
 * 发布门禁信任判定：查询指定 commit 上 CI workflow 的结论。
 *
 * release 流水线曾把 CI 在同一 commit 上已全量跑过的门禁（check / test:functional /
 * 性能采样 / bench，0.5.0 实测约 34 分钟）原样重跑一遍才发布。本脚本让 release 在
 * 「目标 commit 已有绿色的 push CI」时跳过这些重复门禁，只保留发布必需的步骤
 * （tag 校验、首发引导校验、fixtures、build、verify 与发布本身）。
 *
 * 任何拿不到绿色结论的情况——查无 run、run 未完成、结论非 success、API 请求失败——
 * 一律输出 full：宁可多跑半小时，不发布未经门禁验证的提交。
 */
import { appendFileSync } from 'node:fs';

const usage = '用法: node tooling/check-ci-green.mjs [--sha <commit>]';

const args = process.argv.slice(2);
let sha = process.env.GITHUB_SHA ?? '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--sha') sha = args[++i];
  else throw new Error(`未知参数 ${args[i]}；${usage}`);
}
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`需要 40 位 commit SHA（--sha 或 GITHUB_TOKEN 同级的 GITHUB_SHA），收到：${sha || '(空)'}`);

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

const full = (reason) => conclude('full', reason);

let response;
try {
  // API 失败（网络、限流）按 full 处理；限流时不该让发布流水线红掉
  response = await fetch(
    `https://api.github.com/repos/${repository}/actions/runs?head_sha=${sha}&per_page=100`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
  );
} catch (error) {
  full(`查询 CI 状态的网络请求失败：${error.message}`);
  process.exit(0);
}
if (response.status !== 200) {
  full(`查询 CI 状态返回 HTTP ${response.status}`);
  process.exit(0);
}

const { workflow_runs: runs } = await response.json();
// 只认 push 事件触发的 CI：tag 打在 master 提交上，对应的门禁就是那次 push CI；
// 同 SHA 可能还有别的 workflow 或事件的 run，不能拿它们顶替
const ciRuns = runs
  .filter((run) => run.name === 'CI' && run.event === 'push')
  .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
if (ciRuns.length === 0) {
  full('该 commit 没有 push CI 记录（tag 打在未推送过 master 的提交上？）');
  process.exit(0);
}
const latest = ciRuns[0];
if (latest.status !== 'completed') {
  full(`该 commit 的 CI 尚未完成（status: ${latest.status}）`);
  process.exit(0);
}
if (latest.conclusion !== 'success') {
  full(`该 commit 的 CI 结论是 ${latest.conclusion}`);
  process.exit(0);
}
conclude('green', `run ${latest.id} 于 ${latest.updated_at} 成功`);
