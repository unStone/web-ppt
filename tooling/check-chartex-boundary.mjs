import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const implementation = readFileSync('packages/core/dist/chart-ex.js', 'utf8');
const markers = ['ChartEx 层级路径缺失', 'ChartEx 分箱数量超限', 'ChartEx 工作簿不可用'];
if (!markers.every((marker) => implementation.includes(marker))) throw new Error('ChartEx 按需入口缺少布局或输入实现');
const seen = new Set();
function inspect(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  if (markers.some((marker) => source.includes(marker))) throw new Error(`默认依赖图引入 ChartEx：${file}`);
  for (const match of source.matchAll(/(?:from\s*|import\s*)["'](\.\/?[^"']+\.js)["']/g)) inspect(resolve(dirname(file), match[1]));
}
for (const file of ['core', 'worker']) inspect(resolve(`packages/core/dist/${file}.js`));
const gzip = gzipSync(implementation).length;
if (gzip > 22000) throw new Error(`ChartEx 按需入口超过 22KB gzip：${gzip}`);
const opc = await build({
  stdin: { contents: "export * from '@web-ppt/edit-core/opc';", resolveDir: process.cwd(), sourcefile: 'opc-boundary.mjs' },
  bundle: true, platform: 'browser', format: 'esm', minify: true, write: false, metafile: true,
});
if (Object.keys(opc.metafile.inputs).some((file) => file.includes('packages/core/')))
  throw new Error('通用 OPC 补丁器不能因解析上下文继承引入 core');
console.log(`ChartEx 边界通过：默认入口无布局/工作簿实现，按需入口 ${gzip}B gzip；独立 OPC ${gzipSync(opc.outputFiles[0].contents).length}B，无 core 依赖`);
