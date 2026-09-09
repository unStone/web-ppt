const ensure=(condition,message)=>{if(!condition)throw new Error(message);};

/** 在源字体读取边界暂停，验证关闭可取消初始化，不等待永远不会到达的字节。 */
export async function fontInitializationBrowserContract({createEditorApplication,openEditor,adjustments,bytes,host}){
  const session=await openEditor(bytes,{embeddedFonts:'source'}),source=session.embeddedFontSources[0].src;
  const original=window.fetch;
  let entered;
  const reading=new Promise(resolve=>{entered=resolve;});
  window.fetch=(input,options)=>{
    if(input!==source)return original(input,options);
    entered();
    return new Promise((resolve,reject)=>{
      const stop=()=>reject(new DOMException('已取消','AbortError'));
      if(options.signal.aborted)stop();else options.signal.addEventListener('abort',stop,{once:true});
    });
  };
  const app=await createEditorApplication({...host,tools:undefined},()=>{});
  try{
    const opening=app.replace(session,{}, {adjustments},new AbortController().signal);
    let timer;
    try{
      await Promise.race([reading,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('未进入字体初始化读取')),3000);})]);
    }finally{clearTimeout(timer);}
    const closing=app.dispose();
    try{
      await Promise.race([closing,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('关闭没有取消待完成的字体初始化')),3000);})]);
    }finally{clearTimeout(timer);}
    ensure(await opening===undefined&&session.disposed,'取消初始化后不能留下可编辑文稿');
    ensure(!host.canvas.children.length&&!host.objects.children.length,'取消字体初始化后不能留下迟到视图');
    return {closedPendingRead:true,lateView:false};
  }finally{window.fetch=original;await app.dispose();session.dispose();}
}
