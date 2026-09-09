const ensure=(condition,message)=>{if(!condition)throw new Error(message);};

export async function fontReplacementBrowserContract(fonts,provider,bytes){
  const before=provider.state().retainedFontBytes;
  for(let index=0;index<12;index++){
    const previous=fonts.activeFaces().find(face=>face.family==='WebPPT Glyph Latin'&&face.weight===400);
    const result=await fonts.load({origin:'substitute',family:'WebPPT Glyph Latin',bytes,sourceLabel:`replacement-${index}.ttf`},{});
    ensure(result.ok,'反复选择同一字体不应耗尽已释放资源预算');
    ensure(provider.state().retainedFontBytes===before,'字体替换保留了上一份本机字体的字节');
    ensure((await provider.faceInfo(previous.id,{purpose:'edit'})).reason==='face-unavailable','旧替换 face 仍可从 Provider 取到');
  }
  const previous=fonts.activeFaces().find(face=>face.family==='WebPPT Glyph Latin'&&face.weight===400);
  const original=FontFace.prototype.load;
  try{
    FontFace.prototype.load=()=>Promise.reject(new Error('native font install failed'));
    const result=await fonts.load({origin:'substitute',family:'WebPPT Glyph Latin',bytes},{});
    ensure(!result.ok&&result.reason==='font-install-failed','浏览器安装失败没有反馈');
    ensure(provider.state().retainedFontBytes===before,'安装失败的字体仍占有注册预算');
    ensure(fonts.activeFaces().some(face=>face.id===previous.id),'安装失败不能删除之前可用的字体');
  }finally{FontFace.prototype.load=original;}
}
