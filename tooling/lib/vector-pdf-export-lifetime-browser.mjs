const ensure=(condition,message)=>{if(!condition)throw new Error(message);};
const until=async check=>{for(let i=0;i<1000;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('矢量导出生命周期超时');};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

async function imageReferences(presentation){
  const images=[];
  for(const slide of presentation.slides){
    const source=slide.elements.find(element=>element.kind==='image'),image=new Image();image.src=source.src;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});ctx.drawImage(image,0,0);
    images.push({name:source.name,width:canvas.width,height:canvas.height,rgba:[...ctx.getImageData(0,0,canvas.width,canvas.height).data]});
    image.removeAttribute('src');canvas.width=canvas.height=0;
  }
  return images;
}

/** 暂停真实 Bitmap 的返回；导出、Worker、Cordis 卸载和下载均使用生产实现。 */
export async function vectorPdfExportLifetimeBrowser({createEditorApplication,openEditor,adjustments,host}){
  const bytes=new Uint8Array(await fetch('/fixtures/sample-vector-pdf-normalization.pptx').then(r=>r.arrayBuffer()));
  const fontBytes=new Uint8Array(await fetch('/tooling/font-glyph-samples/latin.ttf').then(r=>r.arrayBuffer()));
  const plainBytes=new Uint8Array(await fetch('/fixtures/sample-editor-text.pptx').then(r=>r.arrayBuffer()));
  const click=HTMLAnchorElement.prototype.click,bitmap=createImageBitmap;
  const result={scenarios:[],images:[],files:[]};
  const submit=async(app,session,name)=>{
    const task=app.files.exportDocument(session,name);
    await until(()=>document.querySelector('#documentExportDialog')?.open);
    const dialog=document.querySelector('#documentExportDialog'),format=dialog.querySelector('[name=format]');
    format.value='vector';format.dispatchEvent(new Event('change'));dialog.querySelector('[data-export]').click();
    return {task,dialog};
  };
  for(const mode of ['cancel','replace','dispose']){
    const app=await createEditorApplication({canvas:host.canvas,objects:host.objects,textTools:[],onChange(){}},()=>{});
    const held=deferred(),entered=deferred(),downloads=[];let heldBitmap,transition,session,fonts;
    HTMLAnchorElement.prototype.click=function(){
      if(this.download)downloads.push(fetch(this.href).then(r=>r.arrayBuffer()).then(bytes=>({name:this.download,bytes:[...new Uint8Array(bytes)]})));
      else click.call(this);
    };
    try{
      session=await openEditor(bytes);
      const owner=await app.replace(session,{}, {adjustments},new AbortController().signal);fonts=owner.fonts;
      ensure((await fonts.load({bytes:fontBytes,origin:'substitute'},{})).ok,'矢量生命周期字体应安装成功');
      if(!result.images.length)result.images=await imageReferences(session.toPresentation());
      globalThis.createImageBitmap=async(...args)=>{
        const value=await bitmap.apply(globalThis,args);
        if(!heldBitmap){heldBitmap=value;entered.resolve();await held.promise;}return value;
      };
      const {task,dialog}=await submit(app,session,`vector-${mode}.pptx`);await entered.promise;
      let finished=false,replacement;
      if(mode==='cancel')dialog.querySelector('[data-close]').click();
      else if(mode==='dispose')transition=app.dispose().then(()=>{finished=true;});
      else{
        replacement=await openEditor(plainBytes);
        transition=app.replace(replacement,{}, {adjustments},new AbortController().signal).then(()=>{finished=true;});
      }
      await new Promise(resolve=>setTimeout(resolve,30));
      ensure(!finished&&!session.disposed&&fonts.state().retainedFontBytes>0,'解码尚未收口时提前释放文稿或字体');
      ensure(dialog.querySelector('[data-export]').disabled&&app.files.busy,'解码尚未收口时提前恢复文件入口');
      held.resolve();
      await until(()=>!dialog.isConnected||!dialog.querySelector('[data-export]').disabled);
      ensure(heldBitmap.width===0&&heldBitmap.height===0,'规范化没有释放实际 Bitmap');
      if(mode==='cancel'){
        ensure(!downloads.length&&dialog.querySelector('[role=status]').textContent==='导出已取消','取消后不得下载半成品');
        ensure(!fonts.state().disposed,'取消不应关闭文稿字体服务');
      }else ensure(downloads.length===1,'已提交导出必须交付一次');
      if(dialog.isConnected)dialog.querySelector('[data-close]').click();await task;
      if(mode==='cancel'){
        globalThis.createImageBitmap=bitmap;
        const retry=await submit(app,session,'vector-cancel-retry.pptx');
        await until(()=>!retry.dialog.querySelector('[data-export]').disabled);
        ensure(downloads.length===1,'取消后同一文稿应能重试');retry.dialog.querySelector('[data-close]').click();await retry.task;
      }
      await transition;await app.dispose();
      ensure(session.disposed&&fonts.state().retainedFontBytes===0&&!fonts.state().workerActive,'最终会话 / 字体 / Worker 未释放');
      if(replacement)ensure(replacement.disposed,'替换后的文稿也必须随应用释放');
      const saved=await downloads[0];ensure(new TextDecoder().decode(new Uint8Array(saved.bytes.slice(0,5)))==='%PDF-','必须交付真实 PDF');
      result.files.push({mode,...saved});result.scenarios.push({mode,downloads:downloads.length,bitmapClosed:true,retainedFontBytes:0});
    }finally{held.resolve();globalThis.createImageBitmap=bitmap;await transition;await app.dispose();HTMLAnchorElement.prototype.click=click;}
  }
  return result;
}
