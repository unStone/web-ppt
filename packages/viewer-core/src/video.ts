import { hiddenBefore, staticHidden, type Presentation } from '@web-ppt/core';
import { VideoScene } from './video/scene';
import { WebmWriter } from './video/webm';
import { groupDuration, videoPlan, type VideoOptions } from './video/timing';
export type { VideoOptions };
export { videoPlan };

/** 浏览器固定时间轴导出；复用播放器补间，WebCodecs 编码 VP8/VP9；PCM WAV 与内嵌 MP4 音轨混为 Opus。 */
export async function presentationToVideo(pres: Presentation, options: VideoOptions = {}): Promise<Blob> {
  const plan = videoPlan(pres, options);
  const abort = () => { if (options.signal?.aborted) throw new DOMException('视频导出已取消', 'AbortError'); };
  abort();
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined' || typeof document === 'undefined') {
    throw new Error('当前浏览器不支持 WebCodecs 视频编码，请使用支持的 HTTPS 或本机浏览器');
  }
  // 音轨与画面合成按需加载，避免进入官网首次激活的静态闭包预算。
  const [{ encodeOpusAudio, mixVideoAudio, videoAudioPlan }, { openVideoMedia, videoMediaPlan }] = await Promise.all([
    import('./video/audio'),
    import('./video/media'),
  ]);
  const audioPlan = videoAudioPlan(plan);
  const mediaPlan = videoMediaPlan(plan);
  let media: Awaited<ReturnType<typeof openVideoMedia>> | undefined;
  if (mediaPlan.clips.length) {
    try {
      media = await openVideoMedia(mediaPlan.clips, options.signal);
    } catch (error) {
      // 解码/解封装失败时只有显式海报开关才允许静默贴封面，否则必须让调用方看见原因。
      if (!options.mediaPosters) throw error;
      media = undefined;
    }
  } else if (mediaPlan.hasVideoMedia && !options.mediaPosters) {
    throw new Error('内嵌视频无法合成画面（需可读取的 progressive H.264 MP4）；请显式允许静态封面');
  }
  let audio: { packets: { data: Uint8Array; timestamp: number; duration: number }[]; codecPrivate: Uint8Array; sampleRate: number } | undefined;
  const audioClips = [
    ...audioPlan.clips,
    ...(media?.audioClips.map(clip => ({ startMs: clip.startMs, volume: clip.volume, buffer: clip.buffer })) ?? []),
  ];
  if (audioClips.length) {
    const mixed = await mixVideoAudio(plan, audioClips, options.signal);
    audio = await encodeOpusAudio(mixed, options.signal);
  }
  abort();
  let configuration: VideoEncoderConfig | undefined, codec: 'VP8' | 'VP9' = 'VP9';
  for (const candidate of ['vp09.00.10.08', 'vp8']) {
    const config: VideoEncoderConfig = { codec: candidate, width: plan.width, height: plan.height, framerate: plan.fps, bitrate: plan.bitrate, latencyMode: 'realtime' };
    if ((await VideoEncoder.isConfigSupported(config)).supported) { configuration = config; codec = candidate === 'vp8' ? 'VP8' : 'VP9'; break; }
  }
  if (!configuration) throw new Error('当前浏览器没有支持此尺寸的 VP8/VP9 视频编码器');
  abort();
  const writer = new WebmWriter(plan.width, plan.height, plan.fps, codec, audio && { sampleRate: audio.sampleRate, codecPrivate: audio.codecPrivate });
  let failure: unknown, frameNumber = 0;
  const encoder = new VideoEncoder({
    output: chunk => {
      try {
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
        writer.addFrame(data, chunk.timestamp, chunk.duration ?? Math.round(1000000 / plan.fps), chunk.type === 'key');
      } catch (error) { failure = error; }
    }, error: error => { failure = error; },
  });
  const canvas = document.createElement('canvas'); canvas.width = plan.width; canvas.height = plan.height;
  const context = canvas.getContext('2d');
  if (!context) { encoder.close(); media?.close(); throw new Error('无法获取视频画布'); }
  const scene = new VideoScene(pres, !!options.showComments);
  const stop = () => { if (encoder.state !== 'closed') encoder.close(); }; options.signal?.addEventListener('abort', stop, { once: true });
  const healthy = () => { abort(); if (failure) throw failure; };
  const drain = async () => {
    if (encoder.encodeQueueSize < 8) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); encoder.removeEventListener('dequeue', ready); options.signal?.removeEventListener('abort', cancel); };
      const ready = () => { if (encoder.encodeQueueSize < 8 || failure) { cleanup(); resolve(); } };
      const cancel = () => { cleanup(); reject(new DOMException('视频导出已取消', 'AbortError')); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('视频编码器等待超时')); }, 30000);
      encoder.addEventListener('dequeue', ready); options.signal?.addEventListener('abort', cancel, { once: true }); ready();
    }); healthy();
  };
  const scale = plan.width / pres.width;
  const render = async (duration: number, slideNumber: number, animations: Animation[] = []) => {
    const count = plan.frames(duration);
    for (let i = 0; i < count; i++) {
      healthy(); for (const a of animations) a.currentTime = duration * i / count;
      await scene.draw(context, plan.width, plan.height); healthy();
      if (media) {
        const timeMs = frameNumber * 1000 / plan.fps;
        await media.paint(context, timeMs, scale);
        healthy();
      }
      await drain();
      const timestamp = Math.round(frameNumber * 1000000 / plan.fps), next = Math.round((frameNumber + 1) * 1000000 / plan.fps);
      const frame = new VideoFrame(canvas, { timestamp, duration: next - timestamp });
      try { encoder.encode(frame, { keyFrame: frameNumber % (plan.fps * 2) === 0 }); } finally { frame.close(); }
      frameNumber++; options.onProgress?.({ completed: frameNumber, total: plan.total, slideNumber });
    }
    scene.settle(animations);
    await Promise.resolve();
  };
  try {
    encoder.configure(configuration); let previous: SVGGElement | undefined;
    for (const page of plan.pages) {
      healthy(); const hidden = page.groups.length ? hiddenBefore(page.groups, 0) : staticHidden(page.slide);
      const current = await scene.page(page.slide, [...hidden]); healthy();
      if (previous && page.transition) await render(page.transition, page.slideNumber, scene.transition(previous, current, page.slide));
      previous?.remove();
      for (const group of page.groups) {
        if (page.click) await render(page.click, page.slideNumber);
        await render(groupDuration(group), page.slideNumber, scene.group(current, group));
      }
      await render(page.hold, page.slideNumber); previous = current;
    }
    await encoder.flush(); healthy();
    if (audio) {
      for (const packet of audio.packets) {
        abort();
        writer.addAudio(packet.data, packet.timestamp, packet.duration || Math.round(1000000 * 960 / audio.sampleRate));
      }
    }
    return writer.finish();
  } finally {
    options.signal?.removeEventListener('abort', stop); stop(); scene.dispose(); media?.close(); canvas.width = canvas.height = 0;
  }
}
