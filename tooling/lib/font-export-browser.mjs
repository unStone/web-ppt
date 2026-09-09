const ensure=(condition,message)=>{if(!condition)throw new Error(message);};
const until=async check=>{for(let index=0;index<1000;index++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('字体导出状态超时');};

export async function fontExportBrowserContract(app,session,fonts){
  const originalFetch=window.fetch,originalClick=HTMLAnchorElement.prototype.click;
  const urls=new Set(session.toPresentation().embeddedFonts.map(font=>font.src));
  let release,entered=false,downloads=0;
  const hold=new Promise(resolve=>{release=resolve;});
  window.fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(urls.has(url)){entered=true;await hold;}
    return originalFetch.call(window,input,init);
  };
  HTMLAnchorElement.prototype.click=function(){if(this.download){downloads++;return;}return originalClick.call(this);};
  try{
    const pending=app.files.exportDocument(session,'font-cancel.pptx');
    await until(()=>document.querySelector('#documentExportDialog[open]'));
    const dialog=document.querySelector('#documentExportDialog');
    dialog.querySelector('[name=scale]').value='1';
    dialog.querySelector('[data-export]').click();
    await until(()=>entered);
    dialog.querySelector('[data-close]').click();
    ensure(fonts.state().installedFaces>0&&!session.disposed,'取消导出不能提前撤销仍在读取的字体');
    release();
    await until(()=>!dialog.querySelector('[data-export]').disabled);
    ensure(downloads===0,'取消字体导出后不能产生迟到下载');
    dialog.querySelector('[data-close]').click();await pending;
    ensure(!dialog.isConnected&&!fonts.state().disposed,'取消导出不能关闭文稿字体服务');
  }finally{release();window.fetch=originalFetch;HTMLAnchorElement.prototype.click=originalClick;}
}
