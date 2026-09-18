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
  const zhHelp=await evaluate("document.querySelector('#documentExportDialog [data-help]').textContent");
  assert(zhHelp.includes('PCM WAV')&&zhHelp.includes('progressive H.264')&&zhHelp.includes('AAC')&&zhHelp.includes('PPT 勾选')&&zhHelp.includes('动画位移'),`中文音视频拒绝项文案：${zhHelp}`);
  await click('#documentExportDialog [data-site-locale="en"]');
  // 语言切换异步加载词库；等对话框里的「帧率」变成 Frame rate 再读帮助。
  await waitFor("document.querySelector('#documentExportDialog [data-fps]')?.textContent==='Frame rate'",'视频导出英文界面');
  await changeValue(context,'#documentExportDialog [name=format]','pdf');
  await changeValue(context,'#documentExportDialog [name=format]','video');
  await waitFor("document.querySelector('#documentExportDialog [data-help]').textContent.includes('checkboxes')",'视频导出英文帮助');
  const enHelp=await evaluate("document.querySelector('#documentExportDialog [data-help]').textContent");
  assert(enHelp.includes('AAC')&&enHelp.includes('animated motion')&&enHelp.includes('H.264'),`英文音视频拒绝项文案：${enHelp}`);
  await click('#documentExportDialog [data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#documentExportDialog [data-fps]')?.textContent==='帧率'",'视频导出中文界面');
  await changeValue(context,'#documentExportDialog [name=format]','pdf');
  await changeValue(context,'#documentExportDialog [name=format]','video');
  await waitFor("document.querySelector('#documentExportDialog [data-help]').textContent.includes('PPT 勾选')",'视频导出切回中文');
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
   const sample=async(time)=>{if(time!==video.currentTime){await new Promise(resolve=>{video.onseeked=resolve;video.currentTime=time;});}
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    ctx.drawImage(video,0,0);return Array.from(ctx.getImageData(220,100,1,1).data);};
   const duration=video.duration,before=await sample(0.001),animated=[];
   for(const time of [0.6,0.8,1.0])animated.push(await sample(time));
   const after=await sample(duration-0.1),samples={before,animated,after};const metadata={duration,width:video.videoWidth,height:video.videoHeight,samples};URL.revokeObjectURL(video.src);video.remove();return metadata;})()`,true);
  writeFileSync('out/video/playback.json',JSON.stringify(playback,null,2));
  assert.equal(playback.width,480);assert.equal(playback.height,270);assert(playback.duration>1&&playback.duration<4);
  assert(playback.samples.before[0]>240,'入场前白色页面');
  assert(playback.samples.animated.some(pixel=>pixel[2]>pixel[0]+50),`动画后的蓝色形状：${JSON.stringify(playback.samples.animated)}`);
  assert(playback.samples.after[1]>playback.samples.after[0]+50,'切换后的绿色页面');
  await waitFor(`!document.querySelector('#documentExportDialog [type=submit]').disabled`,'视频释放编码器');
  await evaluate(`(() => {globalThis.__videoDownload=null;document.querySelector('#documentExportDialog [type=submit]').click();document.querySelector('#documentExportDialog [data-close]').click();})()`);
  await waitFor(`document.querySelector('#documentExportDialog [role=status]')?.textContent==='导出已取消'`,'视频取消');assert.equal(await evaluate('globalThis.__videoDownload'),null);
  await click('#documentExportDialog [data-close]');
 }finally{await evaluate('globalThis.__restoreVideoDownload()');}

 // 含内嵌视频固件：官网导出 → 独立 <video> 重开，确认非空 WebM。
 await openFixture(context,'/fixtures/sample-video-media.pptx','video-media-ui.pptx');
 await evaluate(`(() => {const original=HTMLAnchorElement.prototype.click;globalThis.__restoreVideoMediaDownload=()=>HTMLAnchorElement.prototype.click=original;HTMLAnchorElement.prototype.click=function(){if(this.download)globalThis.__videoMediaDownload=fetch(this.href).then(r=>r.arrayBuffer()).then(b=>({name:this.download,bytes:Array.from(new Uint8Array(b))}));else original.call(this);};})()`);
 try{
  await click('#exportDocument');await waitFor(`document.querySelector('#documentExportDialog')?.open`,'媒体文稿导出窗口');
  await changeValue(context,'#documentExportDialog [name=format]','video');
  await changeValue(context,'#documentExportDialog [name=fps]','12');
  await changeValue(context,'#documentExportDialog [name=duration]','0.6');
  await changeValue(context,'#documentExportDialog [name=clickDelay]','0');
  await evaluate('document.querySelector(\'#documentExportDialog [name=animations]\').checked=false');
  await evaluate('globalThis.__videoMediaDownload=null');await click('#documentExportDialog [type=submit]');
  await waitFor(`!!globalThis.__videoMediaDownload || document.querySelector('#documentExportDialog [role=status]')?.textContent.startsWith('导出失败')`,'媒体 WebM 编码',120);
  const mediaResult=await evaluate('globalThis.__videoMediaDownload',true);
  assert(mediaResult,await evaluate(`document.querySelector('#documentExportDialog [role=status]').textContent`));
  const mediaBytes=Buffer.from(mediaResult.bytes);
  writeFileSync('out/video/browser-media.webm',mediaBytes);
  assert(mediaBytes.includes(Buffer.from('A_OPUS')),'官网媒体导出应含 Opus');
  const reopen=await evaluate(`(async()=>{const result=await globalThis.__videoMediaDownload;const video=document.createElement('video');video.muted=true;video.src=URL.createObjectURL(new Blob([new Uint8Array(result.bytes)],{type:'video/webm'}));document.body.append(video);
   await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('媒体导出不能播放'));});
   const meta={duration:video.duration,width:video.videoWidth,height:video.videoHeight};URL.revokeObjectURL(video.src);video.remove();return meta;})()`,true);
  writeFileSync('out/video/browser-media-playback.json',JSON.stringify(reopen,null,2));
  assert.equal(reopen.width,480);assert.equal(reopen.height,270);
  assert(reopen.duration>1&&reopen.duration<1.6,reopen.duration);
  await waitFor(`!document.querySelector('#documentExportDialog [type=submit]').disabled`,'媒体导出资源释放');
  await click('#documentExportDialog [data-close]');
 }finally{await evaluate('globalThis.__restoreVideoMediaDownload()');}
 console.log('  WebM 实际编码、媒体固件导出重开、动画像素、切换及取消通过');
}
