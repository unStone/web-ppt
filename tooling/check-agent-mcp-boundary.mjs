import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import ts from 'typescript';
import { moduleClosure } from './lib/module-closure.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(join(root, name), 'utf8');
const manifest = JSON.parse(read('packages/agent-mcp/package.json'));
assert.equal(manifest.exports['.'].import, './dist/agent-mcp.js');
assert.equal(manifest.exports['.'].types, './dist/index.d.ts');
assert.equal(manifest.bin['web-ppt-agent'], './dist/cli.js');
assert(manifest.files.includes('skills'));
assert.equal(import.meta.resolve('@web-ppt/agent-mcp'), pathToFileURL(join(root, 'packages/agent-mcp/dist/agent-mcp.js')).href);
const closure = moduleClosure(join(root, 'packages/agent-mcp/dist/agent-mcp.js'));
const imports = new Set(closure.files.flatMap(file => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  return source.statements.flatMap(statement => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : []);
}));
for (const peer of ['@web-ppt/edit-core/agent', '@web-ppt/edit-core/opc', '@web-ppt/edit-core/save']) {
  assert(imports.has(peer), `MCP 必须通过公开 peer 入口 ${peer} 复用上游，不能把上游实现打入本包`);
}
assert(closure.source.includes('createAgentMcpServer'));
assert(!/node:http|node:https|fetch\(/.test(closure.source), 'stdio 包不能包含 HTTP 客户端或服务器调用');
assert(read('packages/agent-mcp/dist/cli.js').startsWith('#!/usr/bin/env node'));
const directory = join(root, 'out/agent-mcp');
mkdirSync(directory, { recursive: true });
const consumer = join(directory, 'consumer.ts');
writeFileSync(consumer, `import { AgentMcpSessionManager, createAgentMcpServer, type AgentMcpOptions } from '@web-ppt/agent-mcp';
const options: AgentMcpOptions = { lint: { checks: ['off-canvas'] } };
const manager = new AgentMcpSessionManager(options);
const { server } = createAgentMcpServer(options);
void manager;
void server;
`);
execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), consumer,
  '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2020', '--module', 'ESNext', '--moduleResolution', 'bundler', '--types', 'node'], { cwd: root, stdio: 'inherit' });
const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', join(root, 'out/npm-cache')], {
  cwd: join(root, 'packages/agent-mcp'), encoding: 'utf8',
}))[0];
for (const name of ['dist/agent-mcp.js', 'dist/cli.js', 'dist/index.d.ts', 'skills/web-ppt/SKILL.md']) {
  assert(packed.files.some((file) => file.path === name), `npm 包必须包含 ${name}`);
}
assert(existsSync(join(root, 'packages/agent-mcp/skills/web-ppt/SKILL.md')));
console.log(`agent-mcp 按需边界通过：${closure.gzip}B gzip；stdio、类型与 Skill 内容完整`);
