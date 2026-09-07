import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';

const out='out/portable-rich-text';
execFileSync('npx',['esbuild','packages/edit-core/dist/generate.js','--bundle','--format=esm','--platform=browser','--external:@web-ppt/core','--external:@web-ppt/edit-core','--minify',`--outfile=${out}/generate-measured.mjs`],{stdio:'pipe'});
const core=await import('@web-ppt/core'),edit=await import('@web-ppt/edit-core');
const start=performance.now(),generate=await import('@web-ppt/edit-core/generate');
const importMs=performance.now()-start;
const p=await core.parse(readFileSync('fixtures/sample-portable-rich-text.pptx'),{edit:true,keepPackage:true,lazy:false});
const doc=edit.createDoc(p);p.dispose();
const durations=[],baseline=process.memoryUsage(),samples=[];
let outputBytes=0;
for(let index=0;index<25;index++){
  const before=performance.now(),result=generate.generateEditDoc(doc);
  durations.push(performance.now()-before);outputBytes=result.bytes.length;samples.push(process.memoryUsage());
}
durations.sort((a,b)=>a-b);
const result={node:process.version,fixture:'sample-portable-rich-text.pptx',pages:doc.slideOrder.length,
  moduleGzipBytes:gzipSync(readFileSync(`${out}/generate-measured.mjs`)).length,
  excludedPeers:['@web-ppt/core','@web-ppt/edit-core'],importMs,
  generateMedianMs:durations[12],generateP95Ms:durations[23],outputBytes,
  heapGrowthSampledBytes:Math.max(...samples.map(s=>s.heapUsed))-baseline.heapUsed,
  rssGrowthSampledBytes:Math.max(...samples.map(s=>s.rss))-baseline.rss,
  note:'本机 Node 小样本，25 次；采样增量不是浏览器峰值内存或跨机器性能预算。'};
edit.disposeDoc(doc);writeFileSync(`${out}/measure.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
