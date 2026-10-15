import type { Presentation, Slide, SlideElement } from '@web-ppt/core';
import type { VideoOptions } from './timing';

interface VideoElement {
  el: HTMLVideoElement;
  x: number; y: number; w: number; h: number;
  startMs: number; // 页时间轴上的起始毫秒（由 clickGroup 换算）
  name: string;
  frameWarned: boolean; // 取帧失败每个元素只报一次，避免逐帧刷屏
}

type OverlayWarning = NonNullable<VideoOptions['onWarning']>;

const LOAD_TIMEOUT_MS = 5000;
const SEEK_TIMEOUT_MS = 500;

/**
 * 等到首帧可画（HAVE_CURRENT_DATA）。只到元数据时 drawImage 按规范什么都不画，
 * 首帧会无声地停在海报上，所以就绪条件取 loadeddata 而非 loadedmetadata。
 */
const firstFrame = (video: HTMLVideoElement): Promise<boolean> => new Promise(resolve => {
  const settle = (ok: boolean) => {
    clearTimeout(timer); video.removeEventListener('loadeddata', loaded); video.removeEventListener('error', failed);
    resolve(ok && Number.isFinite(video.duration));
  };
  const loaded = () => settle(true), failed = () => settle(false);
  const timer = setTimeout(failed, LOAD_TIMEOUT_MS);
  video.addEventListener('loadeddata', loaded); video.addEventListener('error', failed);
  if (video.readyState >= 2) settle(true);
});

const seek = (video: HTMLVideoElement, time: number): Promise<boolean> => new Promise(resolve => {
  const settle = (ok: boolean) => { clearTimeout(timer); video.removeEventListener('seeked', done); resolve(ok); };
  const done = () => settle(true);
  const timer = setTimeout(() => settle(false), SEEK_TIMEOUT_MS);
  video.addEventListener('seeked', done);
  video.currentTime = time;
});

const release = (video: HTMLVideoElement): void => { video.removeAttribute('src'); video.load(); };

/**
 * 内嵌视频合成层：把 `<video>` 当前帧叠加到导出画布的媒体元素位置。
 *
 * 用 seek + drawImage 而非 WebCodecs 逐帧解码：导出本就是逐帧离线流程，
 * seek 的异步等待不破坏确定性（同一媒体字节 + 同一时间戳 → 同一帧），
 * 且浏览器 `<video>` 已覆盖全部容器 / 编码组合，免去手写 MP4 demux。
 *
 * 合成失败不阻断导出（调用方已经以 `mediaPosters` 显式接受海报呈现），
 * 但每次退回海报都经 `onWarning` 以稳定 reason 暴露：
 * - `video-overlay-unavailable`：加载失败、5s 内未取得首帧或时长无效，该视频全程保留海报帧
 * - `video-overlay-frame-unavailable`：seek 超时或帧数据不可用，受影响的帧可能是海报或非目标时刻的画面
 */
export class MediaOverlay {
  private videos = new Map<number, VideoElement[]>();
  private disposed = false;

  constructor(private readonly warn: OverlayWarning | undefined) {}

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
        list.push({ el: video, x: el.x, y: el.y, w: el.w, h: el.h, startMs, name: el.name ?? '', frameWarned: false });
      } else if (el.kind === 'group') walk(el.children);
    } };
    walk(slide.elements);
    if (!list.length) return;
    const ready = await Promise.all(list.map(v => firstFrame(v.el)));
    if (this.disposed) { for (const v of list) release(v.el); return; }
    const usable = list.filter((v, i) => {
      if (ready[i]) return true;
      release(v.el);
      this.warn?.('video-overlay-unavailable', { slideNumber, elementName: v.name });
      return false;
    });
    this.videos.set(slideNumber, usable);
  }

  /**
   * 把当前时间轴的视频帧画到画布。在 SVG 光栅化之后调用，叠加在海报帧之上。
   * scaleX/scaleY 把幻灯片坐标换算到导出画布坐标。
   */
  async draw(context: CanvasRenderingContext2D, slideNumber: number, timelineMs: number, scaleX: number, scaleY: number): Promise<void> {
    const list = this.videos.get(slideNumber);
    if (!list) return;
    for (const video of list) {
      const mediaTime = (timelineMs - video.startMs) / 1000;
      if (mediaTime < 0) continue; // 尚未开始
      const target = Math.min(mediaTime, video.el.duration);
      // 仅在目标时间与当前时间差 > 1/30s 时才跳（避免同帧重复 seek）
      const seeked = Math.abs(video.el.currentTime - target) <= 1 / 30 || await seek(video.el, target);
      if (!seeked || video.el.readyState < 2) {
        if (!video.frameWarned) {
          video.frameWarned = true;
          this.warn?.('video-overlay-frame-unavailable', { slideNumber, elementName: video.name });
        }
        if (video.el.readyState < 2) continue;
      }
      context.drawImage(video.el, video.x * scaleX, video.y * scaleY, video.w * scaleX, video.h * scaleY);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const list of this.videos.values()) for (const v of list) release(v.el);
    this.videos.clear();
  }
}
