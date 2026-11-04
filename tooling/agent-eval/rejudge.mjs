import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readJsonl, inspectCliEvents, inspectProtocol, summarizeResults, verifyBundle } from './records.mjs';
import { captureImplementation } from './metadata.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = (reason, message, category = 'infrastructure') => ({ category, reason, ...(message && { message }) });

function resolveInside(base, path) {
  assert.equal(typeof path, 'string', '记录缺少相对路径');
  assert(!isAbsolute(path), `记录路径必须相对：${path}`);
  const result = resolve(base, path);
  const difference = relative(base, result);
  assert(difference && difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference),
    `记录路径越界：${path}`);
  return result;
}

async function optionalBytes(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function optionalJsonl(path, failures, reason) {
  try {
    const parsed = await readJsonl(path);
    if (parsed.errors.length) failures.push(failure('invalid-jsonl', `${reason}: ${JSON.stringify(parsed.errors)}`));
    return parsed.records;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    failures.push(failure(reason, path));
    return [];
  }
}

export async function judgeRecordedRun(experimentDirectory, plan, judgeTask) {
  const runDirectory = resolveInside(experimentDirectory, plan.directory);
  const failures = [];
  const resourceLimits = [];
  const runBytes = await optionalBytes(join(runDirectory, 'run.json'));
  if (!runBytes) return { ...plan, attempted: false, pass: false, failures: [failure('run-record-missing', plan.id)] };
  const run = JSON.parse(runBytes.toString('utf8'));
  assert.equal(run.version, 1, `${plan.id} 记录版本`);
  for (const key of ['id', 'taskId', 'condition', 'repetition']) assert.equal(run[key], plan[key], `${plan.id} ${key}不匹配`);
  if (!run.process) failures.push(failure('agent-not-started', run.reason ?? run.status));
  else {
    if (run.process.status === 'timeout') {
      failures.push(failure('agent-timeout', undefined, 'resource'));
      resourceLimits.push({ kind: 'wall-clock', reason: 'agent-timeout',
        limitMs: run.requested.timeoutMs, observedMs: run.process.elapsedMs, source: 'runner-timer' });
    }
    if (run.process.status === 'cancelled') failures.push(failure('agent-cancelled'));
    if (run.process.spawnError) failures.push(failure('agent-cli-unavailable', run.process.spawnError.message));
    if (run.process.status === 'failed') failures.push(failure('agent-process-failed', `exit=${run.process.exitCode}, signal=${run.process.signal}`));
  }
  const input = await optionalBytes(resolveInside(runDirectory, run.paths.input));
  const output = await optionalBytes(resolveInside(runDirectory, run.paths.output));
  const prompt = await optionalBytes(resolveInside(runDirectory, run.paths.prompt));
  if (!input) failures.push(failure('input-missing'));
  else if (sha(input) !== run.inputSha256) failures.push(failure('input-hash-mismatch'));
  if (!prompt) failures.push(failure('prompt-missing'));
  else if (sha(prompt) !== run.promptSha256) failures.push(failure('prompt-hash-mismatch'));
  if (!output) failures.push(failure('output-missing', undefined, 'task'));
  const cliEvents = await optionalJsonl(resolveInside(runDirectory, run.paths.stdout), failures, 'agent-log-missing');
  const cli = inspectCliEvents(cliEvents);
  failures.push(...cli.failures);
  if (!cli.completedTurns) failures.push(failure('agent-completion-unobserved'));
  if (!cli.usage.length) failures.push(failure('agent-usage-unobserved'));
  const protocolEvents = await optionalJsonl(resolveInside(runDirectory, run.paths.protocol), failures, 'mcp-protocol-missing');
  const protocol = inspectProtocol(protocolEvents, { condition: plan.condition,
    outputPath: resolveInside(runDirectory, run.paths.output), outputBytes: output,
    portableOutputPath: `<experiment>/${plan.directory}/${run.paths.output}`,
    requireLifecycle: true, requireCatalog: true, maxCalls: run.requested.maxCalls });
  failures.push(...protocol.failures);
  resourceLimits.push(...protocol.resourceLimits);
  let judgment = null;
  if (input && output) {
    try {
      judgment = await judgeTask({ taskId: plan.taskId, inputBytes: input, outputBytes: output });
      failures.push(...judgment.failures.map(item => ({ category: 'task', ...item })));
      if (!judgment.pass && judgment.failures.length === 0) failures.push(failure('semantic-judgment-failed', undefined, 'task'));
    } catch (error) {
      failures.push(failure('judgment-execution-failed', error.message));
    }
  }
  return { ...plan, attempted: Number.isInteger(run.process?.pid) && run.process.pid > 0,
    pass: Boolean(judgment?.pass) && failures.length === 0,
    semanticPass: judgment?.pass ?? false, semanticAssessed: judgment !== null, failures, resourceLimits,
    inputSha256: input ? sha(input) : null, outputSha256: output ? sha(output) : null,
    promptSha256: prompt ? sha(prompt) : null,
    process: run.process, requested: run.requested, cliVersion: run.cliVersion,
    actualModels: cli.actualModels, usage: cli.usage, protocol,
    description: judgment?.description ?? null, lint: judgment?.lint ?? null };
}

export async function rejudgeExperiment(directory, { requireIntegrity = true, judgeTask, writeReport = false,
  allowTestDouble = false } = {}) {
  const root = resolve(directory);
  if (requireIntegrity) await verifyBundle(root);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, 1, '评测清单版本必须为1');
  assert(manifest.engine === 'codex-cli' || (allowTestDouble && manifest.engine === 'external-agent-test-double'),
    '默认重判只接受真实 Codex CLI 证据，测试替身需要测试代码显式允许');
  assert(Array.isArray(manifest.runs) && manifest.runs.length > 0, '评测清单没有运行计划');
  const ids = manifest.runs.map(run => run.id);
  assert.equal(new Set(ids).size, ids.length, '运行计划ID重复');
  const judge = judgeTask ?? (await import('./judge.mjs')).judgeTask;
  const currentImplementation = await captureImplementation(resolve(import.meta.dirname, '../..'));
  const rejudgment = { recordedImplementation: manifest.implementation, currentImplementation,
    sourceMatches: manifest.implementation?.fingerprint === currentImplementation.fingerprint,
    agentContextMatches: manifest.implementation?.contextFingerprint === currentImplementation.contextFingerprint };
  const results = [];
  for (const plan of manifest.runs) {
    try {
      results.push(await judgeRecordedRun(root, plan, judge));
    } catch (error) {
      results.push({ ...plan, attempted: false, pass: false, failures: [failure('record-unreadable', error.message)] });
    }
  }
  const schemas = new Set(results.map(run => run.protocol?.toolCatalogSha256).filter(Boolean));
  if (schemas.size > 1) {
    for (const run of results) {
      run.failures.push(failure('tool-catalog-varies-between-runs', undefined, 'protocol'));
      run.pass = false;
    }
  }
  const observedModels = new Set(results.flatMap(run => run.actualModels ?? []));
  if (observedModels.size > 1) {
    for (const run of results) {
      run.failures.push(failure('reported-model-varies-between-runs'));
      run.pass = false;
    }
  }
  for (const run of results) {
    const task = manifest.tasks?.find(task => task.id === run.taskId);
    const controlled = manifest.configuration;
    const expected = controlled && { model: controlled.model, effort: controlled.effort,
      timeoutMs: controlled.timeoutMs, maxCalls: controlled.maxCalls };
    const controlMatches = expected && isDeepStrictEqual(run.requested, expected)
      && run.cliVersion === manifest.cli?.version && task?.inputSha256 === run.inputSha256
      && task?.promptSha256 === run.promptSha256;
    if (!controlMatches) {
      run.failures.push(failure('controlled-inputs-mismatch', undefined, 'protocol'));
      run.pass = false;
    }
  }
  const summary = summarizeResults(results);
  if (!rejudgment.sourceMatches) {
    summary.limitations.push('当前源码或依赖指纹与记录时不同；这是新判定实现的复判结果，不宣称原实现精确重现。');
  }
  if (results.some(run => run.actualModels?.length === 0)) {
    summary.limitations.push('部分CLI记录未公开实际服务端model字段，仅记录请求model；不把请求值伪装为服务端观察值。');
  }
  const report = { version: 1, outcomePolicyVersion: 2, experiment: manifest.id,
    engine: manifest.engine, manifest, rejudgment, results, summary };
  if (writeReport) await writeFile(join(root, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let directory = process.argv[2];
  if (process.argv.length > 3) throw new Error('用法：node tooling/agent-eval/rejudge.mjs [证据目录]');
  if (!directory) {
    const records = join(import.meta.dirname, 'records');
    const pointer = JSON.parse(await readFile(join(records, 'latest.json'), 'utf8'));
    assert.equal(pointer.version, 1, '证据索引版本必须为1');
    directory = resolveInside(records, pointer.directory);
  }
  const result = await rejudgeExperiment(directory);
  console.log(JSON.stringify(result.summary, null, 2));
}
