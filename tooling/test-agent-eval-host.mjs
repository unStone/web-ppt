import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createAgentMcpServer } from '@web-ppt/agent-mcp';
import { LAYOUT_CHECKS } from '@web-ppt/edit-core/lint';
import { buildFixture } from './agent-eval/fixtures.mjs';
import { TASKS } from './agent-eval/tasks.mjs';
import { startEvaluationHost } from './agent-eval/host.mjs';
import { createPathPolicy } from './agent-eval/paths.mjs';
import { createRuntime } from './agent-eval/runtime.mjs';
import { deck, slideXml, sp } from './lib/ooxml.mjs';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'out/agent-eval/host-tests');
await mkdir(output, { recursive: true });
const originalCwd = process.cwd();
const cleanTask = TASKS.find(task => task.kind === 'clean');
assert(cleanTask);
async function lines(path) {
  const result = [];
  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of reader) if (line.trim()) result.push(JSON.parse(line));
  return result;
}
async function configuration(condition, maxCalls = 64) {
  const dir = await mkdtemp(join(output, `${condition}-`));
  const config = { version: 1, condition, inputPath: join(dir, 'input.pptx'),
    outputPath: join(dir, 'result.pptx'), renderDirectory: join(dir, 'render'),
    protocolPath: join(dir, 'protocol.jsonl'), maxCalls };
  await mkdir(config.renderDirectory);
  await writeFile(config.inputPath, buildFixture(cleanTask.id));
  return config;
}
const payload = response => JSON.parse(response.content[0].text);
async function call(client, name, args, ok = true) {
  const response = await client.callTool({ name, arguments: args });
  assert.equal(!!response.isError, !ok, `${name}: ${JSON.stringify(response)}`);
  return payload(response);
}

// 工具表直接与生产服务比较，避免装饰器悄悄替换 Schema 或处理器。
const runtime = await createRuntime();
const production = createAgentMcpServer(runtime);
const [productionClientTransport, productionServerTransport] = InMemoryTransport.createLinkedPair();
const productionClient = new Client({ name: 'eval-host-production', version: '1.0.0' });
await production.server.connect(productionServerTransport);
await productionClient.connect(productionClientTransport);
const productionTools = (await productionClient.listTools()).tools;
await productionClient.close();
await production.manager.dispose();

const pair = [];
for (const condition of ['with-lint', 'without-lint']) {
  const config = await configuration(condition);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const host = await startEvaluationHost(config, { transport: serverTransport });
  const client = new Client({ name: 'eval-host-contract', version: '1.0.0' });
  try {
    await client.connect(clientTransport);
    assert.deepEqual((await client.listTools()).tools, productionTools);
    const remote = (await call(client, 'ppt_open', { path: 'input.pptx' })).value;
    const described = (await call(client, 'ppt_describe', { sessionId: remote.sessionId })).value;
    const title = described.slides[0].elements.find(element => element.name === cleanTask.titleName);
    assert(title, '真实固件标题必须能被生产 describe 找到');
    const edit = await call(client, 'ppt_edit', { sessionId: remote.sessionId,
      commands: [{ type: 'SetName', id: title.id, name: 'Observed title' }] });
    const undo = await call(client, 'ppt_undo', { sessionId: remote.sessionId });
    const redo = await call(client, 'ppt_redo', { sessionId: remote.sessionId });
    for (const item of [edit, undo, redo]) {
      assert.equal(Object.hasOwn(item.value, 'lint'), condition === 'with-lint');
    }
    const explicit = (await call(client, 'ppt_lint', { sessionId: remote.sessionId })).value;
    assert.deepEqual(explicit.checks, [...LAYOUT_CHECKS]);
    assert.deepEqual(explicit.issues, []);
    const rejected = await call(client, 'ppt_edit', { sessionId: remote.sessionId,
      commands: [{ type: 'SetName', id: 'absent-target', name: 'Invalid' }] }, false);
    assert.equal(rejected.ok, false);

    const outside = join(output, 'outside.pptx');
    await writeFile(outside, buildFixture(cleanTask.id));
    await symlink(outside, join(config.renderDirectory, 'linked.pptx'));
    const deniedOpen = await call(client, 'ppt_open', { path: join(config.renderDirectory, 'linked.pptx') }, false);
    assert.equal(deniedOpen.error.reason, 'eval-path-not-allowed');
    const deniedSave = await call(client, 'ppt_save', { sessionId: remote.sessionId, path: config.inputPath }, false);
    assert.equal(deniedSave.error.reason, 'eval-path-not-allowed');
    await symlink(outside, config.outputPath);
    const deniedLink = await call(client, 'ppt_save', { sessionId: remote.sessionId, path: config.outputPath }, false);
    assert.equal(deniedLink.error.reason, 'eval-path-not-allowed');
    await unlink(config.outputPath);
    const deniedRender = await call(client, 'ppt_render', { sessionId: remote.sessionId,
      slideNumber: 1, format: 'svg', path: join(output, 'outside.svg') }, false);
    assert.equal(deniedRender.error.reason, 'eval-path-not-allowed');
    await call(client, 'ppt_render', { sessionId: remote.sessionId,
      slideNumber: 1, format: 'svg', path: join(config.renderDirectory, 'preview.svg') });
    await call(client, 'ppt_render', { sessionId: remote.sessionId,
      slideNumber: 1, format: 'png', path: join(config.renderDirectory, 'preview.png') });
    assert((await readFile(join(config.renderDirectory, 'preview.svg'), 'utf8')).includes('<svg'));
    assert.equal((await readFile(join(config.renderDirectory, 'preview.png'))).subarray(1, 4).toString(), 'PNG');
    await call(client, 'ppt_save', { sessionId: remote.sessionId, path: 'result.pptx' });
    if (condition === 'with-lint') await call(client, 'ppt_close', { sessionId: remote.sessionId });
    assert.deepEqual(await readFile(outside), Buffer.from(buildFixture(cleanTask.id)), '越界文件不得改变');
  } finally {
    await client.close();
    await host.close('test-complete');
    await assert.rejects(() => host.manager.open(config.inputPath), error => error.reason === 'session-disposed');
    process.chdir(originalCwd);
  }
  const records = await lines(config.protocolPath);
  const replies = records.filter(record => record.direction === 'server-to-client' && record.toolName);
  for (const record of replies) {
    if (record.removedAutomaticLint) {
      assert.equal(condition, 'without-lint');
      assert(['ppt_edit', 'ppt_undo', 'ppt_redo'].includes(record.toolName));
      const normalized = structuredClone(record.original);
      const content = JSON.parse(normalized.result.content[0].text);
      delete content.value.lint;
      normalized.result.content[0].text = JSON.stringify(content);
      assert.deepEqual(record.delivered, normalized, '只允许移除自动 lint 字段');
    } else assert.deepEqual(record.delivered, record.original);
  }
  assert.equal(replies.filter(record => record.removedAutomaticLint).length, condition === 'without-lint' ? 3 : 0);
  const saved = replies.find(record => record.savedFile);
  assert(saved, '真实保存必须绑定文件哈希');
  const bytes = await readFile(config.outputPath);
  assert.equal(saved.savedFile.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(saved.savedFile.bytes, bytes.length);
  assert.equal(saved.savedFile.path, config.outputPath);
  assert(records.some(record => record.direction === 'lifecycle' && record.event === 'closed'));
  pair.push(replies.find(record => record.toolName === 'ppt_lint').delivered.result);
}
assert.deepEqual(pair[0], pair[1], '显式完整 lint 在两个条件下必须一致');

const configProbe = await configuration('with-lint');
const probePolicy = await createPathPolicy(configProbe);
await probePolicy.validate('ppt_render', { path: 'render/..preview.svg', format: 'svg' });
const externalRender = join(output, 'external-render');
await mkdir(externalRender, { recursive: true });
await symlink(externalRender, join(configProbe.renderDirectory, 'escape'));
await assert.rejects(() => probePolicy.validate('ppt_render',
  { path: 'render/escape/preview.svg', format: 'svg' }), error => error.reason === 'eval-path-not-allowed');
for (const invalid of [{ ...configProbe, maxCalls: 0 }, { ...configProbe, condition: 'unknown' },
  { ...configProbe, version: 2 }, { ...configProbe, arbitrary: true },
  { ...configProbe, outputPath: configProbe.inputPath }]) {
  await assert.rejects(() => createPathPolicy(invalid), error => error.reason === 'eval-invalid-config');
}

// 模拟文件读取迟到这一真实边界，关闭不能先于仍在处理的请求或其日志。
const slowConfig = await configuration('with-lint');
const [slowClientTransport, slowServerTransport] = InMemoryTransport.createLinkedPair();
const slowHost = await startEvaluationHost(slowConfig, { transport: slowServerTransport });
const slowClient = new Client({ name: 'eval-host-late-open', version: '1.0.0' });
let releaseOpen;
let startedOpen;
let managerDisposed;
let clientClosed = false;
slowClient.onclose = () => { clientClosed = true; };
const started = new Promise(resolveStarted => { startedOpen = resolveStarted; });
const released = new Promise(resolveRelease => { releaseOpen = resolveRelease; });
const disposed = new Promise(resolveDisposed => { managerDisposed = resolveDisposed; });
const realOpen = slowHost.manager.open.bind(slowHost.manager);
const realDispose = slowHost.manager.dispose.bind(slowHost.manager);
slowHost.manager.open = async path => { startedOpen(); await released; return realOpen(path); };
slowHost.manager.dispose = async () => { await realDispose(); managerDisposed(); };
if (process.env.AGENT_EVAL_HOST_MUTATE_CLOSE === '1') {
  slowHost.transport.settleResponses = async () => {};
}
try {
  await slowClient.connect(slowClientTransport);
  const response = slowClient.callTool({ name: 'ppt_open', arguments: { path: 'input.pptx' } })
    .then(value => ({ value }), error => ({ error }));
  await started;
  let finished = false;
  const closing = slowHost.close('test-cancel').then(value => { finished = true; return value; });
  await disposed;
  await new Promise(resolveTick => setImmediate(resolveTick));
  assert.equal(clientClosed, false, '未记录的迟到回复完成前不得关闭真实传输');
  assert.equal(finished, false, '关闭必须等待迟到回复被如实记录');
  releaseOpen();
  const responseResult = await response;
  assert.equal(responseResult.error, undefined, '迟到的真实失败回复不应被提前关闭连接吞掉');
  const failed = responseResult.value;
  assert.equal(failed.isError, true);
  assert.equal(payload(failed).error.reason, 'session-disposed');
  await closing;
} finally {
  releaseOpen();
  await slowClient.close();
  await slowHost.close('test-complete');
  process.chdir(originalCwd);
}
const slowRecords = await lines(slowConfig.protocolPath);
const lateReply = slowRecords.find(record => record.toolName === 'ppt_open' && record.direction === 'server-to-client');
const closedRecord = slowRecords.find(record => record.event === 'closed');
assert(lateReply && closedRecord && lateReply.sequence < closedRecord.sequence);

const complexConfig = await configuration('with-lint');
const gradient = '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="F0F0F0"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>';
const family = runtime.manifest.fontFamily;
const text = `<a:p><a:r><a:rPr sz="2400"><a:solidFill><a:srgbClr val="111111"/></a:solidFill><a:latin typeface="${family}"/><a:ea typeface="${family}"/><a:cs typeface="${family}"/></a:rPr><a:t>Actual glyph sampling</a:t></a:r></a:p>`;
await writeFile(complexConfig.inputPath, deck({ width: 640, height: 360,
  slides: [slideXml(sp({ x: 30, y: 30, w: 500, h: 100, name: 'Complex text', fill: gradient, text }))] }));
const [complexClientTransport, complexServerTransport] = InMemoryTransport.createLinkedPair();
const complexHost = await startEvaluationHost(complexConfig, { transport: complexServerTransport });
const complexClient = new Client({ name: 'eval-host-complex', version: '1.0.0' });
try {
  await complexClient.connect(complexClientTransport);
  const opened = (await call(complexClient, 'ppt_open', { path: 'input.pptx' })).value;
  const rejected = await call(complexClient, 'ppt_lint', { sessionId: opened.sessionId }, false);
  assert.equal(rejected.error.reason, 'contrast-resolver-failed', JSON.stringify(rejected));
  assert.match(rejected.error.message, /仅支持可直接求值的实色背景.*真实测量/);
} finally {
  await complexClient.close();
  await complexHost.close('test-complete');
  process.chdir(originalCwd);
}

const budgetConfig = await configuration('without-lint', 1);
const [budgetClientTransport, budgetServerTransport] = InMemoryTransport.createLinkedPair();
const budgetHost = await startEvaluationHost(budgetConfig, { transport: budgetServerTransport });
const budgetClient = new Client({ name: 'eval-host-budget', version: '1.0.0' });
try {
  await budgetClient.connect(budgetClientTransport);
  const opened = (await call(budgetClient, 'ppt_open', { path: 'input.pptx' })).value;
  const denied = await call(budgetClient, 'ppt_describe', { sessionId: opened.sessionId }, false);
  assert.equal(denied.error.reason, 'eval-call-limit');
  await budgetHost.closed;
} finally {
  await budgetClient.close();
  await budgetHost.close('test-complete');
  process.chdir(originalCwd);
}
const budgetRecords = await lines(budgetConfig.protocolPath);
assert(budgetRecords.some(record => record.event === 'fatal' && record.reason === 'call-budget-exceeded'));
assert(budgetRecords.some(record => record.event === 'closed' && record.reason === 'call-budget-exceeded'));

for (const reason of ['EOF', 'SIGTERM']) {
  const config = await configuration('with-lint');
  const configPath = join(resolve(config.inputPath, '..'), 'host.json');
  await writeFile(configPath, JSON.stringify(config));
  const child = spawn(process.execPath, [join(root, 'tooling/agent-eval/host.mjs'), '--config', configPath],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  let diagnostics = '';
  await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error(`host 未就绪：${diagnostics}`)), 10000);
    child.stderr.on('data', chunk => {
      diagnostics += chunk;
      if (diagnostics.includes('evaluation host ready')) { clearTimeout(timer); ready(); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`host 提前退出：${diagnostics}`)); });
  });
  if (reason === 'EOF') child.stdin.end();
  else child.kill('SIGTERM');
  let timeout;
  const result = await Promise.race([exit, new Promise((_, reject) => {
    timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`host ${reason} 未释放`)); }, 10000);
  })]).finally(() => clearTimeout(timeout));
  assert.equal(result.code, 0, `${reason} 正常关闭：${diagnostics}`);
  assert.equal(result.signal, null);
  const records = await lines(config.protocolPath);
  assert(records.some(record => record.event === 'closed' && record.reason === reason));
}

const stdioConfig = await configuration('with-lint');
const stdioConfigPath = join(resolve(stdioConfig.inputPath, '..'), 'host.json');
await writeFile(stdioConfigPath, JSON.stringify(stdioConfig));
const stdio = new StdioClientTransport({ command: process.execPath,
  args: [join(root, 'tooling/agent-eval/host.mjs'), '--config', stdioConfigPath], cwd: root, stderr: 'pipe' });
let diagnostics = '';
stdio.stderr.on('data', chunk => { diagnostics += chunk; });
const stdioClient = new Client({ name: 'eval-host-real-eof', version: '1.0.0' });
try {
  await stdioClient.connect(stdio);
  await call(stdioClient, 'ppt_open', { path: 'input.pptx' });
} finally {
  await stdioClient.close();
}
const stdioRecords = await lines(stdioConfig.protocolPath);
assert(stdioRecords.some(record => record.event === 'closed' && record.reason === 'EOF'), diagnostics);

console.log('Agent 评测 host：生产协议、单变量反馈、七项检查、真实渲染、路径、保存哈希、预算及关闭通过');
