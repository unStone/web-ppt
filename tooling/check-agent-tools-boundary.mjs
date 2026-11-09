import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import ts from 'typescript';
import { moduleClosure } from './lib/module-closure.mjs';

const root = resolve(import.meta.dirname, '..');
/**
 * 按语法树收集产物真正引用的 DOM 全局与模块。不能做文本匹配：压缩器会把字符串数组拼成
 * `"…doors.window.prism…".split(".")`，打包器会写入 `// src/document.ts` 模块注释，两者都不是 DOM 访问。
 */
const codeReferences = (source) => {
  const globals = new Set(),
    modules = new Set();
  const visit = (node) => {
    if (
      ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === 'document' || node.expression.text === 'window')
    )
      globals.add(node.expression.text);
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      modules.add(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node)
      && node.arguments.length
      && ts.isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      modules.add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('closure.js', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS));
  return { globals, modules: [...modules] };
};
const read = (name) => readFileSync(join(root, name), 'utf8');
const manifest = JSON.parse(read('packages/edit-core/package.json'));
assert.equal(manifest.exports['./agent'].import, './dist/agent.js');
assert.equal(manifest.exports['./agent'].types, './dist/agent/index.d.ts');
assert.equal(manifest.exports['./agent/schema.json'], './schemas/agent-tools.schema.json');
assert(manifest.files.includes('schemas'));
const main = moduleClosure(join(root, 'packages/edit-core/dist/edit-core.js'));
assert(!main.source.includes('openAgentSession'), '基础入口闭包不能包含 Agent 工具');
const agent = moduleClosure(join(root, 'packages/edit-core/dist/agent.js'));
assert(agent.source.includes('openAgentSession'));
const agentReferences = codeReferences(agent.source);
assert(
  agentReferences.globals.size === 0
    && !agentReferences.modules.some((name) => name === 'node:fs' || name.startsWith('ts-json-schema-generator')),
  `新入口不能携带 Schema 生成器或 DOM：${JSON.stringify({ globals: [...agentReferences.globals], modules: agentReferences.modules })}`,
);
assert(!agentReferences.modules.some((name) => name === 'ajv' || name.startsWith('ajv/')), '校验器必须打包运行时，不能依赖宿主 Ajv');
assert(!Object.keys(manifest.dependencies).some((name) => /ajv|schema/.test(name)));
assert.equal(
  createRequire(import.meta.url).resolve('@web-ppt/edit-core/agent/schema.json'),
  join(root, 'packages/edit-core/schemas/agent-tools.schema.json'),
);
const directory = join(root, 'out/agent-tools');
mkdirSync(directory, { recursive: true });
const consumer = join(directory, 'consumer.ts');
writeFileSync(
  consumer,
  `import { listAgentTools, openAgentSession, type AgentCommand, type AgentToolInput } from '@web-ppt/edit-core/agent';
const command: AgentCommand = { type: 'ReplaceImage', id: 'image', bytes: 'AA==', mime: 'image/png' };
const input: AgentToolInput<'edit'> = { commands: [command] };
const tools = listAgentTools();
void openAgentSession(new Uint8Array([80, 75])).then((session) => session.call('edit', input));
void tools;
// @ts-expect-error 图片字节在 JSON 工具面中只能是 Base64 字符串
const invalid: AgentCommand = { type: 'ReplaceImage', id: 'image', bytes: new Uint8Array(), mime: 'image/png' };
void invalid;
`,
);
execFileSync(
  process.execPath,
  [
    join(root, 'node_modules/typescript/bin/tsc'),
    consumer,
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--target',
    'ES2020',
    '--module',
    'ESNext',
    '--moduleResolution',
    'bundler',
  ],
  { cwd: root, stdio: 'inherit' },
);
const packed = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', join(root, 'out/npm-cache')], {
    cwd: join(root, 'packages/edit-core'),
    encoding: 'utf8',
  }),
)[0];
for (const name of ['dist/agent.js', 'dist/agent/index.d.ts', 'dist/agent/types.d.ts', 'schemas/agent-tools.schema.json']) {
  assert(
    packed.files.some((file) => file.path === name),
    `npm 包必须包含 ${name}`,
  );
}
console.log(`Agent 工具按需边界通过：${agent.gzip}B gzip；基础入口未引入新实现`);
