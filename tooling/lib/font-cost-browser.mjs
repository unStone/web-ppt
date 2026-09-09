import {createFontProvider} from '@web-ppt/fonts/glyphs';
import {createWorkerFontShaper} from '@web-ppt/fonts/glyphs/worker';
import {unzipSync} from 'fflate';

const requireResult=result=>{if(!result.ok)throw new Error(JSON.stringify(result));return result.value;};
const ensure=(condition,message)=>{if(!condition)throw new Error(message);};
const shapeOptions={purpose:'edit',script:'Hani',direction:'ltr',language:'zh-Hans'};
const time=async action=>{const start=performance.now(),value=await action();return {ms:performance.now()-start,value};};
const summary=values=>{const sorted=[...values].sort((a,b)=>a-b);return {min:sorted[0],p50:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};};

export async function fontCostCycle(){
  let instance,created=0;
  const adapter=createWorkerFontShaper(()=>{created++;return instance=new Worker(new URL('./font-cost-worker.mjs',import.meta.url),{type:'module'});});
  const provider=createFontProvider({loadShaper:async()=>adapter});
  const input=await time(()=>fetch('/out/font-glyphs/chinese-full.ttf').then(response=>response.arrayBuffer()));
  const bytes=new Uint8Array(input.value);
  const report={inputBytes:bytes.length,fetchMs:input.ms};
  try{
    const registration=await time(()=>provider.register({id:'full',origin:'explicit',bytes,embeddingEvidence:'OFL-1.1'},shapeOptions));
    report.face=requireResult(registration.value);report.registerMs=registration.ms;
    ensure(!adapter.state().workerActive,'注册元数据不能提前启动 WASM');
    const first=await time(()=>provider.shape('full','中文测试你好世界，。',shapeOptions));
    report.firstShapeMs=first.ms;report.firstGlyphs=requireResult(first.value).glyphs.length;
    const longText='中文测试你好世界，。'.repeat(5000),shortTimes=[],longTimes=[];
    for(let index=0;index<50;index++)shortTimes.push((await time(async()=>requireResult(await provider.shape('full','中文测试你好世界，。',shapeOptions)))).ms);
    for(let index=0;index<5;index++)longTimes.push((await time(async()=>requireResult(await provider.shape('full',longText,shapeOptions)))).ms);
    report.shortRpcMs=summary(shortTimes);report.longRpcMs=summary(longTimes);report.longTextLength=longText.length;
    const concurrent=await time(()=>Promise.all(Array.from({length:8},()=>provider.shape('full',longText,shapeOptions))));
    concurrent.value.forEach(requireResult);report.eightConcurrentMs=concurrent.ms;
    report.textLimit=(await provider.shape('full','中'.repeat(100001),shapeOptions)).reason;
    report.memory=await new Promise(resolve=>{
      const receive=event=>{if(event.data?.measure==='memory'){instance.removeEventListener('message',receive);resolve(event.data);}};
      instance.addEventListener('message',receive);instance.postMessage({measure:'memory'});
    });
    const controller=new AbortController(),cancelStart=performance.now();
    const cancelled=provider.shape('full',longText,{...shapeOptions,signal:controller.signal});
    while(!adapter.state().pendingRequests)await new Promise(resolve=>setTimeout(resolve,0));
    controller.abort();
    report.cancelReason=(await cancelled).reason;report.cancelMs=performance.now()-cancelStart;
    ensure(report.cancelReason==='aborted'&&!adapter.state().workerActive,'取消活跃长文本没有终止 Worker');
    const recovered=await time(()=>provider.shape('full','中文',shapeOptions));requireResult(recovered.value);
    report.recoveryMs=recovered.ms;report.createdWorkers=created;
    report.provider=provider.state();report.client=adapter.state();
  }finally{adapter.dispose();provider.dispose();}
  report.closed={provider:provider.state(),client:adapter.state()};
  ensure(report.closed.provider.retainedFontBytes===0&&report.closed.client.retainedFontBytes===0,'关闭后仍持有字体');
  const limited=createFontProvider({limits:{maxGlyphs:100}});
  try{report.glyphLimit=(await limited.register({id:'limit',origin:'explicit',bytes},shapeOptions)).reason;}
  finally{limited.dispose();}
  const validation=createFontProvider(),cancel=new AbortController();
  try{
    const started=performance.now(),pending=validation.register({id:'cancel',origin:'explicit',bytes},{...shapeOptions,signal:cancel.signal});
    // 第一轮让出后再排一个取消，才能覆盖已进入字形遍历的注册。
    await new Promise(resolve=>setTimeout(()=>setTimeout(()=>{cancel.abort();resolve();},0),0));
    report.validationCancel={reason:(await pending).reason,ms:performance.now()-started,state:validation.state()};
    ensure(report.validationCancel.reason==='aborted'&&validation.state().reservedFontBytes===0,'大字体校验无法在提交前取消');
  }finally{validation.dispose();}
  return report;
}

export async function realMtxBrowser(){
  const adapter=createWorkerFontShaper(()=>new Worker(new URL('../../packages/site/src/editor-font-worker.ts',import.meta.url),{type:'module'}));
  const provider=createFontProvider({loadShaper:async()=>adapter,decodeEot:adapter.decodeEot});
  const archive=new Uint8Array(await fetch('/corpus/poi/placeholder-layout-color.pptx').then(response=>response.arrayBuffer())),results=[];
  try{
    for(const [part,bytes] of Object.entries(unzipSync(archive))){
      if(!/^ppt\/fonts\/.*\.fntdata$/.test(part))continue;
      const result=await time(()=>provider.register({id:part,origin:'embedded',bytes,sourceLabel:part},{purpose:'view-print'}));
      const info=result.value.ok?result.value.value:undefined;
      const run=info?requireResult(await provider.shape(part,'ABC',{purpose:'view-print',script:'Latn',direction:'ltr',language:'en'})):undefined;
      results.push({part,inputBytes:bytes.length,flags:new DataView(bytes.buffer,bytes.byteOffset).getUint32(12,true),info,
        failure:result.value.ok?undefined:result.value,loadMs:result.ms,glyphs:run?.glyphs.map(glyph=>glyph.id)});
    }
    ensure(results.length===6&&results.every(row=>row.flags&4),'真实 MTX 语料应有六个压缩容器');
    ensure(results.filter(row=>row.info).length===1&&results.filter(row=>row.failure?.reason==='invalid-font').length===5,
      '真实 MTX 的非法 cmap 不能作为有效字体交付');
  }finally{adapter.dispose();provider.dispose();}
  const html=await fetch('/packages/site/editor.html').then(response=>response.text());
  const parsed=new DOMParser().parseFromString(html,'text/html');
  for(const link of parsed.head.querySelectorAll('link[rel="canonical"],link[rel="alternate"]'))document.head.append(link.cloneNode(true));
  const [{prepareEditorDocument},{createDocumentFontService},{setFontDecoder}]=await Promise.all([
    import('../../packages/site/src/editor-open'),import('../../packages/site/src/editor-document-fonts'),import('@web-ppt/core'),
  ]);
  let decoderCalls=0,session,fonts,product;
  setFontDecoder(()=>{decoderCalls++;throw new Error('主线程不得解码产品字体');});
  try{
    ({session}=await prepareEditorDocument(archive,{openOptions:()=>({})},new AbortController().signal));
    ensure(decoderCalls===0&&session.embeddedFontSources.length===6&&!session.toPresentation().embeddedFonts?.length,
      '实际产品打开链路仍然提前解码 MTX');
    fonts=createDocumentFontService(session);await fonts.initialize();
    product={decoderCalls,sourceFonts:session.embeddedFontSources.length,loaded:fonts.state()};
    product.statuses=(await fonts.activate({})).map(item=>({source:item.source.family,result:item.result}));
    ensure(product.statuses.filter(item=>item.result.reason==='invalid-font').length===5&&
      product.statuses.filter(item=>item.result.reason==='face-style-mismatch').length===1&&
      product.loaded.installedFaces===0&&product.loaded.workerActive,
      `真实 MTX 未由产品字体 Worker 应用：${JSON.stringify(product)}`);
  }finally{fonts?.dispose();session?.dispose();setFontDecoder(null);}
  product.closed=fonts.state();
  return {results,product,closed:{provider:provider.state(),client:adapter.state()}};
}
