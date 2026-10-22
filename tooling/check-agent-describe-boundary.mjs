import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { moduleClosure } from './lib/module-closure.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(join(root, name), 'utf8');
const manifest = JSON.parse(read('packages/edit-core/package.json'));
assert.equal(manifest.exports['./describe'].import, './dist/describe.js');
assert.equal(manifest.exports['./describe'].types, './dist/describe/index.d.ts');
assert.equal(manifest.exports['./describe/schema.json'], './schemas/describe.schema.json');
assert(manifest.files.includes('schemas'));
const main = moduleClosure(join(root, 'packages/edit-core/dist/edit-core.js'));
assert(!main.source.includes('describePresentation'), '基础入口闭包不能包含 describe');
const describe = moduleClosure(join(root, 'packages/edit-core/dist/describe.js'));
assert(describe.source.includes('describePresentation'));
assert(!/\b(?:ajv|ts-json-schema-generator|node:fs|document\.|window\.)\b/.test(describe.source), '新入口不能携带开发依赖或 DOM');
assert(!Object.keys(manifest.dependencies).some((name) => /ajv|schema/.test(name)));
assert.equal(createRequire(import.meta.url).resolve('@web-ppt/edit-core/describe/schema.json'), join(root, 'packages/edit-core/schemas/describe.schema.json'));
const directory = join(root, 'out/agent-describe');
mkdirSync(directory, { recursive: true });
const consumer = join(directory, 'consumer.ts');
writeFileSync(consumer, `import { describePresentation, DescribeError, type PresentationDescription } from '@web-ppt/edit-core/describe';
import { createEmptyDoc, type ElementId } from '@web-ppt/edit-core';
const doc = createEmptyDoc({ width: 100, height: 100 });
const result: PresentationDescription = describePresentation(doc, { maxChars: 1000 });
const target: ElementId = result.slides[0].elements[0].id;
const error: Error = new DescribeError('invalid-budget', target);
// @ts-expect-error 预算只接受数字
describePresentation(doc, { maxChars: '1000' });
// @ts-expect-error 只读输出不能被调用方改写
result.version = 1;
void error;
`);
execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), consumer,
  '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2020', '--module', 'ESNext', '--moduleResolution', 'bundler'], { cwd: root, stdio: 'inherit' });
const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', join(root, 'out/npm-cache')], {
  cwd: join(root, 'packages/edit-core'), encoding: 'utf8',
}))[0];
for (const name of ['dist/describe.js', 'dist/describe/index.d.ts', 'dist/describe/types.d.ts', 'schemas/describe.schema.json']) {
  assert(packed.files.some((file) => file.path === name), `npm 包必须包含 ${name}`);
}
console.log(`describe 按需边界通过：${describe.gzip}B gzip；基础入口未引入新实现`);
