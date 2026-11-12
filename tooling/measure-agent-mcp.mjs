import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { moduleClosure } from './lib/module-closure.mjs';

const root = resolve(import.meta.dirname, '..');
if (process.argv.includes('--child')) {
  const start = performance.now(),
    memory = process.memoryUsage().heapUsed;
  const { AgentMcpSessionManager } = await import('@web-ppt/agent-mcp');
  const loaded = performance.now();
  const manager = new AgentMcpSessionManager();
  const opened = await manager.open(join(root, 'fixtures/sample-agent-mcp.pptx'));
  const described = await manager.call(opened.sessionId, 'describe', {});
  if (!described.ok) throw new Error(described.error.message);
  const title = described.value.slides[0].elements.find((element) => element.name === '页面标题');
  const beginEdit = performance.now();
  const edited = await manager.call(opened.sessionId, 'edit', { commands: [{ type: 'SetName', id: title.id, name: '性能测量' }] });
  const editMs = performance.now() - beginEdit;
  if (!edited.ok) throw new Error(edited.error.message);
  await manager.close(opened.sessionId);
  await manager.dispose();
  process.stdout.write(JSON.stringify({ coldImportMs: loaded - start, editMs, heapDeltaBytes: process.memoryUsage().heapUsed - memory }));
} else {
  const trials = Array.from({ length: 5 }, () =>
    JSON.parse(execFileSync(process.execPath, [import.meta.filename, '--child'], { cwd: root, encoding: 'utf8' })),
  );
  const closure = moduleClosure(join(root, 'packages/agent-mcp/dist/agent-mcp.js'));
  const output = { node: process.version, trials, gzipBytes: closure.gzip, rawBytes: closure.raw };
  const directory = join(root, 'out/agent-mcp');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'performance.json'), `${JSON.stringify(output, null, 2)}\n`);
  const median = (key) => trials.map((item) => item[key]).sort((a, b) => a - b)[2];
  console.log(
    `agent-mcp ${closure.gzip}B gzip；5 个独立进程中位数：冷加载 ${median('coldImportMs').toFixed(2)}ms，编辑并观察 ${median('editMs').toFixed(2)}ms，堆增长 ${median('heapDeltaBytes')}B（含 peer、解析与编辑）`,
  );
}
