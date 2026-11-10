import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { digest, groupPlan } from './plan.mjs';
import { readJson, resultDirectory, revisionAt, writeJson } from './results.mjs';

export function runGroup({ root, scripts, phase, group, revision = revisionAt(root), runId = process.env.GITHUB_RUN_ID ?? null }) {
  const plan = groupPlan(scripts, phase, group);
  const directory = resultDirectory(root, phase, group);
  const countsFile = join(directory, 'counts.json');
  const mergedCounts = join(root, 'out/verify/counts.json');
  let initialCounts = {};
  if (phase === 'dist' && group === 'base') {
    if (!existsSync(mergedCounts)) throw new Error('dist/base 必须先下载并合并本轮全部源码分组计数');
    initialCounts = readJson(mergedCounts);
  }
  rmSync(directory, { recursive: true, force: true });
  writeJson(join(directory, 'plan.json'), plan);
  writeJson(countsFile, initialCounts);
  const result = {
    version: 1,
    phase,
    group,
    revision,
    planDigest: digest(plan),
    runId,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    status: 'running',
    commands: [],
    startedAt: new Date().toISOString(),
  };
  const started = performance.now();
  for (const leaf of plan.commands) {
    console.log(`\n[${phase}/${group} ${result.commands.length + 1}/${plan.commands.length}] ${leaf.command}`);
    const before = performance.now();
    const child = spawnSync(leaf.executable, leaf.args, {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        WEB_PPT_COUNTS_FILE: countsFile,
        WEB_PPT_EQUIVALENCE_REPORT: join(directory, 'equivalence.json'),
        WEB_PPT_MIGRATION_REPORT: join(directory, 'migration.json'),
      },
    });
    result.commands.push({
      id: leaf.id,
      command: leaf.command,
      durationMs: performance.now() - before,
      status: child.status === 0 && !child.error ? 'success' : 'failure',
      exitCode: child.status,
      signal: child.signal,
    });
    result.durationMs = performance.now() - started;
    result.countsDigest = digest(readJson(countsFile));
    if (child.status !== 0 || child.error) {
      result.status = 'failure';
      writeJson(join(directory, 'result.json'), result);
      throw child.error ?? new Error(`CI 命令失败（exit=${child.status}, signal=${child.signal}）：${leaf.command}`);
    }
    writeJson(join(directory, 'result.json'), result);
  }
  result.status = 'success';
  result.durationMs = performance.now() - started;
  result.countsDigest = digest(readJson(countsFile));
  writeJson(join(directory, 'result.json'), result);
  console.log(`\n${phase}/${group}：${result.commands.length} 条命令通过，${(result.durationMs / 1000).toFixed(1)} 秒`);
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = resolve(import.meta.dirname, '../..');
  const [phase, group, ...unknown] = process.argv.slice(2);
  if (unknown.length) throw new Error(`未知 CI 参数：${unknown.join(' ')}`);
  runGroup({ root, scripts: readJson(join(root, 'package.json')).scripts, phase, group });
}
