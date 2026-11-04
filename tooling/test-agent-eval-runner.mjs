import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { executeChild } from './agent-eval/subprocess.mjs';
import { readJsonl, inspectCliEvents, inspectProtocol, summarizeResults, exportBundle, verifyBundle } from './agent-eval/records.mjs';
import { createCodexInvocation } from './agent-eval/codex-config.mjs';
import { runExperiment } from './agent-eval/experiment.mjs';
import { rejudgeExperiment } from './agent-eval/rejudge.mjs';
import { planRuns } from './agent-eval/schedule.mjs';
import { captureImplementation, implementationFingerprint } from './agent-eval/metadata.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = join(root, 'out/agent-eval');
await mkdir(temporary, { recursive: true });
const support = join(root, 'tooling/agent-eval/test-support/agent-process.mjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const exec = promisify(execFile);
const work = () => mkdtemp(join(temporary, 'runner-test-'));

test('真实子进程完成后保留JSONL与stderr且不覆盖旧日志', async () => {
  const cwd = await work();
  const options = { command: process.execPath, args: [support, 'success'], cwd,
    stdoutPath: join(cwd, 'agent.jsonl'), stderrPath: join(cwd, 'agent.stderr.log'), timeoutMs: 3000 };
  const result = await executeChild(options);
  assert.equal(result.status, 'completed');
  assert.equal(result.exitCode, 0);
  assert.match(await readFile(options.stderrPath, 'utf8'), /external agent diagnostic/);
  const events = await readJsonl(options.stdoutPath);
  assert.equal(events.records.length, 2);
  assert.equal(events.errors.length, 0);
  await assert.rejects(executeChild(options), error => error.code === 'EEXIST');
  assert.equal((await readJsonl(options.stdoutPath)).records.length, 2);
});

test('超时终止实际子进程，信号被忽略时仍结束并留证', async () => {
  const cwd = await work();
  const result = await executeChild({ command: process.execPath, args: [support, 'hang'], cwd,
    stdoutPath: join(cwd, 'agent.jsonl'), stderrPath: join(cwd, 'agent.stderr.log'),
    timeoutMs: 120, graceMs: 60 });
  assert.equal(result.status, 'timeout');
  assert.equal(result.exitCode, null);
  assert.equal(result.signal, 'SIGKILL');
  assert.throws(() => process.kill(result.pid, 0), error => error.code === 'ESRCH');
});

test('取消保留退出分类，不当作正常失败或成功', async () => {
  const cwd = await work();
  const controller = new AbortController();
  const pending = executeChild({ command: process.execPath, args: [support, 'hang'], cwd,
    stdoutPath: join(cwd, 'agent.jsonl'), stderrPath: join(cwd, 'agent.stderr.log'),
    timeoutMs: 3000, graceMs: 60, signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.throws(() => process.kill(result.pid, 0), error => error.code === 'ESRCH');
});

test('JSONL用标准行读取器保留损坏行，认证与非MCP调用如实分类', async () => {
  const cwd = await work();
  const file = join(cwd, 'agent.jsonl');
  await writeFile(file, '{"type":"thread.started","thread_id":"x"}\n{"unfinished"\n');
  const lines = await readJsonl(file);
  assert.equal(lines.records.length, 1);
  assert.equal(lines.errors[0].line, 2);
  const auth = inspectCliEvents([{ type: 'error', message: 'Authentication failed: HTTP 401' }]);
  assert(auth.failures.some(failure => failure.reason === 'agent-authentication-failed'));
  const command = inspectCliEvents([{ type: 'item.completed', item: { type: 'command_execution', command: 'cat judge.mjs' } }]);
  assert(command.failures.some(failure => failure.reason === 'non-evaluation-tool-call'));
});

test('真实CLI审批拒绝与服务不可用计基础设施，SDK可纠正错误不污染最终完成率', async () => {
  const captured = await readJsonl(join(root, 'tooling/agent-eval/test-support/approval-denial.jsonl'));
  const denied = inspectCliEvents(captured.records);
  assert(denied.failures.some(item => item.category === 'infrastructure' && item.reason === 'mcp-approval-required'));
  const unavailable = inspectCliEvents([{ type: 'item.completed', item: { id: 't1',
    type: 'mcp_tool_call', server: 'ppt_eval', tool: 'ppt_lint', result: null,
    error: { message: 'MCP server connection closed' }, status: 'failed' } }]);
  assert(unavailable.failures.some(item => item.category === 'infrastructure' && item.reason === 'mcp-service-unavailable'));
  const corrected = inspectCliEvents([{ type: 'item.completed', item: { id: 't2',
    type: 'mcp_tool_call', server: 'ppt_eval', tool: 'ppt_edit', status: 'failed', error: null,
    result: { isError: true, content: [{ type: 'text', text: '{"ok":false,"error":{"reason":"command-rejected"}}' }] } } },
  { type: 'item.completed', item: { id: 't3', type: 'mcp_tool_call', server: 'ppt_eval', tool: 'ppt_edit',
    status: 'completed', error: null, result: { content: [{ type: 'text', text: '{"ok":true,"value":{}}' }] } } }]);
  assert.deepEqual(corrected.failures, []);
});

test('保存产物必须对应真实成功ppt_save，附加孤立媒体式伪证不通过', () => {
  const outputBytes = Buffer.from('saved artifact');
  const path = '/experiment/runs/r001/work/result.pptx';
  const records = [{ direction: 'client-to-server', toolName: 'ppt_save', callIndex: 1,
    original: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ppt_save', arguments: { path } } } },
  { direction: 'server-to-client', toolName: 'ppt_save', callIndex: 1,
    original: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"ok":true,"value":{"path":"/experiment/runs/r001/work/result.pptx"}}' }] } },
    savedFile: { path, sha256: sha(outputBytes), bytes: outputBytes.length } }];
  for (const record of records) record.delivered = structuredClone(record.original);
  assert.equal(inspectProtocol(records, { outputPath: path, outputBytes }).failures.length, 0);
  assert(inspectProtocol([], { outputPath: path, outputBytes }).failures.some(failure => failure.reason === 'successful-save-unobserved'));
  assert(inspectProtocol(records, { outputPath: path, outputBytes: Buffer.from('later changed') }).failures.some(failure => failure.reason === 'saved-artifact-hash-mismatch'));
});

test('所有尝试进入统计并区分内容、协议与基础设施失败', () => {
  const results = [
    { taskId: 'a', repetition: 1, condition: 'with-lint', attempted: true, pass: true, failures: [] },
    { taskId: 'a', repetition: 1, condition: 'without-lint', attempted: true, pass: false,
      failures: [{ category: 'task', reason: 'layout-not-clean' }] },
    { taskId: 'b', repetition: 1, condition: 'with-lint', attempted: true, pass: false,
      failures: [{ category: 'infrastructure', reason: 'agent-timeout' }] },
    { taskId: 'b', repetition: 1, condition: 'without-lint', attempted: true, pass: false,
      failures: [{ category: 'protocol', reason: 'non-evaluation-tool-call' }] },
  ];
  const summary = summarizeResults(results);
  assert.equal(summary.conditions['with-lint'].total, 2);
  assert.equal(summary.conditions['with-lint'].passed, 1);
  assert.equal(summary.conditions['with-lint'].infrastructureFailures, 1);
  assert.equal(summary.conditions['without-lint'].total, 2);
  assert.equal(summary.conditions['without-lint'].failuresByReason['layout-not-clean'], 1);
  assert.equal(summary.pairs.planned, 2);
  assert.equal(summary.pairs.recorded, 2);
  assert.equal(summary.pairs.evaluated, 1);
  assert.equal(summary.pairs.withOnly, 1);
});

test('planned、attempted、evaluable分开，失败高级分类互斥而原因保留重叠', () => {
  const results = [
    { taskId: 'a', repetition: 1, condition: 'with-lint', attempted: true, pass: true, failures: [] },
    { taskId: 'a', repetition: 1, condition: 'without-lint', attempted: false, pass: false,
      failures: [{ category: 'infrastructure', reason: 'agent-not-started' }] },
    { taskId: 'b', repetition: 1, condition: 'with-lint', attempted: true, pass: false,
      failures: [{ category: 'infrastructure', reason: 'agent-authentication-failed' },
        { category: 'protocol', reason: 'successful-save-unobserved' },
        { category: 'task', reason: 'output-missing' }] },
    { taskId: 'b', repetition: 1, condition: 'without-lint', attempted: true, pass: false,
      failures: [{ category: 'protocol', reason: 'unauthorized-edit-operation' },
        { category: 'task', reason: 'title-mismatch' }] },
  ];
  const summary = summarizeResults(results);
  assert.equal(summary.conditions['with-lint'].planned, 2);
  assert.equal(summary.conditions['with-lint'].attempted, 2);
  assert.equal(summary.conditions['with-lint'].evaluable, 1);
  assert.equal(summary.conditions['with-lint'].infrastructureFailures, 1);
  assert.equal(summary.conditions['with-lint'].protocolFailures, 0);
  assert.equal(summary.conditions['with-lint'].taskFailures, 0);
  assert.equal(summary.conditions['with-lint'].failuresByReason['output-missing'], 1);
  assert.equal(summary.conditions['without-lint'].attempted, 1);
  assert.equal(summary.conditions['without-lint'].notStarted, 1);
  assert.equal(summary.conditions['without-lint'].infrastructureFailures, 1);
  assert.equal(summary.conditions['without-lint'].protocolFailures, 1);
  assert.equal(summary.conditions['without-lint'].taskFailures, 0);
  assert.equal(summary.pairs.planned, 2);
  assert.equal(summary.pairs.attempted, 1);
  assert.equal(summary.pairs.evaluable, 0);
});

test('依赖清单和锁进入源码指纹，Node运行环境单独记录', async () => {
  const directory = await work();
  const fakeRoot = join(directory, 'metadata-project');
  const files = ['AGENTS.md', 'packages/agent-mcp/skills/web-ppt/SKILL.md',
    'tooling/lib/template-fill-measurement.mjs', 'tooling/lib/ooxml.mjs',
    'tooling/agent-eval/runner.mjs', 'tooling/template-fill-fonts/manifest.json',
    'tooling/template-fill-fonts/regular.ttf', 'tooling/template-fill-fonts/bold.ttf'];
  for (const path of files) {
    await mkdir(dirname(join(fakeRoot, path)), { recursive: true });
    await writeFile(join(fakeRoot, path), `metadata fixture ${path}`);
  }
  const packageBytes = await readFile(join(root, 'package.json'));
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  await writeFile(join(fakeRoot, 'package.json'), packageBytes);
  await writeFile(join(fakeRoot, 'package-lock.json'), JSON.stringify(lock));
  const first = await captureImplementation(fakeRoot);
  assert.equal(first.files['package.json'], sha(packageBytes));
  for (const path of ['tooling/lib/template-fill-measurement.mjs', 'tooling/lib/ooxml.mjs']) {
    assert.equal(first.files[path], sha(await readFile(join(fakeRoot, path))));
  }
  assert.equal(first.runtime.node, process.version);
  assert.equal(first.runtime.platform, process.platform);
  assert.equal(first.runtime.arch, process.arch);
  assert.equal(implementationFingerprint({ ...first, runtime: { node: 'different', platform: 'other', arch: 'other' } }), first.fingerprint);
  for (const name of ['harfbuzzjs', '@modelcontextprotocol/sdk', 'culori', 'smol-toml']) {
    assert.equal(first.dependencyLocks[name].version, lock.packages[`node_modules/${name}`].version);
    assert.match(first.dependencyLocks[name].source, /package-lock\.json/);
  }
  await writeFile(join(fakeRoot, 'package.json'), `${packageBytes.toString('utf8')}\n`);
  const second = await captureImplementation(fakeRoot);
  assert.notEqual(second.fingerprint, first.fingerprint);
  lock.packages['node_modules/harfbuzzjs'].version = '1.6.1-metadata-test';
  await writeFile(join(fakeRoot, 'package-lock.json'), JSON.stringify(lock));
  const third = await captureImplementation(fakeRoot);
  assert.notEqual(third.fingerprint, second.fingerprint);
  for (const path of ['tooling/lib/template-fill-measurement.mjs', 'tooling/lib/ooxml.mjs']) {
    const previous = await captureImplementation(fakeRoot);
    await writeFile(join(fakeRoot, path), `changed indirect helper ${path}`);
    assert.notEqual((await captureImplementation(fakeRoot)).fingerprint, previous.fingerprint);
  }
});

test('成功隐藏或结构编辑即使随后撤销也失败，原子拒绝不算已执行', () => {
  const call = { direction: 'client-to-server', toolName: 'ppt_edit', callIndex: 3,
    original: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ppt_edit',
      arguments: { commands: [{ type: 'SetElementHidden', id: 'title', hidden: true }, { type: 'RemoveElement', id: 'body' }] } } } };
  call.delivered = structuredClone(call.original);
  const reply = ok => {
    const original = { jsonrpc: '2.0', id: 3, result: { isError: !ok,
      content: [{ type: 'text', text: JSON.stringify(ok ? { ok: true, value: {} }
        : { ok: false, error: { reason: 'command-rejected' } }) }] } };
    return { direction: 'server-to-client', toolName: 'ppt_edit', callIndex: 3,
      original, delivered: structuredClone(original) };
  };
  const accepted = inspectProtocol([call, reply(true)]).failures.filter(item => item.reason === 'unauthorized-edit-operation');
  assert.equal(accepted.length, 2);
  const rejected = inspectProtocol([call, reply(false)]).failures;
  assert.equal(rejected.some(item => item.reason === 'unauthorized-edit-operation'), false);
});

test('证据包只映射宿主路径，保留失败与字节哈希并拒绝覆盖', async () => {
  const source = await work();
  await mkdir(join(source, 'runs/r001/work'), { recursive: true });
  await writeFile(join(source, 'manifest.json'), JSON.stringify({ version: 1, runs: [{ id: 'r001' }] }));
  await writeFile(join(source, 'run.json'), JSON.stringify({ input: join(source, 'runs/r001/work/input.pptx'), state: 'timeout' }));
  await writeFile(join(source, 'runs/r001/work/input.pptx'), Buffer.from([1, 2, 3]));
  const destination = join(await work(), 'portable');
  const result = await exportBundle({ sourceDirectory: source, destination, repoRoot: root });
  assert(result.files.some(file => file.path === 'runs/r001/work/input.pptx'));
  const text = await readFile(join(destination, 'run.json'), 'utf8');
  assert(!text.includes(source));
  assert(text.includes('<experiment>/runs/r001/work/input.pptx'));
  assert(text.includes('timeout'));
  await verifyBundle(destination);
  await assert.rejects(exportBundle({ sourceDirectory: source, destination, repoRoot: root }), error => error.code === 'EEXIST');
  await writeFile(join(destination, 'runs/r001/work/input.pptx'), Buffer.from([4]));
  await assert.rejects(verifyBundle(destination), /字节数|hash|哈希/);
});

test('交替条件顺序为每个任务保留完整配对且不泄漏种类到目录名', () => {
  const plan = planRuns([{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(plan.map(run => run.condition), ['with-lint', 'without-lint', 'without-lint', 'with-lint']);
  assert.deepEqual(plan.map(run => run.id), ['r001', 'r002', 'r003', 'r004']);
  assert.throws(() => planRuns([{ id: 'a' }, { id: 'a' }]), /重复/);
});

test('完整本次项目配置通过真实CLI选层加载，不修改全局配置或调用模型', async () => {
  const directory = await work();
  const workDirectory = join(directory, 'work');
  const evidenceDirectory = join(directory, 'evidence');
  await mkdir(workDirectory);
  await mkdir(evidenceDirectory);
  const invocation = await createCodexInvocation({ repoRoot: root, experimentDirectory: directory,
    workDirectory, evidenceDirectory, hostConfigPath: join(evidenceDirectory, 'host.json'),
    model: 'gpt-6.1-sol', effort: 'ultra', timeoutMs: 240000 });
  assert(invocation.args.includes('--ignore-user-config'));
  assert(!invocation.args.includes('--ignore-rules'));
  assert(!invocation.args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert(!invocation.args.includes('-s'));
  assert.equal(invocation.config.approval_policy, 'never');
  assert.equal(invocation.config.features.shell_tool, false);
  const server = invocation.config.mcp_servers.ppt_eval;
  assert.equal(server.default_tools_approval_mode, 'prompt');
  assert.deepEqual(Object.keys(server.tools).sort(), [...server.enabled_tools].sort());
  for (const name of server.enabled_tools) assert.equal(server.tools[name].approval_mode, 'approve');
  assert.equal(invocation.config.permissions.agent_eval.filesystem[join(root, 'tooling/agent-eval')], 'deny');
  const { stdout } = await exec('codex', ['mcp', 'list', '--json', '-c', invocation.trustOverride],
    { cwd: workDirectory, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const actual = JSON.parse(stdout).find(server => server.name === 'ppt_eval');
  assert(actual, '本次生成的配置必须被CLI实际加载');
  assert.equal(actual.enabled, true);
});

test('外部Agent边界替身通过真实生产MCP完成配对并离线重判，不能导出成真实模型证据', async () => {
  const parent = await work();
  const directory = join(parent, 'experiment');
  const invocationFactory = ({ hostConfigPath }) => ({ command: process.execPath,
    args: [join(root, 'tooling/agent-eval/test-support/mcp-agent-process.mjs'),
      join(root, 'tooling/agent-eval/host.mjs'), hostConfigPath] });
  const report = await runExperiment({ repoRoot: root, directory,
    model: 'external-test-double', effort: 'test', taskIds: ['case-01'],
    timeoutMs: 10000, maxCalls: 20, onProgress: () => {} }, { invocationFactory });
  assert.equal(report.manifest.engine, 'external-agent-test-double');
  assert.equal(report.results.length, 2);
  assert(report.results.every(result => result.pass), JSON.stringify(report.results.map(result => result.failures)));
  assert.equal(report.summary.pairs.bothPassed, 1);
  assert.equal(report.results[0].protocol.toolCatalogSha256, report.results[1].protocol.toolCatalogSha256);
  assert(report.results.find(result => result.condition === 'without-lint').protocol.automaticLintRemoved > 0);
  const copied = join(parent, 'portable');
  await exportBundle({ sourceDirectory: directory, destination: copied, repoRoot: root });
  await assert.rejects(rejudgeExperiment(copied), /真实 Codex CLI/);
  const repeated = await rejudgeExperiment(copied, { allowTestDouble: true });
  assert(repeated.results.every(result => result.pass));
  assert.equal(repeated.rejudgment.sourceMatches, true);
  const changedManifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  changedManifest.implementation.fingerprint = 'different-recorded-implementation';
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(changedManifest));
  const changed = await rejudgeExperiment(directory, { requireIntegrity: false, allowTestDouble: true });
  assert.equal(changed.rejudgment.sourceMatches, false);
  assert.equal(changed.rejudgment.recordedImplementation.fingerprint, 'different-recorded-implementation');
  assert(changed.summary.limitations.some(message => message.includes('新判定实现')));
  await assert.rejects(runExperiment({ repoRoot: root, directory: join(parent, 'forbidden'),
    exportDirectory: join(parent, 'should-not-exist'), model: 'test', effort: 'test' },
  { invocationFactory }), /替身不能导出/);
});

test('CLI版本变化后停止后续run，不沿用初始版本声称已启动', async () => {
  const directory = join(await work(), 'version-change');
  let checks = 0;
  const report = await runExperiment({ repoRoot: root, directory, model: 'test', effort: 'test',
    taskIds: ['case-01'], timeoutMs: 10000, maxCalls: 20, onProgress: () => {} }, {
    invocationFactory: ({ hostConfigPath }) => ({ command: process.execPath,
      args: [join(root, 'tooling/agent-eval/test-support/mcp-agent-process.mjs'),
        join(root, 'tooling/agent-eval/host.mjs'), hostConfigPath] }),
    readCliVersion: async () => ++checks === 1 ? 'external-agent-test-double' : 'changed-version',
  });
  assert.equal(checks, 2);
  assert.equal(report.results[0].attempted, true);
  assert.equal(report.results[1].attempted, false);
  const stopped = JSON.parse(await readFile(join(directory, 'runs/r002/run.json'), 'utf8'));
  assert.equal(stopped.reason, 'agent-cli-version-changed');
  assert.equal(stopped.cliVersionObservedBeforeStart, 'changed-version');
});

test('host预算上限在CLI与模型启动前立即校验', async () => {
  const parent = await work();
  let configured = false;
  const directory = join(parent, 'invalid-calls');
  await assert.rejects(runExperiment({ repoRoot: root, directory, model: 'test', effort: 'test',
    maxCalls: 10001, onProgress: () => {} }, { invocationFactory: () => { configured = true; } }), /10000/);
  assert.equal(configured, false);
  await assert.rejects(readFile(join(directory, 'manifest.json')), error => error.code === 'ENOENT');
});

test('非lifecycle记录不能省略原始或交付字段，完整消息不新增该错误', () => {
  const original = { jsonrpc: '2.0', method: 'notifications/initialized' };
  const valid = { direction: 'client-to-server', callIndex: null, toolName: null,
    original, delivered: structuredClone(original) };
  const result = inspectProtocol([valid]);
  assert.equal(result.failures.some(item => item.reason === 'incomplete-protocol-record'), false);
  const missingOriginal = { ...valid }; delete missingOriginal.original;
  const missingDelivered = { ...valid }; delete missingDelivered.delivered;
  for (const row of [missingOriginal, missingDelivered]) {
    assert(inspectProtocol([row]).failures.some(item => item.reason === 'incomplete-protocol-record'));
  }
  assert(inspectProtocol([{ ...valid, delivered: null }]).failures.some(item => item.reason === 'invalid-protocol-record'));
});

test('已观察到的工具预算是资源终止，后续transport错误保留而非另计外部故障', () => {
  const protocol = inspectProtocol([{ direction: 'lifecycle', event: 'fatal', sequence: 137,
    reason: 'call-budget-exceeded', callCount: 65 }], { maxCalls: 64 });
  assert.equal(protocol.resourceLimits[0].observed, 65);
  assert(protocol.failures.some(item => item.category === 'resource' && item.reason === 'call-budget-exceeded'));
  const row = { taskId: 'a', repetition: 1, condition: 'with-lint', attempted: true,
    pass: false, semanticPass: true, semanticAssessed: true,
    failures: [...protocol.failures, { category: 'infrastructure', reason: 'mcp-service-unavailable', message: 'Transport closed' }] };
  const summary = summarizeResults([row]);
  assert.equal(summary.conditions['with-lint'].passed, 0);
  assert.equal(summary.conditions['with-lint'].resourceFailures, 1);
  assert.equal(summary.conditions['with-lint'].infrastructureFailures, 0);
  assert.equal(summary.conditions['with-lint'].semanticPassed, 1);
  assert.equal(summary.conditions['with-lint'].semanticCompletionRate, 1);
  assert.equal(summary.conditions['with-lint'].failuresByReason['mcp-service-unavailable'], 1);
  const unverifiable = inspectProtocol([{ direction: 'lifecycle', event: 'fatal',
    reason: 'call-budget-exceeded', callCount: 64 }], { maxCalls: 64 });
  assert.equal(unverifiable.resourceLimits.length, 0);
  assert(unverifiable.failures.some(item => item.reason === 'resource-limit-unverifiable'));
  const capacity = summarizeResults([{ taskId: 'b', repetition: 1, condition: 'with-lint',
    attempted: true, pass: false, semanticPass: false, failures: [
      { category: 'infrastructure', reason: 'agent-service-failed', message: 'Selected model is at capacity' },
      { category: 'task', reason: 'output-missing' }] }]);
  assert.equal(capacity.conditions['with-lint'].infrastructureFailures, 1);
  assert.equal(capacity.conditions['with-lint'].resourceFailures, 0);
});

test('实际controller超时归资源限制，不生成save或把缺产物另计高级任务失败', async () => {
  const directory = join(await work(), 'resource-timeout');
  const report = await runExperiment({ repoRoot: root, directory, model: 'test', effort: 'test',
    taskIds: ['case-01'], timeoutMs: 120, maxCalls: 20, onProgress: () => {} }, {
    invocationFactory: () => ({ command: process.execPath, args: [support, 'hang'], graceMs: 50 }),
  });
  assert(report.results.every(row => row.pass === false && row.semanticPass === false));
  assert(report.results.every(row => row.resourceLimits.some(limit => limit.kind === 'wall-clock')));
  for (const condition of ['with-lint', 'without-lint']) {
    assert.equal(report.summary.conditions[condition].resourceFailures, 1);
    assert.equal(report.summary.conditions[condition].infrastructureFailures, 0);
    assert.equal(report.summary.conditions[condition].taskFailures, 0);
    assert.equal(report.summary.conditions[condition].semanticCompletionRate, 0);
  }
});
