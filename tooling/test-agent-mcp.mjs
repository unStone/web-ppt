import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { bundleNode } from './lib/bundle-node.mjs';
import { countedAssert } from './lib/counted-assert.mjs';

const { assert: check, record } = countedAssert('agentMcp');
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'out/agent-mcp');
await mkdir(out, { recursive: true });
const dist = process.argv.includes('--dist');
const entry = join(out, 'entry.mjs');
await copyFile(join(root, 'fixtures/sample-agent-mcp.pptx'), join(out, 'source.pptx'));
await writeFile(entry, `export * as core from ${JSON.stringify(join(root, 'packages/core/src/index.ts'))};
export * as mcp from ${JSON.stringify(join(root, 'packages/agent-mcp/src/index.ts'))};`);
const api = dist ? {
  core: await import('@web-ppt/core'), mcp: await import('@web-ppt/agent-mcp'),
} : await bundleNode({ root, entry, output: join(out, 'contract.mjs') });
const { core, mcp } = api;
const manager = new mcp.AgentMcpSessionManager();
await check.rejects(() => manager.open('https://example.invalid/deck.pptx'), (error) => error.reason === 'invalid-path');
await check.rejects(() => manager.open(join(out, 'missing.pptx')), (error) => error.reason === 'open-failed');
const opened = await manager.open(join(out, 'source.pptx'));
check.equal(opened.sessionId, 'session-1');
check.equal(opened.path, join(out, 'source.pptx'));
const described = await manager.call(opened.sessionId, 'describe', {});
check(described.ok && described.value.totalElements === 3);
const title = described.value.slides[0].elements.find((element) => element.name === '页面标题');
check(title);
const [first, second] = await Promise.all([
  manager.call(opened.sessionId, 'edit', { commands: [{ type: 'SetName', id: title.id, name: '第一次' }] }),
  manager.call(opened.sessionId, 'edit', { commands: [{ type: 'SetName', id: title.id, name: '第二次' }] }),
]);
check(first.ok && second.ok);
check.equal(second.value.history.undoCount, 2);
const afterBatch = await manager.call(opened.sessionId, 'describe', {});
check.equal(afterBatch.value.slides[0].elements.find((element) => element.id === title.id).name, '第二次');
const undone = await manager.call(opened.sessionId, 'undo', {});
check(undone.ok && undone.value.history.redoCount === 1);
const redone = await manager.call(opened.sessionId, 'redo', {});
check(redone.ok && redone.value.history.undoCount === 2);
const savedPath = join(out, 'saved.pptx');
const saved = await manager.save(opened.sessionId, savedPath);
check(saved.ok && saved.value.path === savedPath && saved.value.saveMode === 'patch');
const savedPres = await core.parse(await readFile(savedPath), { lazy: false });
check(savedPres.slides[0].elements.some((element) => element.name === '第二次'));
savedPres.dispose();
await check.rejects(() => manager.save(opened.sessionId, join(out, 'missing-dir', 'failed.pptx')), (error) => error.reason === 'save-failed');
check(!(await readdir(out)).some((name) => name.endsWith('.tmp')));
await check.rejects(() => manager.save(opened.sessionId, 'https://example.invalid/saved.pptx'), (error) => error.reason === 'invalid-path');
await manager.close(opened.sessionId);
await check.rejects(() => manager.call(opened.sessionId, 'describe', {}), (error) => error.reason === 'target-not-found');
await manager.dispose();
await check.rejects(() => manager.open(join(out, 'source.pptx')), (error) => error.reason === 'session-disposed');
const cancelling = new mcp.AgentMcpSessionManager({ lint: {
  resolvePlaceholderPrompts: ({ signal }) => new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(undefined), { once: true });
  }),
} });
const cancelOpen = await cancelling.open(join(out, 'source.pptx'));
const pendingLint = cancelling.call(cancelOpen.sessionId, 'lint', { checks: ['placeholder-prompt-left'] });
await new Promise((resolve) => setTimeout(resolve, 0));
await cancelling.close(cancelOpen.sessionId);
const cancelled = await pendingLint;
check(!cancelled.ok && cancelled.error.reason === 'aborted');
await cancelling.dispose();
const cliPath = dist ? join(root, 'packages/agent-mcp/dist/cli.js') : join(out, 'cli.mjs');
if (!dist) await bundleNode({ root, entry: join(root, 'packages/agent-mcp/src/cli.ts'), output: cliPath });
const configPath = join(out, 'runtime.json');
await writeFile(configPath, JSON.stringify({
  measureModule: join(root, 'tooling/lib/agent-mcp-runtime.mjs'),
  rasterizerModule: join(root, 'tooling/lib/agent-mcp-runtime.mjs'),
}));
const networkCalls = [];
const blocked = (name) => () => { networkCalls.push(name); throw new Error(`禁止网络调用：${name}`); };
const original = { fetch: globalThis.fetch, http: http.request, https: https.request, net: net.connect, tls: tls.connect };
globalThis.fetch = blocked('fetch');
http.request = blocked('http.request');
https.request = blocked('https.request');
net.connect = blocked('net.connect');
tls.connect = blocked('tls.connect');
let client;
try {
  const transport = new StdioClientTransport({ command: process.execPath, args: [cliPath, '--config', configPath], stderr: 'pipe' });
  client = new Client({ name: 'agent-mcp-contract', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const listed = await client.listTools();
  check.deepEqual(listed.tools.map((tool) => tool.name), [
    'ppt_open', 'ppt_describe', 'ppt_element', 'ppt_lint', 'ppt_render', 'ppt_edit',
    'ppt_undo', 'ppt_redo', 'ppt_save', 'ppt_close',
  ]);
  check(listed.tools.find((tool) => tool.name === 'ppt_edit').inputSchema.properties.commands);
  check(listed.tools.find((tool) => tool.name === 'ppt_lint').inputSchema.properties.maxIssues);
  const call = async (name, args) => {
    const response = await client.callTool({ name, arguments: args });
    check(!response.isError, `${name}: ${JSON.stringify(response)}`);
    return JSON.parse(response.content[0].text).value;
  };
  const remote = await call('ppt_open', { path: join(out, 'source.pptx') });
  const remoteDescription = await call('ppt_describe', { sessionId: remote.sessionId });
  const remoteTitle = remoteDescription.slides[0].elements.find((element) => element.name === '页面标题');
  const remoteEdit = await call('ppt_edit', { sessionId: remote.sessionId, commands: [{ type: 'SetName', id: remoteTitle.id, name: 'MCP 标题' }] });
  check(remoteEdit.history.undoCount === 1);
  const svgPath = join(out, 'slide-1.svg');
  const rendered = await call('ppt_render', { sessionId: remote.sessionId, slideNumber: 1, format: 'svg', path: svgPath });
  check.equal(rendered.path, svgPath, JSON.stringify(rendered));
  check((await readFile(svgPath, 'utf8')).includes('<svg'));
  const remoteSavedPath = join(out, 'stdio-saved.pptx');
  const remoteSaved = await call('ppt_save', { sessionId: remote.sessionId, path: remoteSavedPath });
  check(!('bytes' in remoteSaved));
  const remotePres = await core.parse(await readFile(remoteSavedPath), { lazy: false });
  check(remotePres.slides[0].elements.some((element) => element.name === 'MCP 标题'));
  remotePres.dispose();
  await call('ppt_close', { sessionId: remote.sessionId });
  const invalid = await client.callTool({ name: 'ppt_open', arguments: { path: 'https://example.invalid/deck.pptx' } });
  check(invalid.isError && JSON.parse(invalid.content[0].text).error.reason === 'invalid-path');
} finally {
  if (client) await client.close();
  globalThis.fetch = original.fetch;
  http.request = original.http;
  https.request = original.https;
  net.connect = original.net;
  tls.connect = original.tls;
}
check.deepEqual(networkCalls, []);
record();
console.log(`Agent MCP 文件会话与 stdio 通过${dist ? '（独立产物）' : ''}`);
