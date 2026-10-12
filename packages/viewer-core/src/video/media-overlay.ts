import type { Presentation, Slide, SlideElement } from '@web-ppt/core';

interface VideoElement {
  el: HTMLVideoElement;
  x: number; y: number; w: number; h: number;
  startMs: number; // 页时间轴上的起始毫秒（由 clickGroup 换算）
  name: string;
}


/**
 * 内嵌视频合成层：把 `<video>` 当前帧叠加到导出画布的媒体元素位置。
 *
 * 用 seek + drawImage 而非 WebCodecs 逐帧解码：导出本就是逐帧离线流程，
 * seek 的异步等待不破坏确定性（同一媒体字节 + 同一时间戳 → 同一帧），
 * 且浏览器 `<video>` 已覆盖全部容器 / 编码组合，免去手写 MP4 demux。
 */
export class MediaOverlay {
  private videos = new Map<number, VideoElement[]>();
  private disposed = false;

  /** 预加载页面的视频媒体（每页一个列表；须在导出循环前调用） */
  async load(pres: Presentation, slide: Slide, slideNumber: number, groupStarts: number[]): Promise<void> {
    const list: VideoElement[] = [];
    const walk = (elements: SlideElement[]): void => { for (const el of elements) {
      if (el.kind === 'image' && el.media && el.media.kind === 'video' && el.media.src) {
        const playback = el.media.playback;
        if (!playback) continue; // 无 timing 播放语义的媒体不响（与幻灯片触发一致）
        const startMs = groupStarts.length
          ? groupStarts[Math.min(playback.clickGroup, groupStarts.length - 1)]
          : 0;
        const video = document.createElement('video');
        video.muted = true; video.preload = 'auto'; video.playsInline = true;
        video.src = el.media.src;
        list.push({ el: video, x: el.x, y: el.y, w: el.w, h: el.h, startMs, name: el.name ?? '' });
      } else if (el.kind === 'group') walk(el.children);
    } };
    walk(slide.elements);
    if (!list.length) return;
    // 等待元数据就绪（取 duration）；失败不阻断导出——该视频退回海报帧
    await Promise.allSettled(list.map(v => new Promise<void>(resolve => {
      if (v.el.readyState >= 1) return resolve();
      v.el.addEventListener('loadedmetadata', () => resolve(), { once: true });
      v.el.addEventListener('error', () => resolve(), { once: true });
      setTimeout(resolve, 5000); // 元数据超时：视为不可用
    })));
    if (!this.disposed) this.videos.set(slideNumber, list);
  }

  /**
   * 把当前时间轴的视频帧画到画布。在 SVG 光栅化之后调用，叠加在海报帧之上。
   * scaleX/scaleY 把幻灯片坐标换算到导出画布坐标。
   */
  async draw(context: CanvasRenderingContext2D, slideNumber: number, timelineMs: number, scaleX: number, scaleY: number): Promise<void> {
    const list = this.videos.get(slideNumber);
    if (!list) return;
    for (const video of list) {
      if (video.el.readyState < 2 || !Number.isFinite(video.el.duration)) continue;
      const mediaTime = (timelineMs - video.startMs) / 1000;
      if (mediaTime < 0) continue; // 尚未开始
      const clamped = Math.min(Math.max(mediaTime, 0), video.el.duration);
      // seek 是异步的；仅在目标时间与当前时间差 > 1/30s 时才跳（避免同帧重复 seek）
      if (Math.abs(video.el.currentTime - clamped) > 1 / 30) {
        video.el.currentTime = clamped;
        await new Promise<void>(resolve => {
          video.el.addEventListener('seeked', () => resolve(), { once: true });
          setTimeout(resolve, 500); // seek 超时：用当前帧
        });
      }
      try {
        context.drawImage(video.el, video.x * scaleX, video.y * scaleY, video.w * scaleX, video.h * scaleY);
      } catch { /* 视频帧尚不可用：保留海报帧 */ }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const list of this.videos.values()) for (const v of list) { v.el.src = ''; v.el.load(); }
    this.videos.clear();
  }
}
