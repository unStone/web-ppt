import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TASKS } from './agent-eval/tasks.mjs';
import { buildFixture } from './agent-eval/fixtures.mjs';
import { judgeTask } from './agent-eval/judge.mjs';
import { startEvaluationHost } from './agent-eval/host.mjs';

const root = resolve(import.meta.dirname, '..');
const base = join(root, 'out/agent-eval/reachability');
await mkdir(base, { recursive: true });
const originalCwd = process.cwd();
const records = [];
const ordered = [...TASKS].sort((left, right) => Number(right.kind === 'missing-font') - Number(left.kind === 'missing-font'));

async function call(client, name, args) {
  const response = await client.callTool({ name, arguments: args });
  assert(!response.isError, `${name} ${JSON.stringify(response)}`);
  const payload = JSON.parse(response.content[0].text);
  assert.equal(payload.ok, true);
  return payload.value;
}

for (const task of ordered) {
  const folder = await mkdtemp(join(base, `${task.id}-`));
  const inputBytes = buildFixture(task.id);
  const config = {
    version: 1,
    condition: 'with-lint',
    inputPath: join(folder, 'input.pptx'),
    outputPath: join(folder, 'result.pptx'),
    renderDirectory: join(folder, 'render'),
    protocolPath: join(folder, 'protocol.jsonl'),
    maxCalls: 64,
  };
  await mkdir(config.renderDirectory);
  await writeFile(config.inputPath, inputBytes);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const host = await startEvaluationHost(config, { transport: serverTransport });
  const client = new Client({ name: 'eval-reachability', version: '1.0.0' });
  const record = { taskId: task.id, kind: task.kind, folder, commands: [], pass: false };
  try {
    await client.connect(clientTransport);
    const opened = await call(client, 'ppt_open', { path: 'input.pptx' });
    const described = await call(client, 'ppt_describe', { sessionId: opened.sessionId });
    const elements = described.slides[0].elements;
    const title = elements.find((element) => element.name === task.titleName);
    const body = elements.find((element) => element.name === 'Evaluation body');
    const image = elements.find((element) => element.name === 'Evaluation image');
    const card = elements.find((element) => element.name === 'Evaluation card');
    assert(title && body && image && card);
    const oldText = title.paragraphs[0].text;
    let fontCommand;
    if (task.kind === 'missing-font') {
      const before = await call(client, 'ppt_lint', { sessionId: opened.sessionId });
      assert(
        before.issues.some((issue) => issue.reason === 'missing-font'),
        '初始未知 EA 声明必须真实可见',
      );
      fontCommand = {
        type: 'SetRunProps',
        id: title.id,
        range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: oldText.length } },
        props: { font: task.fontFamily },
      };
      const changed = await call(client, 'ppt_edit', { sessionId: opened.sessionId, commands: [fontCommand] });
      assert(changed.affectedElements.includes(title.id), '同首选 family 的字体修复不得是 no-op');
      assert.equal(changed.history.undoCount, 1, '字体修复必须先于标题编辑建立真实历史');
      const after = await call(client, 'ppt_lint', { sessionId: opened.sessionId });
      assert(!after.issues.some((issue) => issue.reason === 'missing-font'), '单独 SetRunProps 必须清除未知 EA 声明');
      record.fontRepairBeforeTitle = { before, command: fontCommand, changed, after };
    }
    const commands = [
      {
        type: 'EditText',
        id: title.id,
        ops: [{ type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: oldText.length }, text: task.expectedTitle }],
      },
    ];
    if (task.kind === 'text-overflow') commands.push({ type: 'SetXfrm', id: body.id, h: 250 });
    if (['element-overlap', 'off-canvas'].includes(task.kind)) {
      commands.push({ type: 'SetXfrm', id: card.id, x: 460, y: 320 });
    }
    if (task.kind === 'image-distorted') commands.push({ type: 'SetXfrm', id: image.id, h: 90 });
    if (task.kind === 'low-contrast') {
      commands.push({
        type: 'SetRunProps',
        id: title.id,
        range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: task.expectedTitle.length } },
        props: { color: '#202020' },
      });
    }
    record.commands = [...(fontCommand ? [fontCommand] : []), ...commands];
    record.edited = await call(client, 'ppt_edit', { sessionId: opened.sessionId, commands });
    record.lint = await call(client, 'ppt_lint', { sessionId: opened.sessionId });
    await call(client, 'ppt_save', { sessionId: opened.sessionId, path: 'result.pptx' });
    await call(client, 'ppt_close', { sessionId: opened.sessionId });
    assert.deepEqual(await readFile(config.inputPath), Buffer.from(inputBytes), '输入保持不变');
    record.judgement = await judgeTask({ taskId: task.id, inputBytes, outputBytes: await readFile(config.outputPath) });
    record.pass = record.judgement.pass;
  } catch (error) {
    record.error = { name: error.name, message: error.message, stack: error.stack };
  } finally {
    await client.close();
    await host.close('reachability-complete');
    process.chdir(originalCwd);
  }
  records.push(record);
  await writeFile(join(base, 'report.json'), `${JSON.stringify(records, null, 2)}\n`);
  console.log(`${task.id} ${task.kind}: ${record.pass ? 'PASS' : 'FAIL'}`);
}
assert(
  records.every((record) => record.pass),
  `生产 MCP 合法修复不可达，详见 ${join(base, 'report.json')}`,
);
console.log('8 个评测案例均经真实生产 MCP 编辑、保存与独立判定通过');
