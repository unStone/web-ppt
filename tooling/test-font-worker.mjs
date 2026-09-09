import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {countedAssert} from './lib/counted-assert.mjs';
import {bundleBrowser} from './lib/bundle-browser.mjs';
import {fontSample} from './lib/font-glyph-samples.mjs';
import {fontWorkerBoundaryContract} from './lib/font-worker-boundaries.mjs';
import {fontWorkerResultContract} from './lib/font-worker-result-contract.mjs';

const {assert,record}=countedAssert('fontWorker');
const root=resolve('.'),out=join(root,'out/font-glyphs');
mkdirSync(out,{recursive:true});
const entry=join(out,'worker-api.mjs'),bundle=join(out,'worker-contract.mjs');
writeFileSync(entry,"export * from '@web-ppt/fonts/glyphs'; export * from '@web-ppt/fonts/glyphs/harfbuzz'; export * from '@web-ppt/fonts/glyphs/worker';");
const api=process.argv.includes('--dist')?{
  ...await import('@web-ppt/fonts/glyphs'),...await import('@web-ppt/fonts/glyphs/worker'),
}:await bundleBrowser({root,entry,output:bundle,aliases:[['@web-ppt/fonts/glyphs',join(root,'packages/fonts/src/glyphs/index.ts')]]});
const server=join(out,'worker-server.mjs');
writeFileSync(server,`
import {parentPort,workerData} from 'node:worker_threads';
import * as hb from 'harfbuzzjs';
${process.argv.includes('--dist')?"import {serveFontWorker} from '@web-ppt/fonts/glyphs/worker'; import {createHarfBuzzShaper} from '@web-ppt/fonts/glyphs/harfbuzz';":`import {serveFontWorker,createHarfBuzzShaper} from './worker-contract.mjs';`}
const listeners=new Map();
serveFontWorker({
  postMessage:message=>parentPort.postMessage(message),
  addEventListener:(_type,listener)=>{const fn=data=>listener({data});listeners.set(listener,fn);parentPort.on('message',fn);},
  removeEventListener:(_type,listener)=>{parentPort.off('message',listeners.get(listener));listeners.delete(listener);},
},{decodeEot:async()=>{
  if(workerData.gateDecode){parentPort.postMessage({testing:'decoding'});await new Promise(()=>{});}
  return workerData.decoded;
},loadShaper:async()=>{
  if(workerData.gated){parentPort.postMessage({testing:'loading'});await new Promise(()=>{});}
  return createHarfBuzzShaper(hb);
}});
`);
let created=0,terminated=0,ready;
const barrier=new Promise(resolve=>ready=resolve),exits=[];
function spawnWorker(workerData,onMessage=()=>{}){
  const worker=new Worker(server,{workerData}),listeners=new Map();
  exits.push(new Promise(resolve=>worker.once('exit',resolve)));
  worker.on('message',onMessage);
  return {
    postMessage:(message,transfer)=>worker.postMessage(message,transfer),
    addEventListener(type,listener){const fn=type==='message'?data=>listener({data}):error=>listener({error});if(!listeners.has(type))listeners.set(type,new Map());listeners.get(type).set(listener,fn);worker.on(type,fn);},
    removeEventListener(type,listener){worker.off(type,listeners.get(type).get(listener));listeners.get(type).delete(listener);},
    terminate(){terminated++;void worker.terminate();},
  };
}
const shaper=api.createWorkerFontShaper(()=>spawnWorker({gated:created++===0},data=>{if(data.testing==='loading')ready();}),
  {maxQueuedRequests:3,maxPendingBytes:4096});
const provider=api.createFontProvider({loadShaper:async()=>shaper});
assert.equal((await provider.register({id:'latin',origin:'explicit',bytes:fontSample('latin.ttf')},{purpose:'edit'})).ok,true);
const options={purpose:'edit',script:'Latn',direction:'ltr',language:'en'},cancel=new AbortController();
const first=provider.shape('latin','AV office ffi ﬃ',{...options,signal:cancel.signal});
const second=provider.shape('latin','á q̇',options);
const queuedCancel=new AbortController(),third=provider.shape('latin','ABC',{...options,signal:queuedCancel.signal});
await barrier;
assert.equal(shaper.state().pendingRequests,3);
assert.equal((await provider.shape('latin','ABC',options)).reason,'resource-limit','排队数预算在 Worker 仍忙时生效');
queuedCancel.abort();
assert.equal((await third).reason,'aborted','取消排队请求无需终止正在处理其他请求的 Worker');
assert.equal(terminated,0);
cancel.abort();
assert.equal((await first).reason,'aborted','中止正在加载整形器的独占线程请求');
const continued=await second;
assert.equal(continued.ok,true,'重启 Worker 后其他排队请求从持有字节恢复');
assert.equal(continued.value.xAdvance,1437);
assert.equal(created,2);
assert.equal(terminated,1,'取消实际终止旧 Worker，不以清空 Map 冒充释放 WASM');
const repeated=await provider.shape('latin','AV office ffi ﬃ',options);
assert.equal(repeated.value.xAdvance,6690);
const measured=await api.withFontMeasurement(provider,measure=>measure('AV office ffi ﬃ',
  {fonts:['WebPPT Glyph Latin'],size:100,b:false,i:false,spacing:0},1),
  {purpose:'edit',language:'en',faceForRun:()=> 'latin'});
assert.equal(measured.ok,true,'字体测量回调保留在宿主，不应作为不可克隆函数发给 Worker');
assert.equal(measured.value.result,669);
assert.equal((await provider.shape('latin','A'.repeat(2050),options)).reason,'resource-limit','文字队列按 UTF-16 字节计入预算');
provider.dispose();provider.dispose();
await Promise.all(exits);
assert.equal(terminated,2,'重复关闭不会重复终止线程');
assert.equal(shaper.state().retainedFontBytes,0);
assert.equal(shaper.state().pendingRequests,0);
assert.equal((await provider.shape('latin','abc',options)).reason,'provider-disposed');
await fontWorkerBoundaryContract(api,assert,spawnWorker);
await fontWorkerResultContract(api,assert);
await Promise.all(exits);
record();
console.log('字体 Worker：真实线程取消、恢复与关闭通过');
