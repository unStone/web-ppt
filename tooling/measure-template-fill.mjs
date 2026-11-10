import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { moduleClosure } from './lib/module-closure.mjs';
import { withChartBrowser } from './lib/chart-browser-lab.mjs';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'out/template-fill');
mkdirSync(out, { recursive: true });
const closure = moduleClosure(join(root, 'packages/edit-core/dist/fill.js'));
const cold = Array.from({ length: 5 }, () =>
  JSON.parse(execFileSync(process.execPath, [join(root, 'tooling/lib/template-fill-cold.mjs')], { cwd: root, encoding: 'utf8' })),
);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const bundle = join(out, 'measure-browser');
execFileSync(
  'npx',
  [
    'esbuild',
    join(root, 'tooling/lib/template-fill-measure-browser.mjs'),
    '--bundle',
    '--format=esm',
    '--platform=browser',
    '--splitting',
    '--log-level=error',
    `--tsconfig=${join(root, 'tooling/tsconfig.template-fill-dist.json')}`,
    `--outdir=${bundle}`,
  ],
  { cwd: root, stdio: 'inherit' },
);
const browserTrials = [];
for (let index = 0; index < 3; index++) {
  browserTrials.push(
    await withChartBrowser(root, async (browser) => {
      await browser.request('HeapProfiler.collectGarbage');
      const before = await browser.request('Runtime.getHeapUsage');
      const result = await browser.evaluate(`import('/out/template-fill/measure-browser/template-fill-measure-browser.js')
      .then(api => api.measureTemplateFill())`);
      assert.equal(result.pages, 6);
      assert.equal(result.issues, 0);
      await browser.request('HeapProfiler.collectGarbage');
      const after = await browser.request('Runtime.getHeapUsage');
      return { ...result, browser: browser.version.product, retainedJsHeapDeltaBytes: after.usedSize - before.usedSize };
    }),
  );
}
const report = {
  entry: { gzipBytes: closure.gzip, rawBytes: closure.raw },
  method:
    '入口静态闭包含相对分块、不含 peer 或按需内置配方；5个独立Node进程冷导入含peer。3个独立Chrome进程，真实OFL字体别名安装、图片预取后计六页Aurora生成，含设计修复、原生图表、保存重开与完整七项检查。heapDeltaBytes为采样含临时对象；retainedJsHeapDeltaBytes比较客户端入口导入前与调用结束释放字体后两次强制GC，含peer与共享缓存，不计作纯fill占用或进程总内存。',
  cold,
  browserTrials,
  medians: {
    importMs: median(cold.map((trial) => trial.importMs)),
    importHeapDeltaBytes: median(cold.map((trial) => trial.heapDeltaBytes)),
    fillMs: median(browserTrials.map((trial) => trial.elapsedMs)),
    retainedJsHeapDeltaBytes: median(browserTrials.map((trial) => trial.retainedJsHeapDeltaBytes)),
  },
};
writeFileSync(join(out, 'performance.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `模板填充 ${closure.gzip}B gzip；冷导入中位 ${report.medians.importMs.toFixed(2)}ms；六页全七项生成中位 ${report.medians.fillMs.toFixed(2)}ms`,
);
