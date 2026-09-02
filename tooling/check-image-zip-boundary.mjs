import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = join(root, 'packages/core/dist/core.js');
const optional = join(root, 'packages/core/dist/image-zip.js');
const sourceRoot = join(root, 'packages/core/src');

function resolveModule(importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const candidate = resolve(dirname(importer), specifier);
  const paths = extname(candidate) ? [candidate] : [`${candidate}.ts`, join(candidate, 'index.ts')];
  return paths.find((path) => existsSync(path)) ?? null;
}

function sourceGraph(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g)) {
      const dependency = resolveModule(file, match[1]);
      if (dependency) visit(dependency);
    }
  };
  visit(entry);
  return seen;
}

assert.ok(existsSync(core), '缺少默认 core 构建产物');
assert.ok(existsSync(optional), '缺少 image-zip 按需构建产物');
const coreSource = readFileSync(core, 'utf8');
const optionalSource = readFileSync(optional, 'utf8');
const defaultGraph = sourceGraph(join(sourceRoot, 'index.ts'));
assert.ok(!defaultGraph.has(join(sourceRoot, 'image-zip.ts')), '默认 core 源码依赖图触达批量 ZIP 入口');
assert.ok(!coreSource.includes('presentationToImageZip'), '默认 core 入口意外包含批量 ZIP API');
assert.ok(!coreSource.includes('concurrency 必须是'), '默认 core 入口意外包含批量 ZIP 实现');
assert.ok(!coreSource.includes('PresentationImageExportError'), '默认 core 入口意外包含批量导出错误边界');
assert.ok(gzipSync(coreSource).length <= 92 * 1024, '默认 core 入口超过 92KB gzip 预算');
assert.ok(optionalSource.includes('presentationToImageZip'), '按需入口缺少批量 ZIP API');
assert.ok(optionalSource.includes('concurrency 必须是'), '按需入口缺少批量 ZIP 实现');
assert.ok(optionalSource.includes('PresentationImageExportError'), '按需入口缺少逐页错误边界');
console.log('  image-zip · 默认入口零新增 API/实现，按需入口边界通过');
