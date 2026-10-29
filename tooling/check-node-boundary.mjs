import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = join(root, 'packages/core/dist/core.js');
const optional = join(root, 'packages/core/dist/node.js');
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
assert.ok(existsSync(optional), '缺少 Node 渲染按需构建产物');
const coreSource = readFileSync(core, 'utf8');
const optionalSource = readFileSync(optional, 'utf8');
const defaultGraph = sourceGraph(join(sourceRoot, 'index.ts'));
assert.ok(!defaultGraph.has(join(sourceRoot, 'node-export.ts')), '默认 core 源码依赖图触达 Node 渲染入口');
assert.ok(!coreSource.includes('renderSlideSvgInNode'), '默认 core 入口意外包含 Node 渲染 API');
assert.ok(!coreSource.includes('node-measure-required'), '默认 core 入口意外包含 Node 注入校验');
assert.ok(optionalSource.includes('renderSlideSvgInNode'), 'Node 按需入口缺少 SVG API');
assert.ok(optionalSource.includes('renderSlidePngInNode'), 'Node 按需入口缺少 PNG API');
assert.ok(optionalSource.includes('node-measure-required'), 'Node 按需入口缺少测字注入稳定 reason');
assert.ok(optionalSource.includes('node-rasterizer-required'), 'Node 按需入口缺少光栅化注入稳定 reason');
console.log('  node · 默认入口零新增 API，按需入口与稳定 reason 边界通过');
