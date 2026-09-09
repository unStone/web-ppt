import {fontSample} from './font-glyph-samples.mjs';
import {wrapEot,TTEMBED_TTCOMPRESSED} from './font.mjs';

const options={purpose:'edit',script:'Latn',direction:'ltr',language:'en'};
const register=provider=>provider.register({id:'latin',origin:'explicit',bytes:fontSample('latin.ttf')},{purpose:'edit'});
const deferred=()=>{let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve:()=>resolve()};};

export async function fontWorkerBoundaryContract(api,assert,spawn){
  let attempts=0;
  const retry=api.createWorkerFontShaper(()=>{if(attempts++===0)throw new Error('Worker start failed');return spawn({gated:false});});
  const provider=api.createFontProvider({loadShaper:async()=>retry});
  try{
    await register(provider);
    assert.equal((await provider.shape('latin','ABC',options)).reason,'shaper-failed','Worker 创建失败返回可定位原因');
    assert.equal((await provider.shape('latin','AV office ffi ﬃ',options)).value.xAdvance,6690,'创建失败后的请求可重试');
  }finally{provider.dispose();retry.dispose();}

  const source=api.createFontProvider();await register(source);
  const font=(await source.embedding('latin',{purpose:'edit'})).value;
  const independent=api.createWorkerFontShaper(()=>spawn({gated:false}));
  try{
    const buffer=Buffer.from(font.bytes),face=await independent.open({...font,bytes:buffer},new AbortController().signal);
    buffer.fill(0);
    assert.equal((await face.shape('AV office ffi ﬃ',options)).reduce((sum,glyph)=>sum+glyph.xAdvance,0),6690,'Worker 适配器独立拥有 Buffer 字节');
    face.dispose();
    await assert.rejects(independent.open(font,new AbortController().signal),error=>error.reason==='duplicate-face-id','已释放的身份不能复用 Worker 中旧的字体缓存');
    const outer=wrapEot(font.bytes);new DataView(outer.buffer).setUint16(32,4,true);
    assert.equal((await source.register({id:'preview',origin:'embedded',bytes:outer},{purpose:'view-print'})).ok,true);
    const preview=(await source.embedding('preview',{purpose:'view-print'})).value;
    assert.equal(preview.info.fsType,0,'此样本的限制只在 EOT 外层');
    const previewFace=await independent.open(preview,new AbortController().signal);
    await assert.rejects(previewFace.shape('ABC',options),error=>error.reason==='preview-print-only','Worker 收到 sfnt 后仍须保留外层 EOT 使用限制');
    assert.ok((await previewFace.shape('ABC',{...options,purpose:'view-print'})).length>0,'外层预览字体仍可用于独立预览用途');
  }finally{independent.dispose();source.dispose();}

  const barrier=deferred();let created=0;
  const closing=api.createWorkerFontShaper(()=>{created++;return spawn({gated:true},data=>{if(data.testing==='loading')barrier.resolve();});});
  const closingProvider=api.createFontProvider({loadShaper:async()=>closing});
  try{
    await register(closingProvider);
    const first=closingProvider.shape('latin','ABC',options),second=closingProvider.shape('latin','AV',options);
    await barrier.promise;
    closingProvider.dispose();
    assert.equal((await first).reason,'provider-disposed');assert.equal((await second).reason,'provider-disposed');
    assert.equal(created,1,'关闭 Provider 时不能为随后一起取消的排队任务启动新 Worker');
    assert.equal(closing.state().pendingRequests,0);assert.equal(closing.state().retainedFontBytes,0);
  }finally{closingProvider.dispose();closing.dispose();}

  const timeout=api.createWorkerFontShaper(()=>spawn({gated:true}),{requestTimeoutMs:30});
  const timeoutProvider=api.createFontProvider({loadShaper:async()=>timeout});
  try{
    await register(timeoutProvider);
    assert.equal((await timeoutProvider.shape('latin','ABC',options)).reason,'shaper-failed','无响应 Worker 超时后终止');
    assert.equal(timeout.state().workerActive,false);assert.equal(timeout.state().pendingBytes,0);
  }finally{timeoutProvider.dispose();timeout.dispose();}

  const decoding=deferred();let decodeWorkers=0;
  const decoder=api.createWorkerFontShaper(()=>spawn({gateDecode:decodeWorkers++===0,decoded:font.bytes},
    data=>{if(data.testing==='decoding')decoding.resolve();}));
  const decodedProvider=api.createFontProvider({loadShaper:async()=>decoder,decodeEot:decoder.decodeEot});
  try{
    await register(decodedProvider);
    const controller=new AbortController();
    const pending=decodedProvider.register({id:'eot',origin:'embedded',bytes:wrapEot(font.bytes,{flags:TTEMBED_TTCOMPRESSED})},
      {purpose:'edit',signal:controller.signal});
    await decoding.promise;controller.abort();
    assert.equal((await pending).reason,'aborted','取消真实线程中等待的 EOT 解码');
    assert.equal(decodedProvider.state().reservedFontBytes,0);assert.equal(decoder.state().workerActive,false);
    assert.equal((await decodedProvider.shape('latin','AV office ffi ﬃ',options)).value.xAdvance,6690,'解压取消后保留其他已注册字体并恢复整形');
  }finally{decoder.dispose();decodedProvider.dispose();}

  let releaseWorkers=0;
  const releasable=api.createWorkerFontShaper(()=>{releaseWorkers++;return spawn({gated:false});});
  const replacing=api.createFontProvider({loadShaper:async()=>releasable,limits:{maxTotalFontBytes:font.bytes.length*2,maxFaces:2}});
  try{
    for(let index=0;index<10;index++){
      const id=`replace-${index}`;
      assert.equal((await replacing.register({id,origin:'substitute',bytes:font.bytes},{purpose:'edit'})).ok,true);
      assert.equal((await replacing.shape(id,'AV office ffi ﬃ',options)).value.xAdvance,6690);
      assert.equal(replacing.release(id),true);
      assert.equal(replacing.state().retainedFontBytes,0);assert.equal(releasable.state().retainedFontBytes,0);
      assert.equal(releasable.state().workerActive,false,'逐 face 释放结束持有旧字体的 WASM 实例');
      assert.equal((await replacing.shape(id,'A',options)).reason,'face-unavailable');
      assert.equal((await replacing.register({id,origin:'substitute',bytes:font.bytes},options)).reason,'duplicate-face-id');
    }
    assert.equal(releaseWorkers,10);
    await register(replacing);
    const another=await replacing.register({id:'another',origin:'explicit',bytes:font.bytes},options);assert.equal(another.ok,true);
    const first=replacing.shape('latin','ABC',options),second=replacing.shape('another','AV office ffi ﬃ',options);
    while(releasable.state().pendingRequests<2)await new Promise(resolve=>setTimeout(resolve,0));
    replacing.release('latin');
    assert.equal((await first).reason,'face-unavailable','释放活跃 face 拒绝该 face 的请求');
    assert.equal((await second).value.xAdvance,6690,'逐 face 释放后其他排队字体仍能重建并完成');
  }finally{replacing.dispose();releasable.dispose();}

  const gate=deferred();let rebuilding=0;
  const replay=api.createWorkerFontShaper(()=>spawn({gateDecode:rebuilding++===0,decoded:font.bytes},
    data=>{if(data.testing==='decoding')gate.resolve();}));
  const replayProvider=api.createFontProvider({loadShaper:async()=>replay,decodeEot:replay.decodeEot});
  try{
    await register(replayProvider);
    assert.equal((await replayProvider.shape('latin','ABC',options)).ok,true);
    const pending=replayProvider.register({id:'decoded',origin:'embedded',bytes:wrapEot(font.bytes,{flags:TTEMBED_TTCOMPRESSED})},options);
    await gate.promise;
    replayProvider.release('latin');
    assert.equal((await pending).ok,true,'释放非活跃字体时，进行中的解码用完整原字节重放');
    assert.equal(rebuilding,2);assert.equal(replay.state().pendingBytes,0);
    assert.equal((await replayProvider.shape('decoded','AV office ffi ﬃ',options)).value.xAdvance,6690);
  }finally{replay.dispose();replayProvider.dispose();}
}
