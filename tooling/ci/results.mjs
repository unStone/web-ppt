import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { digest, groupPlan, groupsForPhase, partitionFixtures, EQUIVALENCE_SHARDS } from './plan.mjs';
import { expectedCountKeys } from './count-claims.mjs';
import { readMigrationCaseNames } from './migration-cases.mjs';
import { MIGRATION_SHARDS, MIGRATION_SCRIPT, selectMigrationCases } from './migration-shards.mjs';

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
export function revisionAt(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}
export function fixtureNames(root) {
  return readdirSync(join(root, 'fixtures'))
    .filter((name) => /\.(?:pptx|ppt)$/i.test(name))
    .sort();
}
export function resultDirectory(root, phase, group) {
  return join(root, 'out/ci-results', `${phase}-${group}`);
}

function validateCounts(counts, label) {
  if (!counts || Array.isArray(counts) || typeof counts !== 'object') throw new Error(`${label} 计数必须是对象`);
  for (const [key, value] of Object.entries(counts)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} 的 ${key} 计数无效：${value}`);
  }
}

export function mergeResults({
  root,
  scripts,
  phase,
  revision = revisionAt(root),
  fixtures = fixtureNames(root),
  runId = process.env.GITHUB_RUN_ID ?? null,
}) {
  const phases = phase === 'all' ? ['source', 'dist', 'external'] : phase === 'source' ? ['source', 'external'] : [phase];
  const ordinary = [];
  const equivalence = [];
  const summaries = [];
  let migrationCases;
  for (const current of phases)
    for (const group of groupsForPhase(current)) {
      const directory = resultDirectory(root, current, group);
      for (const file of ['plan.json', 'result.json', 'counts.json']) {
        if (!existsSync(join(directory, file))) throw new Error(`CI 分组 ${current}/${group} 缺少 ${file}`);
      }
      const expected = groupPlan(scripts, current, group);
      const plan = readJson(join(directory, 'plan.json'));
      const result = readJson(join(directory, 'result.json'));
      const counts = readJson(join(directory, 'counts.json'));
      validateCounts(counts, `${current}/${group}`);
      if (digest(plan) !== digest(expected)) throw new Error(`CI 分组 ${current}/${group} 的执行计划与当前唯一入口不一致`);
      if (
        result.version !== 1
        || result.phase !== current
        || result.group !== group
        || result.revision !== revision
        || result.runId !== runId
        || result.planDigest !== digest(expected)
        || result.status !== 'success'
        || !Number.isFinite(result.durationMs)
        || result.durationMs < 0
      ) {
        throw new Error(`CI 分组 ${current}/${group} 未成功执行当前提交 ${revision} 的完整计划`);
      }
      if (result.countsDigest !== digest(counts)) throw new Error(`CI 分组 ${current}/${group} 的计数丢失或被改写`);
      if (current === 'source' || current === 'external') {
        const missing = expectedCountKeys(root, expected.commands).filter((key) => !Object.hasOwn(counts, key));
        if (missing.length) throw new Error(`CI 分组 ${current}/${group} 缺少源码声明的计数：${missing.join(', ')}`);
      }
      if (
        !Array.isArray(result.commands)
        || result.commands.length !== expected.commands.length
        || result.commands.some(
          (command, index) =>
            command.id !== expected.commands[index].id
            || command.command !== expected.commands[index].command
            || command.status !== 'success'
            || !Number.isFinite(command.durationMs)
            || command.durationMs < 0,
        )
      ) {
        throw new Error(`CI 分组 ${current}/${group} 的命令缺失、重复、乱序或失败`);
      }
      if (group.startsWith('migration-')) {
        const receiptFile = join(directory, 'migration.json');
        if (!existsSync(receiptFile)) throw new Error(`CI 分组 ${current}/${group} 缺少迁移用例覆盖证据`);
        migrationCases ??= readMigrationCaseNames(join(root, MIGRATION_SCRIPT));
        const index = Number(group.slice('migration-'.length));
        const selected = selectMigrationCases(migrationCases, index, MIGRATION_SHARDS);
        const receipt = readJson(receiptFile);
        if (
          receipt.version !== 1
          || receipt.mode !== current
          || receipt.index !== index
          || receipt.total !== MIGRATION_SHARDS
          || digest(receipt.cases) !== digest(selected)
          || !Array.isArray(receipt.results)
          || receipt.results.length !== selected.length
          || receipt.results.some((item, position) => item.name !== selected[position] || item.exitCode !== 0 || item.signal || item.error)
        ) {
          throw new Error(`CI 分组 ${current}/${group} 的迁移用例覆盖重复、缺失、错误或未成功`);
        }
      }
      if (group.startsWith('equivalence-')) {
        const evidenceFile = join(directory, 'equivalence.json');
        if (!existsSync(evidenceFile)) throw new Error(`CI 分组 ${current}/${group} 缺少固件覆盖证据`);
        const evidence = readJson(evidenceFile);
        const index = Number(group.slice('equivalence-'.length));
        const selected = partitionFixtures(fixtures, index, EQUIVALENCE_SHARDS);
        if (
          digest(evidence.fixtures) !== digest(selected)
          || evidence.index !== index
          || evidence.total !== EQUIVALENCE_SHARDS
          || counts.fixtures !== selected.length
          || evidence.svgCount !== counts.equivalence
          || !Number.isInteger(counts.equivalence)
          || counts.equivalence < 1
        ) {
          throw new Error(`CI 分组 ${current}/${group} 的固件覆盖或计数不完整`);
        }
        equivalence.push(counts);
      } else ordinary.push(counts);
      summaries.push({ phase: current, group, durationMs: result.durationMs, commands: result.commands.length });
    }
  const merged = {};
  if (equivalence.length) {
    if (equivalence.length !== EQUIVALENCE_SHARDS) throw new Error('独立进程等价门禁缺少分片');
    for (const key of ['fixtures', 'equivalence']) merged[key] = equivalence.reduce((sum, counts) => sum + counts[key], 0);
    for (const counts of equivalence) {
      const unexpected = Object.keys(counts).filter((key) => !['fixtures', 'equivalence'].includes(key));
      if (unexpected.length) throw new Error(`等价分片出现不应求和的计数：${unexpected.join(', ')}`);
    }
  }
  for (const counts of ordinary)
    for (const [key, value] of Object.entries(counts)) {
      if (Object.hasOwn(merged, key) && merged[key] !== value) {
        throw new Error(`CI 计数冲突 ${key}：${merged[key]} 与 ${value}`);
      }
      merged[key] = value;
    }
  return { counts: merged, summaries };
}
