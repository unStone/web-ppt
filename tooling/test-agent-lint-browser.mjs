import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {withChartBrowser} from './lib/chart-browser-lab.mjs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..'),out=join(root,'out/agent-lint');
const {core,edit,lint}=await import(pathToFileURL(join(out,'runtime.mjs')));
const key=(t,r,s)=>JSON.stringify([t,r.fonts,r.size,!!r.b,!!r.i,r.baseline??0,r.spacing??0,s]);
const files=readdirSync(join(root,'fixtures')).filter(n=>/\.(pptx|ppt)$/.test(n)).sort(),results={};
await withChartBrowser(root,async browser=>{
 await browser.evaluate(`import('/tooling/lib/agent-lint-browser.mjs')`);
 const occlusion=await browser.evaluate('window.testLintOcclusion()');
 occlusion.svgs.forEach((svg,i)=>writeFileSync(join(out,`occlusion-${i}.svg`),svg));
 assert.deepEqual(occlusion.issues,[],'完全遮挡不报对比度，14pt 粗体按大字阈值比较');
 for(const file of files){
  const observed=await browser.evaluate(`window.runLintFixture(${JSON.stringify(file)})`),metrics=observed.metrics;
  const p=await core.parse(readFileSync(join(root,'fixtures',file)),{edit:true,keepPackage:true,lazy:false,...(file.includes('encrypted')?{password:'web-ppt-2024'}:{})});
  const doc=edit.createDoc(p,{idPrefix:'lint-'}),options={fonts:{available:['WebPPT Glyph Latin'],embedded:(p.embeddedFontSources??p.embeddedFonts??[]).map(f=>f.family)},
   resolveContrast:c=>{const k=JSON.stringify([c.slideNumber,c.elementId,c.textIndex,c.paragraphIndex,c.runIndex]),value=observed.samples[k];if(value===undefined)throw new Error('缺少实际颜色 '+k);if(value.error)throw new lint.LayoutLintError(value.error.reason,value.error.message,value.error.slideNumber,value.error.elementId);return value;},
   resolveImageMetadata:c=>observed.imageInfo[c.elementId]};
  let result;
  for(let pass=0;pass<16;pass++){
   const queries=new Map();
   try{result={report:await lint.lintPresentation(doc,{...options,measureText:(t,r,s)=>{const k=key(t,r,s);if(metrics[k]!==undefined)return metrics[k];queries.set(k,{text:t,run:{fonts:r.fonts,size:r.size,b:r.b,i:r.i,baseline:r.baseline,spacing:r.spacing},scale:s});return t.length*r.size*s;}})};}
   catch(e){result={error:{reason:e.reason??'unexpected',slideNumber:e.slideNumber??null,elementId:e.elementId??null}};}
   if(!queries.size)break;
   Object.assign(metrics,await browser.evaluate(`window.lintWidths(${JSON.stringify([...queries.values()])})`));
   if(pass===15)throw new Error(`${file} 字宽准备未收敛`);
  }
  const signature=v=>v.error?{reason:v.error.reason,slideNumber:v.error.slideNumber,elementId:v.error.elementId}:v.report.issues.map(i=>[i.slideNumber,i.elementId,i.reason]);
  assert.deepEqual(signature(result),signature(observed),`${file} Node/Canvas reason 集合`);
  if(file==='sample-agent-lint.pptx'){
   assert(!observed.error);assert(observed.report.issues.some(i=>i.slideNumber===1&&i.reason==='text-overflow'));
   assert(!observed.report.issues.some(i=>i.slideNumber===2&&i.reason==='text-overflow'));
   assert(observed.report.issues.some(i=>i.slideNumber===7&&i.reason==='low-contrast'&&i.measurements.ratio<4.5));
   assert(!observed.report.issues.some(i=>i.slideNumber===8&&i.reason==='low-contrast'));
  }
  results[file]={...result,metrics,samples:observed.samples,imageInfo:observed.imageInfo};edit.disposeDoc(doc);p.dispose();
 }
});
writeFileSync(join(out,'corpus-input.json'),JSON.stringify(results));
writeFileSync(join(out,'corpus-review.json'),JSON.stringify(Object.fromEntries(Object.entries(results).map(([f,r])=>[f,r.error??r.report.issues])),null,2));
// 全新进程读取同一份真实 Canvas 字宽；准备阶段的临时估算从不作为交付结果。
const {execFileSync}=await import('node:child_process');
const worker=join(root,'tooling/lib/agent-lint-process.mjs');
const first=execFileSync(process.execPath,[worker],{cwd:root,maxBuffer:32*1024*1024});
const second=execFileSync(process.execPath,[worker],{cwd:root,maxBuffer:32*1024*1024});
assert.deepEqual(first,second);writeFileSync(join(out,'determinism.sha256'),createHash('sha256').update(first).digest('hex'));
console.log(`布局检查：${files.length} 份固件 Node/Canvas reason 集合及独立进程确定性通过`);
