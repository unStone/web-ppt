const ensure=(condition,message)=>{if(!condition)throw new Error(message);};

export async function fontInstallBrowserContract(createScope,provider){
  const original=FontFace.prototype.load,initial=document.fonts.size;
  try{
    for(const action of ['abort','dispose','failure']){
      const scope=createScope(provider),controller=new AbortController();
      let entered,release;
      const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
      FontFace.prototype.load=function(){
        entered();
        return gate.then(()=>{if(action==='failure')throw new Error('native font failure');return original.call(this);});
      };
      try{
        const pending=scope.install('embedded-0',{purpose:'edit',signal:controller.signal,family:`Font ${action}`});
        await started;
        if(action==='abort')controller.abort();
        if(action==='dispose')scope.dispose();
        if(action==='failure')release();
        const result=await pending;
        ensure(!result.ok&&result.reason===({abort:'aborted',dispose:'provider-disposed',failure:'font-install-failed'})[action],
          `字体安装中的 ${action} 未返回正确失败：${JSON.stringify(result)}`);
        release();await new Promise(resolve=>setTimeout(resolve,20));
        ensure(document.fonts.size===initial&&scope.state().faces===0&&scope.state().sourceBytes===0,'迟到的 FontFace 安装不得恢复字体资源');
      }finally{release();scope.dispose();}
    }
  }finally{FontFace.prototype.load=original;}
}
