import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { moduleClosure } from './lib/module-closure.mjs';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'packages/edit-core/package.json'), 'utf8'));
assert.equal(manifest.exports['./fill'].import, './dist/fill.js');
assert.equal(manifest.exports['./fill'].types, './dist/fill/index.d.ts');
assert.equal(manifest.exports['./fill/schema.json'], './schemas/template-fill.schema.json');
assert.equal(
  createRequire(import.meta.url).resolve('@web-ppt/edit-core/fill/schema.json'),
  join(root, 'packages/edit-core/schemas/template-fill.schema.json'),
);
const main = moduleClosure(join(root, 'packages/edit-core/dist/edit-core.js'));
assert(!main.source.includes('fillTemplate'), '默认编辑入口不能包含模板填充实现');
const fill = moduleClosure(join(root, 'packages/edit-core/dist/fill.js'));
assert(fill.source.includes('fillTemplate') && fill.source.includes('layout-role-mismatch'));
assert(!/(?:from\s*['"]ajv|require\(['"]ajv)/.test(fill.source), '模板大纲校验器不能依赖宿主 Ajv');
assert(!/\b(?:node:fs|node:http|node:https|document\.|window\.)/.test(fill.source), '模板填充入口必须能在无 DOM、无文件系统的环境执行');
const out = join(root, 'out/template-fill');
mkdirSync(out, { recursive: true });
const consumer = join(out, 'consumer.ts');
writeFileSync(
  consumer,
  `import { fillTemplate, templateFillSchema, TemplateFillError, type TemplateFillOutline } from '@web-ppt/edit-core/fill';
const outline: TemplateFillOutline = { version: 1, slides: [{ type: 'title', title: 'Editable' }] };
void fillTemplate('editorial', outline, { lint: { measureText: text => text.length } }).then(result => {
  const bytes: Uint8Array = result.bytes;
  const slideId: string = result.description.slides[0].id;
  void bytes; void slideId;
});
void TemplateFillError; void templateFillSchema;
// @ts-expect-error 大纲页类型不能是未知值
const invalid: TemplateFillOutline = { version: 1, slides: [{ type: 'unknown', title: 'Invalid' }] };
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
for (const file of [
  'dist/fill.js',
  'dist/fill/index.d.ts',
  'dist/fill/api.d.ts',
  'dist/fill/types.d.ts',
  'schemas/template-fill.schema.json',
]) {
  assert(
    packed.files.some((item) => item.path === file),
    `npm 包必须包含 ${file}`,
  );
}
console.log(`模板填充发布边界通过：${fill.gzip}B gzip；默认闭包、类型、Schema 与 npm 清单通过`);
