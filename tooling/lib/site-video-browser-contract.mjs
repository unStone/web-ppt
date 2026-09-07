import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openFixture,changeValue } from './site-editor-browser-helpers.mjs';
export async function runSiteVideoBrowserContract(context){
 const {evaluate,waitFor,click}=context;mkdirSync('out/video',{recursive:true});
 await openFixture(context,'/fixtures/sample-video-export.pptx','video-ui.pptx');
 await evaluate(`(() => {const original=HTMLAnchorElement.prototype.click;globalThis.__restoreVideoDownload=()=>HTMLAnchorElement.prototype.click=original;HTMLAnchorElement.prototype.click=function(){if(this.download)globalThis.__videoDownload=fetch(this.href).then(r=>r.arrayBuffer()).then(b=>({name:this.download,bytes:Array.from(new Uint8Array(b))}));else original.call(this);};})()`);
 try{
  await click('#exportDocument');await waitFor(`document.querySelector('#documentExportDialog')?.open`,'视频导出窗口');
  await changeValue(context,'#documentExportDialog [name=format]','video');
  await changeValue(context,'#documentExportDialog [name=fps]','12');
  await changeValue(context,'#documentExportDialog [name=duration]','0.3');
  await changeValue(context,'#documentExportDialog [name=clickDelay]','0.1');
  await evaluate('globalThis.__videoDownload=null');await click('#documentExportDialog [type=submit]');
  await waitFor(`!!globalThis.__videoDownload || document.querySelector('#documentExportDialog [role=status]')?.textContent.startsWith('导出失败')`,'WebM 编码');
  const result=await evaluate('globalThis.__videoDownload',true);assert(result,await evaluate(`document.querySelector('#documentExportDialog [role=status]').textContent`));
  assert.equal(result.name,'video-ui-edited.webm');const bytes=Buffer.from(result.bytes);writeFileSync('out/video/browser.webm',bytes);
  const playback=await evaluate(`(async()=>{const result=await globalThis.__videoDownload;const video=document.createElement('video');video.muted=true;video.src=URL.createObjectURL(new Blob([new Uint8Array(result.bytes)],{type:'video/webm'}));document.body.append(video);
   await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('导出视频不能播放'));});
   const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d');
   const sample=async(time)=>{if(time!==video.currentTime){await new Promise(resolve=>{video.onseeked=resolve;video.currentTime=time;});}ctx.drawImage(video,0,0);return Array.from(ctx.getImageData(220,100,1,1).data);};
   const duration=video.duration,samples=[await sample(0.001),await sample(0.8),await sample(duration-0.1)];const metadata={duration,width:video.videoWidth,height:video.videoHeight,samples};URL.revokeObjectURL(video.src);video.remove();return metadata;})()`,true);
  writeFileSync('out/video/playback.json',JSON.stringify(playback,null,2));
  assert.equal(playback.width,480);assert.equal(playback.height,270);assert(playback.duration>1&&playback.duration<4);
  assert(playback.samples[0][0]>240,'入场前白色页面');assert(playback.samples[1][2]>playback.samples[1][0]+50,'动画后的蓝色形状');assert(playback.samples[2][1]>playback.samples[2][0]+50,'切换后的绿色页面');
  await waitFor(`!document.querySelector('#documentExportDialog [type=submit]').disabled`,'视频释放编码器');
  await evaluate(`(() => {globalThis.__videoDownload=null;document.querySelector('#documentExportDialog [type=submit]').click();document.querySelector('#documentExportDialog [data-close]').click();})()`);
  await waitFor(`document.querySelector('#documentExportDialog [role=status]')?.textContent==='导出已取消'`,'视频取消');assert.equal(await evaluate('globalThis.__videoDownload'),null);
  await click('#documentExportDialog [data-close]');
 }finally{await evaluate('globalThis.__restoreVideoDownload()');}
 console.log('  WebM 实际编码、独立视频解码、动画像素、切换及取消通过');
}
