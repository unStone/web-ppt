import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { withChartBrowser } from './lib/chart-browser-lab.mjs';
import { sourceAliasArgs } from './lib/bundle-browser.mjs';
import { measureChartCase, measureChartCold, recordMeasurementError } from './lib/chart-browser-measurement.mjs';

const root = resolve('.'), out = join(root, 'out/chart-shared-browser'), source = process.argv.includes('--source');
const pages = (process.env.CHART_MEASURE_PAGES ?? '3,50,200').split(',').map(Number);
const iterations = Number(process.env.CHART_MEASURE_ITERATIONS ?? 25);
const cycles = Number(process.env.CHART_MEASURE_CYCLES ?? 6);
if (!Number.isInteger(cycles) || cycles < 0 || cycles > 10) throw new Error('释放循环必须为 0–10 次');
const profile = process.env.CHART_MEASURE_PROFILE === '1';
const scenarios = (process.env.CHART_MEASURE_SCENARIOS ?? 'joint,legacy').split(',');
if (scenarios.some(scenario => !['joint', 'legacy'].includes(scenario))) throw new Error('未知测量场景');
if (pages.some(page => !Number.isInteger(page) || page < 3 || page > 500) || !Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
  throw new Error('测量规模必须为 3–500 页、1–100 次');
}
mkdirSync(join(out, 'entries'), { recursive: true });
for (const [name, code] of Object.entries({
  sdk: "export * as core from '@web-ppt/core'; export * as edit from '@web-ppt/edit-core'; export * as editor from '@web-ppt/editor';",
  basic: "export * from '@web-ppt/edit-core/chart';", shared: "export * from '@web-ppt/edit-core/chart-shared';",
  portable: "export { copyPortableElements } from '@web-ppt/edit-core/generate';",
})) writeFileSync(join(out, 'entries', `${name}.mjs`), code);
execFileSync('npx', ['esbuild', ...['sdk', 'basic', 'shared', 'portable'].map(name => join(out, 'entries', `${name}.mjs`)),
  '--bundle', '--format=esm', '--platform=browser', '--splitting', ...(profile ? [] : ['--minify']), '--log-level=error',
  ...(source ? sourceAliasArgs(root) : ['--tsconfig-raw={}']), `--outdir=${out}/bundle`, `--metafile=${out}/meta.json`], { stdio: 'inherit' });
const meta = JSON.parse(readFileSync(join(out, 'meta.json')));
if (!source && Object.keys(meta.inputs).some(path => /^packages\/[^/]+\/src\//.test(path))) throw new Error('发布包测量不能解析到源码');
const report = { entry: source ? 'source' : 'dist', diagnosticProfile: profile, iterations, cycles, cases: [], cold: [],
  bundleSha256: Object.fromEntries(Object.keys(meta.outputs).filter(path => path.endsWith('.js')).map(path =>
    [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
  memoryMethod: '独立 Chrome 进程；CDP Runtime.getHeapUsage 及显式 collectGarbage，另在操作边界采样 performance.memory。采样高水位不是同步函数内部精确峰值；包含当前 isolate，非进程 RSS。',
  retentionMethod: '首次样本释放后，在扩展已注册的同一 isolate 重复打开来源、编辑、保存与释放；旧局部覆盖迁移仅计首次激活，重复循环衡量已注册编辑会话的保留量。',
  environmentMethod: 'localhost gzip，缓存关闭；记录冷增量下载、编译/求值、迁移注册、完整查询、两处 DOM 挂载、命令及布局、全框架投影、保存和复制。无网络限速，非公网延迟或跨机器预算。' };
const persist = () => writeFileSync(join(out, source ? 'source.json' : 'dist.json'), JSON.stringify(report, null, 2) + '\n');
const run = async (record, measure) => {
  record.status = 'running'; record.phase = 'browser.launch'; persist();
  try {
    await withChartBrowser(root, async browser => {
      report.browser = browser.version; await measure(browser);
    });
  } catch (error) {
    if (record.status !== 'failed') recordMeasurementError(record, error);
    throw error;
  } finally { persist(); }
};
for (let index = 0; index < 3; index++) {
  const record = { index }; report.cold.push(record);
  await run(record, browser => measureChartCold(browser, record, persist));
}
for (const scenario of scenarios) for (const count of pages) {
  console.log(`测量 ${scenario} / ${count} 页 / ${iterations} 次`);
  const record = { scenario, pages: count }; report.cases.push(record);
  await run(record, browser => measureChartCase(browser, record, { iterations, profile, cycles, persist,
    saveProfile: profile => writeFileSync(join(out, `${scenario}-${count}.cpuprofile`), JSON.stringify(profile)) }));
  console.log(JSON.stringify({ scenario, pages: count, metrics: record.metrics }));
}
console.log(`浏览器成本报告：${out}/${source ? 'source' : 'dist'}.json`);
