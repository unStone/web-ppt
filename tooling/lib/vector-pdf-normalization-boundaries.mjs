import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

export async function vectorPdfNormalizationBoundaries(api,pres,fonts,samples,browser,out){
  const slide=pres.slides[0],image=slide.elements.find(el=>el.kind==='image'),one={...pres,slides:[slide]};
  const issue=reason=>error=>{
    assert(error instanceof api.VectorPdfError);assert.deepEqual(error.issue,{slideNumber:1,elementId:image.id,reason});return true;
  };
  const good=()=>({width:16,height:8,rgba:new Uint8Array(16*8*4)});
  for(const result of [null,{...good(),rgba:new Uint8Array(3)},{...good(),width:8,height:8}]){
    await assert.rejects(()=>api.presentationToVectorPdf(one,{fonts,normalizeImage:async()=>result}),issue('image-normalizer-result'));
  }
  await assert.rejects(()=>api.presentationToVectorPdf(one,{fonts,normalizeImage:async()=>({...good(),width:16000001,height:1})}),issue('image-pixel-limit'));
  await assert.rejects(()=>api.presentationToVectorPdf(one,{fonts,normalizeImage:async()=>{throw new Error('decoder failed');}}),issue('image-normalization-failed'));
  const cancelled=new AbortController();
  await assert.rejects(()=>api.presentationToVectorPdf(one,{fonts,signal:cancelled.signal,normalizeImage:async()=>{cancelled.abort();return good();}}),{name:'AbortError'});
  const original=image.src;
  try{
    const huge=new Uint8Array(samples[0].bytes);new DataView(huge.buffer).setUint32(16,16000001);
    let calls=0;image.src='data:application/octet-stream;base64,'+Buffer.from(huge).toString('base64');
    await assert.rejects(()=>api.presentationToVectorPdf(one,{fonts,normalizeImage:async()=>{calls++;return good();}}),issue('image-pixel-limit'));
    assert.equal(calls,0,'编码尺寸超限时不能启动解码');
    image.src='data:image/png;base64,AQID';
    await assert.rejects(()=>api.presentationToVectorPdf(one,{fonts}),issue('image-format-unsupported'));
    image.src='data:application/octet-stream;base64,'+Buffer.from(samples[0].bytes).toString('base64');
    await assert.rejects(()=>api.presentationToVectorPdf(one,{fonts}),issue('image-png-color'));
    const anonymous={...one,slides:[{...slide,elements:slide.elements.map(el=>el===image?{...el,id:undefined}:el)}]};
    await assert.rejects(()=>api.presentationToVectorPdf(anonymous,{fonts}),error=>{
      assert.deepEqual(error.issue,{slideNumber:1,elementPath:[0],reason:'image-png-color'});return true;
    });
  }finally{image.src=original;}
  const lifetime=await browser.evaluate(`(async()=>{
    const {normalizeVectorPdfImage}=await import('/out/vector-pdf/contract.mjs');
    const bytes=new Uint8Array(${JSON.stringify([...samples[0].bytes])}),native=createImageBitmap.bind(globalThis);
    let release,arrived,bitmap,calls=0;
    const ready=new Promise(resolve=>arrived=resolve),gate=new Promise(resolve=>release=resolve);
    globalThis.createImageBitmap=async(...args)=>{calls++;bitmap=await native(...args);arrived();await gate;return bitmap;};
    try{
      const controller=new AbortController();controller.abort();
      const early=await normalizeVectorPdfImage({bytes,mimeType:'image/png',signal:controller.signal}).then(()=>null,e=>e.name);
      const beforeCalls=calls,late=new AbortController();let settled=false;
      const pending=normalizeVectorPdfImage({bytes,mimeType:'image/png',signal:late.signal}).then(()=>null,e=>e.name).finally(()=>settled=true);
      await ready;late.abort();await Promise.resolve();const settledBeforeRelease=settled;release();const result=await pending;
      return {early,beforeCalls,result,settledBeforeRelease,closed:bitmap.width===0&&bitmap.height===0,calls};
    }finally{release();globalThis.createImageBitmap=native;}
  })()`);
  assert.deepEqual(lifetime,{early:'AbortError',beforeCalls:0,result:'AbortError',settledBeforeRelease:false,closed:true,calls:1});
  writeFileSync(resolve(out,'normalization-lifetime.json'),JSON.stringify(lifetime,null,2)+'\n');
}
