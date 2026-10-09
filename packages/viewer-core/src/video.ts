import { hiddenBefore, staticHidden, type Presentation, type SlideElement } from '@web-ppt/core';
import { VideoScene } from './video/scene';
import { WebmWriter } from './video/webm';
import { groupDuration, videoPlan, type VideoOptions } from './video/timing';
import { mixAudioClips, type AudioClip } from './video/mix';
export type { VideoOptions };
export { videoPlan };

type MediaImage = Extract<SlideElement,{kind:'image'}>;
type AudioMediaElement = MediaImage & { media: NonNullable<MediaImage['media']> };
const audioElements = (elements: SlideElement[]): AudioMediaElement[] => {
  const found: AudioMediaElement[] = [];
  const walk = (list: SlideElement[]): void => { for (const el of list) {
    if (el.kind==='image' && el.media && el.media.kind==='audio' && el.media.playback && el.media.src) found.push(el as AudioMediaElement);
    else if (el.kind==='group') walk(el.children);
  } };
  walk(elements); return found;
};

/** 解码音频媒体（WAV / 浏览器可解的嵌入音频）为浮点样本；blob 与外链都经 fetch 取字节 */
async function decodeClip(src: string, signal?: AbortSignal): Promise<{ samples: Float32Array; sampleRate: number; channels: number }> {
  const response = await fetch(src,{signal}); if (!response.ok) throw new Error(`音频媒体读取失败：HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const OfflineAudioContextClass: typeof OfflineAudioContext | undefined = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!OfflineAudioContextClass) throw new Error('当前浏览器不支持音频解码（OfflineAudioContext 缺失）');
  const buffer = await new OfflineAudioContextClass(1,1,48000).decodeAudioData(bytes);
  const samples = new Float32Array(buffer.length*buffer.numberOfChannels);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++)
    samples.set(buffer.getChannelData(channel),channel*buffer.length);
  return { samples, sampleRate: buffer.sampleRate, channels: Math.min(2,buffer.numberOfChannels) };
}

/** 音频轨编码：混音核输出按 20ms 块喂 Opus，块时间戳与视频共用毫秒时间轴 */
async function encodeAudioTrack(writer: WebmWriter, mixed: Float32Array, sampleRate: number, channels: number, signal?: AbortSignal): Promise<void> {
  const configuration: AudioEncoderConfig = { codec:'opus', sampleRate, numberOfChannels: channels, bitrate: 96000 };
  if (typeof AudioEncoder==='undefined' || typeof AudioData==='undefined' || !(await AudioEncoder.isConfigSupported(configuration)).supported) throw new Error('当前浏览器不支持 Opus 音频编码');
  let failure: unknown;
  const encoder = new AudioEncoder({ output: chunk => {
    try { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); writer.addAudio(data,Math.round(chunk.timestamp/1000)); }
    catch (error) { failure = error; }
  }, error: error => { failure = error; } });
  const stop = () => { if (encoder.state!=='closed') encoder.close(); }; signal?.addEventListener('abort',stop,{once:true});
  try {
    encoder.configure(configuration);
    const framesPerChunk = Math.round(sampleRate*0.02);
    for (let offset = 0; offset*channels < mixed.length; offset += framesPerChunk) {
      if (signal?.aborted) throw new DOMException('视频导出已取消','AbortError');
      if (failure) throw failure;
      const count = Math.min(framesPerChunk,Math.floor(mixed.length/channels)-offset);
      if (count<=0) break;
      const chunk = new AudioData({ format:'f32', sampleRate, numberOfFrames:count, numberOfChannels:channels,
        timestamp: Math.round(offset/sampleRate*1000000), data: new Float32Array(mixed.subarray(offset*channels,(offset+count)*channels)) });
      try { encoder.encode(chunk); } finally { chunk.close(); }
      if (encoder.encodeQueueSize>=16) await new Promise<void>(resolve => {
        const ready = () => { if (encoder.encodeQueueSize<16||failure) { encoder.removeEventListener('dequeue',ready); resolve(); } };
        encoder.addEventListener('dequeue',ready); ready();
      });
    }
    await encoder.flush(); if (failure) throw failure;
  } finally { signal?.removeEventListener('abort',stop); stop(); }
}

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
  // 声明音频轨的依据是预扫描：任意页存在带 timing 播放语义的音频媒体（混音输出固定双声道 48kHz）
  const wantsAudio = !!options.audio && plan.pages.some(p=>audioElements(p.slide.elements).length>0);
  const writer = new WebmWriter(plan.width,plan.height,plan.fps,codec,wantsAudio?{sampleRate:48000,channels:2}:undefined);
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
    // 音轨片段：音频开关开启时，按渲染循环的时间轴游标换算每个媒体组的起始毫秒。
    // 页时间轴 = [切换][组×N（点击停顿 + 组动画）][停留]；媒体在其批次的触发时刻起步
    const clips: AudioClip[] = [];
    encoder.configure(configuration);let previous: SVGGElement | undefined;let pageStartMs = 0;
    for(const page of plan.pages){
      healthy();const hidden=page.groups.length?hiddenBefore(page.groups,0):staticHidden(page.slide);
      const transitionMs = previous&&page.transition?page.transition:0;
      const current=await scene.page(page.slide,[...hidden]);healthy();
      if(transitionMs)await render(page.transition!,page.slideNumber,scene.transition(previous!,current,page.slide));
      previous?.remove();
      if(options.audio){
        // 组 g 的触发时刻 = 页起点 + 切换 + 前 g 组时长；组号超出动画批数的媒体落在最后一批
        const groupStarts:number[]=[];let cursorMs=pageStartMs+transitionMs;
        for(const group of page.groups){groupStarts.push(cursorMs);cursorMs+=(page.click??0)+groupDuration(group);}
        for(const element of audioElements(page.slide.elements)){
          const playback=element.media.playback!;
          const startsAt=groupStarts.length
            ? groupStarts[Math.min(playback.clickGroup,groupStarts.length-1)]
            : pageStartMs+transitionMs;
          const decoded=await decodeClip(element.media.src!,options.signal);healthy();
          clips.push({samples:decoded.samples,sampleRate:decoded.sampleRate,channels:decoded.channels,
            startMs:startsAt,loop:playback.loop,volume:playback.volume,
            endMs:playback.loop?undefined:startsAt+decoded.samples.length/decoded.channels/decoded.sampleRate*1000});
        }
      }
      for(const group of page.groups){
        if(page.click)await render(page.click,page.slideNumber);
        await render(groupDuration(group),page.slideNumber,scene.group(current,group));
      }
      await render(page.hold,page.slideNumber);previous=current;
      pageStartMs+=transitionMs+page.groups.reduce((n,g)=>n+(page.click??0)+groupDuration(g),0)+page.hold;
    }
    await encoder.flush();healthy();
    // 音轨编码在视频帧之后：混音核确定性计算 → Opus 块按毫秒时间戳交错写入
    if(options.audio&&clips.length){
      const totalMs=Math.round(frameNumber/plan.fps*1000);
      const mixed=mixAudioClips(clips,totalMs,{sampleRate:48000,channels:2});
      await encodeAudioTrack(writer,mixed,48000,2,options.signal);
    }
    return writer.finish();
  }finally{options.signal?.removeEventListener('abort',stop);stop();scene.dispose();canvas.width=canvas.height=0;}
}
