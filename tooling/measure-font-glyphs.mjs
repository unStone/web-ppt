import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {build} from 'vite';
import {withChartBrowser} from './lib/chart-browser-lab.mjs';

const root=resolve('.'),out=resolve(root,'out/font-glyphs');
mkdirSync(out,{recursive:true});
const source=readFileSync(resolve(root,'corpus/poi/placeholder-layout-color.pptx'));
const sourceHash=createHash('sha256').update(source).digest('hex');
if(sourceHash!=='b683af99cf4e71db112fe87db15840846c53dbc7a6839cbf84804980d21af9ce')throw new Error('真实 MTX 语料 hash 不一致');
const paths=ts.readConfigFile(resolve(root,'tsconfig.json'),ts.sys.readFile).config.compilerOptions.paths;
const alias=Object.entries(paths).sort(([a],[b])=>b.length-a.length).map(([find,[path]])=>({find,replacement:resolve(root,path)}));
await build({configFile:false,root,base:'/out/font-glyphs/cost/',resolve:{alias},worker:{format:'es'},
  esbuild:{supported:{'top-level-await':true}},build:{outDir:resolve(out,'cost'),emptyOutDir:true,target:'es2020',
    lib:{entry:resolve(root,'tooling/lib/font-cost-browser.mjs'),formats:['es'],fileName:()=> 'cost.mjs'}}});
const report=await withChartBrowser(root,async browser=>{
  const cycles=[];
  for(let cycle=0;cycle<3;cycle++){
    await browser.request('HeapProfiler.collectGarbage');
    const before=await browser.request('Runtime.getHeapUsage');
    const result=await browser.evaluate("import('/out/font-glyphs/cost/cost.mjs').then(module=>module.fontCostCycle())");
    const started=performance.now();
    for(let attempt=0;;attempt++){
      const targets=await browser.request('Target.getTargets');
      if(!targets.targetInfos.some(target=>target.type==='worker'))break;
      if(attempt===100)throw new Error('大字体关闭后 Worker 未退出');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    await browser.request('HeapProfiler.collectGarbage');
    cycles.push({cycle,...result,observedExitMs:performance.now()-started,pageHeapBefore:before,pageHeapAfter:await browser.request('Runtime.getHeapUsage')});
    console.log(`完整中文字体第 ${cycle+1} 轮完成`);
  }
  const mtx=await browser.evaluate("import('/out/font-glyphs/cost/cost.mjs').then(module=>module.realMtxBrowser())");
  const targets=await browser.request('Target.getTargets');
  if(targets.targetInfos.some(target=>target.type==='worker'))throw new Error('真实 MTX 结束后 Worker 未退出');
  return {browser:browser.version.product,cycles,mtx};
});
report.fullFont=JSON.parse(readFileSync(resolve(out,'chinese-full.json')));
report.mtx.source={path:'corpus/poi/placeholder-layout-color.pptx',sha256:sourceHash,url:'https://github.com/apache/poi/tree/trunk/test-data/slideshow'};
report.scope={wasm:'公开字体表 backing buffer 的线性内存容量，不是 malloc 已用量',pageHeap:'CDP 页面上下文；不包含 Worker 堆',
  workerHeap:'performance.memory 不可用时为 null',rss:null,peak:null,cache:'同一浏览器进程，HTTP 缓存禁用；后续轮次可能复用编译缓存',
  instrumentation:'测量 Worker 使用正式服务和 HarfBuzz 适配；额外保留最后一个 Face 以读 WASM 容量。真实 MTX 使用产品 Worker。'};
writeFileSync(resolve(out,'cost.json'),JSON.stringify(report,null,2)+'\n');
console.log('成本与真实 MTX：out/font-glyphs/cost.json');
