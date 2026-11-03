import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createCodexInvocation, readUserAgentDefaults } from './codex-config.mjs';
import { agentEnvironment, captureImplementation, inspectCodex, readCodexVersion } from './metadata.mjs';
import { executeChild } from './subprocess.mjs';
import { planRuns } from './schedule.mjs';
import { TASKS, createTaskPrompt } from './tasks.mjs';
import { buildFixture } from './fixtures.mjs';
import { rejudgeExperiment } from './rejudge.mjs';
import { exportBundle } from './records.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

export async function runExperiment(options, { invocationFactory, judgeTask, readCliVersion } = {}) {
  const { repoRoot, codexBin = 'codex', timeoutMs = 240000, maxCalls = 64,
    repetitions = 1, signal, onProgress = console.log } = options;
  const root = resolve(repoRoot);
  const directory = resolve(options.directory);
  const intermediate = relative(join(root, 'out/agent-eval'), directory);
  assert(intermediate && intermediate !== '..' && !intermediate.startsWith(`..${sep}`) && !isAbsolute(intermediate),
    '真实运行目录必须位于项目忽略目录out/agent-eval内');
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0, 'timeoutMs必须为正整数');
  assert(Number.isSafeInteger(maxCalls) && maxCalls > 0 && maxCalls <= 10000, 'maxCalls必须为1–10000的整数，与host上限一致');
  if (invocationFactory && options.exportDirectory) throw new Error('测试替身不能导出为真实模型证据');
  const defaults = options.model && options.effort ? null : await readUserAgentDefaults();
  const model = options.model ?? defaults.model;
  const effort = options.effort ?? defaults.effort;
  const env = agentEnvironment();
  const cli = invocationFactory ? { version: 'external-agent-test-double', authentication: 'test' }
    : await inspectCodex(codexBin, env);
  const implementation = await captureImplementation(root);
  const skill = await readFile(join(root, 'packages/agent-mcp/skills/web-ppt/SKILL.md'), 'utf8');
  const makePrompt = id => `${createTaskPrompt(id, { inputPath: 'input.pptx', outputPath: 'result.pptx' })}\n\nUse the following public web-ppt Skill unchanged as guidance:\n\n${skill}`;
  const selectedTasks = options.taskIds ? TASKS.filter(task => options.taskIds.includes(task.id)) : TASKS;
  if (options.taskIds) assert.equal(selectedTasks.length, new Set(options.taskIds).size, '存在未知或重复任务ID');
  const plans = planRuns(selectedTasks, repetitions);
  await mkdir(directory, { recursive: false });
  const manifest = { version: 1, id: options.id ?? basename(directory),
    createdAt: new Date().toISOString(), engine: invocationFactory ? 'external-agent-test-double' : 'codex-cli',
    cli, configuration: { model, effort, timeoutMs, maxCalls, repetitions }, implementation,
    order: 'alternating-condition-first-within-task', tasks: [], runs: plans };
  for (const task of selectedTasks) {
    const bytes = buildFixture(task.id);
    const prompt = makePrompt(task.id);
    manifest.tasks.push({ ...task, inputSha256: sha(bytes), promptSha256: sha(prompt) });
  }
  await save(join(directory, 'manifest.json'), manifest);
  const configurations = [];
  for (const plan of plans) {
    const base = join(directory, plan.directory);
    const workDirectory = join(base, 'work');
    const evidenceDirectory = join(base, 'evidence');
    await mkdir(join(workDirectory, 'render'), { recursive: true });
    await mkdir(evidenceDirectory);
    const input = buildFixture(plan.taskId);
    const prompt = makePrompt(plan.taskId);
    const paths = { input: 'work/input.pptx', output: 'work/result.pptx', prompt: 'evidence/prompt.txt',
      stdout: 'evidence/agent.jsonl', stderr: 'evidence/agent.stderr.log', protocol: 'evidence/protocol.jsonl' };
    await writeFile(join(base, paths.input), input, { flag: 'wx' });
    await writeFile(join(base, paths.prompt), prompt, { flag: 'wx' });
    await writeFile(join(evidenceDirectory, 'skill.md'), skill, { flag: 'wx' });
    const hostConfig = { version: 1, condition: plan.condition,
      inputPath: join(base, paths.input), outputPath: join(base, paths.output),
      renderDirectory: join(workDirectory, 'render'), protocolPath: join(base, paths.protocol), maxCalls };
    const hostConfigPath = join(evidenceDirectory, 'host.json');
    await save(hostConfigPath, hostConfig);
    const invocation = await (invocationFactory ?? createCodexInvocation)({ repoRoot: root,
      experimentDirectory: directory, workDirectory, evidenceDirectory, hostConfigPath,
      model, effort, timeoutMs, codexBin, plan });
    const run = { version: 1, ...plan, status: 'not-started', process: null, paths,
      requested: { model, effort, timeoutMs, maxCalls }, cliVersion: null,
      expectedCliVersion: cli.version, cliVersionObservedBeforeStart: null,
      inputSha256: sha(input), promptSha256: sha(prompt),
      configuration: { command: invocation.command, args: invocation.args,
        ...(invocation.configPath && { configPath: invocation.configPath }) } };
    await save(join(base, 'run.json'), run);
    configurations.push({ base, workDirectory, evidenceDirectory, prompt, run, invocation });
  }
  let stopReason;
  const versionReader = readCliVersion ?? (invocationFactory ? async () => cli.version : () => readCodexVersion(codexBin, env));
  for (const item of configurations) {
    const { base, workDirectory, prompt, run, invocation } = item;
    if (signal?.aborted) stopReason ??= 'experiment-cancelled';
    if (!stopReason) {
      const current = await captureImplementation(root);
      if (current.fingerprint !== implementation.fingerprint) stopReason = 'implementation-changed';
      else if (current.contextFingerprint !== implementation.contextFingerprint) stopReason = 'agent-instructions-changed';
    }
    if (!stopReason) {
      try {
        run.cliVersionObservedBeforeStart = await versionReader();
        if (run.cliVersionObservedBeforeStart !== cli.version) stopReason = 'agent-cli-version-changed';
        else run.cliVersion = run.cliVersionObservedBeforeStart;
      } catch (error) {
        run.cliVersionCheckError = error.message;
        stopReason = 'agent-cli-version-check-failed';
      }
    }
    if (stopReason) {
      run.status = 'not-started';
      run.reason = stopReason;
      await save(join(base, 'run.json'), run);
      continue;
    }
    onProgress(`开始 ${run.id} ${run.taskId} ${run.condition}`);
    run.status = 'running';
    await save(join(base, 'run.json'), run);
    try {
      run.process = await executeChild({ ...invocation, cwd: workDirectory, env,
        stdoutPath: join(base, run.paths.stdout), stderrPath: join(base, run.paths.stderr),
        timeoutMs, signal, input: prompt,
        onProgress: progress => onProgress(`${run.id} 运行中 ${Math.round(progress.elapsedMs / 1000)}s`) });
      run.status = run.process.status;
    } catch (error) {
      run.status = 'failed';
      run.failure = { reason: 'agent-execution-failed', message: error.message };
      stopReason = 'agent-execution-failed';
    }
    await save(join(base, 'run.json'), run);
    onProgress(`结束 ${run.id} ${run.status}`);
  }
  manifest.completedAt = new Date().toISOString();
  await save(join(directory, 'manifest.json'), manifest);
  const report = await rejudgeExperiment(directory, { requireIntegrity: false, judgeTask, writeReport: true,
    allowTestDouble: Boolean(invocationFactory) });
  if (options.exportDirectory) await exportBundle({ sourceDirectory: directory,
    destination: resolve(options.exportDirectory), repoRoot: root });
  return report;
}
