import { hiddenBefore, staticHidden, type Presentation, type SlideElement } from '@web-ppt/core';
import { VideoScene } from './video/scene';
import { WebmWriter } from './video/webm';
import { groupDuration, videoPlan, type VideoOptions } from './video/timing';
export type { VideoOptions };
export { videoPlan };

/** 浏览器固定时间轴导出；复用播放器补间，WebCodecs 编码 VP8/VP9，无音轨。 */
export async function presentationToVideo(pres: Presentation, options: VideoOptions = {}): Promise<Blob> {
  const plan = videoPlan(pres,options);
  const abort = () => { if (options.signal?.aborted) throw new DOMException('视频导出已取消','AbortError'); };
  abort();
  if (typeof VideoEncoder==='undefined'||typeof VideoFrame==='undefined'||typeof document==='undefined') throw new Error('当前浏览器不支持 WebCodecs 视频编码，请使用支持的 HTTPS 或本机浏览器');
  const hasMedia = (elements: SlideElement[]): boolean => elements.some(e=>e.kind==='image'&&!!e.media||e.kind==='group'&&hasMedia(e.children));
  if (!options.mediaPosters && plan.pages.some(p=>hasMedia(p.slide.elements))) throw new Error('视频导出不包含内嵌音视频；请显式允许静态封面');
  let configuration: VideoEncoderConfig | undefined, codec: 'VP8'|'VP9' = 'VP9';
  for (const candidate of ['vp09.00.10.08','vp8']) {
    const config: VideoEncoderConfig = {codec:candidate,width:plan.width,height:plan.height,framerate:plan.fps,bitrate:plan.bitrate,latencyMode:'realtime'};
    if ((await VideoEncoder.isConfigSupported(config)).supported) { configuration=config;codec=candidate==='vp8'?'VP8':'VP9';break; }
  }
  if (!configuration) throw new Error('当前浏览器没有支持此尺寸的 VP8/VP9 视频编码器');
  abort();
  const writer = new WebmWriter(plan.width,plan.height,plan.fps,codec);
  let failure: unknown, frameNumber = 0;
  const encoder = new VideoEncoder({
    output: chunk => {
      try { const data=new Uint8Array(chunk.byteLength);chunk.copyTo(data);writer.addFrame(data,chunk.timestamp,chunk.duration??Math.round(1000000/plan.fps),chunk.type==='key'); }
      catch(error) { failure=error; }
    },error: error => { failure=error; },
  });
  const canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;
  const context=canvas.getContext('2d');
  if (!context) { encoder.close();throw new Error('无法获取视频画布'); }
  const scene=new VideoScene(pres,!!options.showComments);
  const stop=()=>{if(encoder.state!=='closed')encoder.close();};options.signal?.addEventListener('abort',stop,{once:true});
  const healthy=()=>{abort();if(failure)throw failure;};
  const drain=async()=>{
    if(encoder.encodeQueueSize<8)return;
    await new Promise<void>((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timeout);encoder.removeEventListener('dequeue',ready);options.signal?.removeEventListener('abort',cancel);};
      const ready=()=>{if(encoder.encodeQueueSize<8||failure){cleanup();resolve();}};
      const cancel=()=>{cleanup();reject(new DOMException('视频导出已取消','AbortError'));};
      const timeout=setTimeout(()=>{cleanup();reject(new Error('视频编码器等待超时'));},30000);
      encoder.addEventListener('dequeue',ready);options.signal?.addEventListener('abort',cancel,{once:true});ready();
    });healthy();
  };
  const render=async(duration: number,slideNumber: number,animations: Animation[] =[])=>{
    const count=plan.frames(duration);
    for(let i=0;i<count;i++){
      healthy();for(const a of animations)a.currentTime=duration*i/count;
      await scene.draw(context,plan.width,plan.height);healthy();await drain();
      const timestamp=Math.round(frameNumber*1000000/plan.fps),next=Math.round((frameNumber+1)*1000000/plan.fps);
      const frame=new VideoFrame(canvas,{timestamp,duration:next-timestamp});
      try{encoder.encode(frame,{keyFrame:frameNumber%(plan.fps*2)===0});}finally{frame.close();}
      frameNumber++;options.onProgress?.({completed:frameNumber,total:plan.total,slideNumber});
    }
    scene.settle(animations);
    // 退场句柄的完成回调先收束，避免它在下一批入场后重新隐藏同一目标。
    await Promise.resolve();
  };
  try{
    encoder.configure(configuration);let previous: SVGGElement | undefined;
    for(const page of plan.pages){
      healthy();const hidden=page.groups.length?hiddenBefore(page.groups,0):staticHidden(page.slide);
      const current=await scene.page(page.slide,[...hidden]);healthy();
      if(previous&&page.transition)await render(page.transition,page.slideNumber,scene.transition(previous,current,page.slide));
      previous?.remove();
      for(const group of page.groups){
        if(page.click)await render(page.click,page.slideNumber);
        await render(groupDuration(group),page.slideNumber,scene.group(current,group));
      }
      await render(page.hold,page.slideNumber);previous=current;
    }
    await encoder.flush();healthy();return writer.finish();
  }finally{options.signal?.removeEventListener('abort',stop);stop();scene.dispose();canvas.width=canvas.height=0;}
}
