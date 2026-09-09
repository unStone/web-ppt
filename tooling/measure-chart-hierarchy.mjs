import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { moduleClosure } from './lib/module-closure.mjs';

const out='out/chart-hierarchy',core=await import('@web-ppt/core'),edit=await import('@web-ppt/edit-core');
const start=performance.now(),chart=await import('@web-ppt/edit-core/chart'),importMs=performance.now()-start;
const p=await core.parse(readFileSync('fixtures/sample-chart-hierarchy.pptx'),{edit:true,keepPackage:true,lazy:false});
const editor=new edit.Editor(edit.createDoc(p)),api=chart.createChartDataEditor(editor),before=performance.now();
const id=chart.listEditableCharts(editor.doc)[1].id,category=chart.queryChartData(editor.doc,id).categories[0].id;
const firstQueryMs=performance.now()-before,durations=[],baseline=process.memoryUsage(),samples=[];
let outputBytes=0;
for(let index=0;index<25;index++){
  const before=performance.now();api.setCategoryLevel(id,category,0,`Group ${index}`);
  const bytes=await editor.save();durations.push(performance.now()-before);outputBytes=bytes.length;samples.push(process.memoryUsage());
}
durations.sort((a,b)=>a-b);
const module=moduleClosure('packages/edit-core/dist/chart.js');
const result={node:process.version,fixture:'sample-chart-hierarchy.pptx',pages:3,
  moduleRawBytes:module.raw,moduleGzipBytes:module.gzip,
  importMs,firstQueryMs,editAndSaveMedianMs:durations[12],editAndSaveP95Ms:durations[23],outputBytes,
  heapGrowthSampledBytes:Math.max(...samples.map(s=>s.heapUsed))-baseline.heapUsed,
  rssGrowthSampledBytes:Math.max(...samples.map(s=>s.rss))-baseline.rss,
  note:'本机 Node 小样本25次；模块体积不含既有core/edit-core/XML/OPC/fflate依赖，冷导入含尚未加载依赖；采样增量不是浏览器峰值或跨机器预算。'};
editor.dispose();p.dispose();writeFileSync(`${out}/measure.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
