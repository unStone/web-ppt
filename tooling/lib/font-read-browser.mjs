const ensure=(condition,message)=>{if(!condition)throw new Error(message);};
const turn=()=>new Promise(resolve=>setTimeout(resolve,20));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

export async function fontReadBrowserContract(fonts,provider,bytes){
  const request={family:'WebPPT Glyph Latin',weight:400,italic:false,purpose:'view-print'};
  const current=fonts.activeFaces().find(face=>face.family===request.family&&face.weight===400);
  ensure((await provider.resolve(request)).reason==='ambiguous-face','用例必须包含嵌入字体与显式替换的同名注册');
  const entered=deferred(),held=deferred(),controller=new AbortController();
  let saved,finished=false,replaced=false;
  const read=fonts.withFonts(controller.signal,async reader=>{
    saved=reader;
    const resolved=await reader.provider.resolve(request);
    ensure(resolved.ok&&resolved.value.id===current.id,'导出读取未采用当前选中的字体');
    const embedded=await reader.provider.embedding(current.id,request);
    ensure(embedded.ok&&embedded.value.bytes.length===bytes.length,'导出未取得真实选中字体字节');
    entered.resolve();await held.promise;
  }).then(()=>{finished=true;return null;},error=>{finished=true;return error.name;});
  let replacement;
  try{
    await entered.promise;
    replacement=fonts.load({origin:'substitute',family:request.family,bytes},{})
      .then(value=>{replaced=true;return value;});
    await turn();ensure(!replaced,'导出期间替换不能释放正在消费的字体');
    controller.abort();await turn();
    ensure(!finished&&!replaced,'取消不能提前结束读取作用域或开启字体替换');
    ensure((await provider.faceInfo(current.id,request)).ok,'消费方尚未收口时旧字体已经释放');
    held.resolve();ensure(await read==='AbortError','导出读取取消应保留 AbortError');
    ensure((await replacement).ok,'导出收口后排队的字体替换应成功');
    ensure((await provider.faceInfo(current.id,request)).reason==='face-unavailable','已结束消费的旧替换字体应释放');
    ensure((await saved.provider.resolve(request)).reason==='aborted','读取端口不能在作用域结束后继续使用');
    let called=false;const early=new AbortController();early.abort();
    const reason=await fonts.withFonts(early.signal,async()=>{called=true;}).then(()=>null,e=>e.name);
    ensure(reason==='AbortError'&&!called,'预先取消不能调用读取方');
    const failure=await fonts.withFonts(undefined,async()=>{throw new Error('consumer failed');}).then(()=>null,e=>e.message);
    ensure(failure==='consumer failed','消费错误不应被改写或悬挂');
    ensure(await fonts.withFonts(undefined,async reader=>(await reader.provider.resolve(request)).ok),'失败后应能重新读取字体');
  }finally{held.resolve();await read;await replacement;}
}

export async function fontCloseReadBrowserContract(app,session,fonts){
  const entered=deferred(),held=deferred();let signal,closed=false,closing;
  const read=fonts.withFonts(undefined,async reader=>{signal=reader.signal;entered.resolve();await held.promise;})
    .then(()=>null,error=>error.name);
  try{
    await entered.promise;
    document.querySelector('#fontTools').disabled=false;document.querySelector('#fontTools').click();
    closing=app.dispose().then(()=>{closed=true;});
    for(let i=0;i<500&&!fonts.state().disposed;i++)await turn();
    ensure(signal.aborted&&!closed&&!session.disposed,'Cordis 退出必须取消读取并等待真实回调结束：'+JSON.stringify({aborted:signal.aborted,closed,sessionDisposed:session.disposed,fonts:fonts.state()}));
    ensure(fonts.state().retainedFontBytes>0,'读取尚未结束时字体字节已经销毁');
    held.resolve();ensure(await read==='AbortError','应用退出应取消字体读取');await closing;
    ensure(session.disposed&&fonts.state().retainedFontBytes===0,'读取结束后应用没有清理会话和字体');
    return {selectedFace:true,cancelWaited:true,closeWaited:true,retainedFontBytes:fonts.state().retainedFontBytes};
  }finally{held.resolve();await read;await closing;}
}
