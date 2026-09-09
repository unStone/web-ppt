import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { moduleClosure } from './lib/module-closure.mjs';

const core = await import('@web-ppt/core'), edit = await import('@web-ppt/edit-core');
const started = performance.now(), chart = await import('@web-ppt/edit-core/chart-shared');
const importMs = performance.now() - started;
const afterGc = () => { global.gc?.(); return process.memoryUsage(); };

async function measureCase(fixture, scenario) {
  const presentation = await core.parse(readFileSync(`fixtures/${fixture}`), { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation)), api = chart.createChartDataEditor(editor);
  const start = performance.now(), frames = chart.listEditableCharts(editor.doc);
  const data = chart.queryChartData(editor.doc, frames[0].id), firstQueryMs = performance.now() - start;
  const creating = performance.now();
  const category = scenario === 'new-category-series' ? api.addCategory(data.chartId, ['Measured group', 'Measured leaf']) : undefined;
  const series = ['source-cell', 'source-xy-point'].includes(scenario) ? data.series[0].id : api.addSeries(data.chartId, 'Measured shared series');
  const point = ['new-xy-series', 'source-xy-point'].includes(scenario)
    ? api.addPoint(data.chartId, series, { x: 1, value: 2, size: 3 }) : category ?? data.categories[1].id;
  if (scenario === 'source-xy-point') api.removePoint(data.chartId, series, data.series[0].points[0].id);
  const structuralSetupMs = performance.now() - creating;
  const baseline = afterGc(), samples = [], edits = [], saves = [];
  let outputBytes = 0;
  for (let index = 0; index < 25; index++) {
    const editing = performance.now();
    api.setValue(data.chartId, series, point, 600 + index);
    frames.forEach(frame => editor.effectiveElement(frame.id));
    edits.push(performance.now() - editing);
    const saving = performance.now();
    outputBytes = (await editor.save()).length; saves.push(performance.now() - saving);
    samples.push(process.memoryUsage());
  }
  edits.sort((a, b) => a - b); saves.sort((a, b) => a - b);
  const retained = afterGc();
  const result = { fixture, scenario, firstQueryMs, structuralSetupMs, editAndProjectionMedianMs: edits[12], editAndProjectionP95Ms: edits[23],
    saveMedianMs: saves[12], saveP95Ms: saves[23], outputBytes,
    heapGrowthSampledBytes: Math.max(...samples.map(sample => sample.heapUsed)) - baseline.heapUsed,
    rssGrowthSampledBytes: Math.max(...samples.map(sample => sample.rss)) - baseline.rss,
    heapAfterGcDeltaBytes: global.gc ? retained.heapUsed - baseline.heapUsed : null };
  editor.dispose(); presentation.dispose();
  return result;
}

const cases = [];
for (const [fixture, scenario] of [
  ['sample-chart-shared.pptx', 'source-cell'], ['sample-chart-shared-cache.pptx', 'source-cell'],
  ['sample-chart-shared.pptx', 'new-series'], ['sample-chart-shared-xy.pptx', 'new-xy-series'],
  ['sample-chart-shared.pptx', 'new-category-series'],
  ['sample-chart-shared-xy-shared-x.pptx', 'source-xy-point'],
]) {
  const baseline = afterGc();
  const result = await measureCase(fixture, scenario);
  // 离开测量作用域再收集，避免局部 editor 引用把已释放的文稿误算为常驻资源。
  await new Promise(resolve => setImmediate(resolve));
  const released = afterGc();
  cases.push({ ...result, heapAfterDisposeGcDeltaBytes: global.gc ? released.heapUsed - baseline.heapUsed : null });
}
const disposalHeapBytes = [];
if (global.gc) for (let cycle = 0; cycle < 6; cycle++) {
  await measureCase('sample-chart-shared.pptx', 'new-category-series');
  await new Promise(resolve => setImmediate(resolve));
  disposalHeapBytes.push(afterGc().heapUsed);
}
const module = moduleClosure('packages/edit-core/dist/chart-shared.js');
const report = { node: process.version, forcedGc: !!global.gc, moduleRawBytes: module.raw, moduleGzipBytes: module.gzip, importMs, cases,
  disposalProbe: { scenario: 'new-category-series', iterationsPerDocument: 25, heapUsedBytesAfterRelease: disposalHeapBytes },
  note: '本机 Node，3 页，25 次；入口体积包含所有相对静态分块，不含公共外部依赖。使用 --expose-gc 区分操作后保留与文稿释放后增量；采样内存不代表浏览器峰值或跨机器预算。' };
mkdirSync('out/chart-shared', { recursive: true });
writeFileSync(process.argv[2] ?? 'out/chart-shared/measure.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
