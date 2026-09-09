import {serveFontWorker} from '@web-ppt/fonts/glyphs/worker';

let tableView;
serveFontWorker(self,{loadShaper:async()=>{
  const [hb,{createHarfBuzzShaper}]=await Promise.all([import('harfbuzzjs'),import('@web-ppt/fonts/glyphs/harfbuzz')]);
  // 仅保存读取公开表视图的函数；buffer 容量不是已分配 malloc 字节或 RSS。
  class ObservedFace extends hb.Face {constructor(blob){super(blob);tableView=()=>this.referenceTable('head');}}
  return createHarfBuzzShaper({...hb,Face:ObservedFace});
}});
self.addEventListener('message',event=>{
  if(event.data?.measure!=='memory')return;
  self.postMessage({measure:'memory',wasmCapacity:tableView?.()?.buffer.byteLength??0,
    jsHeap:performance.memory?.usedJSHeapSize??null});
});
