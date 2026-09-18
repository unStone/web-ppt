import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {moduleClosure} from './module-closure.mjs';

/**
 * 可选入口体积与冷导入成本。主入口不得静态引入 PDF；体积按 dist 闭包计费。
 * 采样增量不是浏览器峰值或跨机器预算。
 */
export async function vectorPdfEntryCostContract(root=resolve('.'),out=resolve('out/vector-pdf')){
  const vectorEntry=resolve(root,'packages/core/dist/pdf-vector.js');
  const browserEntry=resolve(root,'packages/core/dist/pdf-vector-browser.js');
  const coreEntry=resolve(root,'packages/core/dist/core.js');
  assert.ok(existsSync(vectorEntry),'先构建 core 再测入口成本');
  assert.ok(existsSync(browserEntry),'缺少 pdf-vector-browser 产物');

  const vector=moduleClosure(vectorEntry);
  const browser=moduleClosure(browserEntry);
  assert.ok(vector.gzip>10_000&&vector.gzip<80_000,vector);
  assert.ok(browser.gzip>2_000&&browser.gzip<40_000,browser);

  // 默认入口不得静态拉入矢量 PDF
  if(existsSync(coreEntry)){
    const coreSource=moduleClosure(coreEntry).source;
    assert.ok(!coreSource.includes('pdf-vector'),'core 主入口不得静态依赖矢量 PDF');
  }

  const samples=[];
  for(let i=0;i<5;i++){
    const t0=performance.now();
    await import(`${pathToFileURL(vectorEntry).href}?t=${Date.now()}-${i}`);
    samples.push(performance.now()-t0);
  }
  samples.sort((a,b)=>a-b);
  const report={
    node:process.version,
    'pdf-vector.js':{files:vector.files.map(f=>f.replace(root+'/','')),raw:vector.raw,gzip:vector.gzip},
    'pdf-vector-browser.js':{files:browser.files.map(f=>f.replace(root+'/','')),raw:browser.raw,gzip:browser.gzip},
    coldImportMedianMs:Math.round(samples[2]*10)/10,
    coldImportP95Ms:Math.round(samples[4]*10)/10,
    note:'本机 Node 小样本；闭包含公共块，不含字体/HarfBuzz；冷导入含尚未加载依赖；非浏览器峰值。',
  };
  writeFileSync(resolve(out,'entry-cost.json'),JSON.stringify(report,null,2)+'\n');
  writeFileSync(resolve(out,'normalization-closure.json'),JSON.stringify({
    'pdf-vector.js':{files:report['pdf-vector.js'].files,raw:vector.raw,gzip:vector.gzip},
    'pdf-vector-browser.js':{files:report['pdf-vector-browser.js'].files,raw:browser.raw,gzip:browser.gzip},
  },null,2)+'\n');
  console.log(`矢量 PDF 入口成本：vector gzip ${vector.gzip} B、browser gzip ${browser.gzip} B、冷导入中位 ${report.coldImportMedianMs} ms`);
  return report;
}
