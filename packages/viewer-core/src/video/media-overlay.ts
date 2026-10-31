import type { GroupElement, Presentation, Slide, SlideElement } from '@web-ppt/core';
import { placeGroupChild } from '@web-ppt/core';
import type { VideoOptions } from './timing';

/** 叠加画法所需的元素级信息：坐标为页面（或经 placeGroupChild 折算后的组局部）坐标 */
interface OverlayElement {
  el: HTMLVideoElement;
  x: number; y: number; w: number; h: number;
  rot: number; flipH: boolean; flipV: boolean;
  crop: { l: number; t: number; r: number; b: number } | null;
  alpha?: number;
  clipPath?: string | null;
  filter?: string;
  /** 祖先组链的容器变换（外层在前）：组的 rotate+translate 与 flip，与 SVG 渲染逐层一致 */
  chain: DOMMatrix[];
  startMs: number; // 全局时间轴上的起始毫秒（由 clickGroup 换算）
  durationS: number;
  loop: boolean;
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
    resolve(ok && Number.isFinite(video.duration) && video.duration > 0);
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

/** SVG baseTransform 的矩阵等价：绕元素中心 rotate 后平移到元素原点（变换列表从左到右右乘） */
const baseMatrix = (el: { x: number; y: number; w: number; h: number; rot: number }): DOMMatrix => {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const matrix = new DOMMatrix().translateSelf(cx, cy);
  if (el.rot) matrix.rotateSelf(el.rot);
  return matrix.translateSelf(-cx, -cy).translateSelf(el.x, el.y);
};

/** SVG flipTransform 的矩阵等价：绕自身宽高中心翻转 */
const flipMatrix = (el: { w: number; h: number; flipH: boolean; flipV: boolean }): DOMMatrix => {
  if (!el.flipH && !el.flipV) return new DOMMatrix();
  return new DOMMatrix().translateSelf(el.w / 2, el.h / 2).scaleSelf(el.flipH ? -1 : 1, el.flipV ? -1 : 1)
    .translateSelf(-el.w / 2, -el.h / 2);
};

/**
 * 内嵌视频合成层：把 `<video>` 当前帧按元素的全部视觉属性叠加到导出画布。
 *
 * 取帧用 seek + drawImage 而非手写解封装：浏览器 `<video>` 覆盖全部容器 / 编码组合，
 * seek 内部即关键帧定位 + 解码到目标时刻（有界——每个媒体只保留一个按需 seek 的实例，
 * 不按页面长度预解码）；导出是逐帧离线流程，同一媒体字节 + 同一时间戳得到同一帧。
 *
 * 元素保真与 SVG 渲染逐层对齐：组链先经 `placeGroupChild` 把位置尺寸折算到页面坐标
 * （clipPath 也随之缩放），组的 rotate / flip 与元素自身的 rotate / flip / crop / alpha /
 * clipPath / CSS filter 在画布上按同一变换顺序重建。媒体之间的绘制顺序沿元素顺序（z 序）。
 *
 * 语义：`playback.loop` 循环取模；媒体元素随其所属页呈现，翻页后不再显示（音频不受此限，
 * 由混音链路的全局时间轴处理）——PowerPoint 的元素归属语义。合成失败不阻断导出（调用方
 * 已经以 `mediaPosters` 显式接受海报呈现），但每次退回海报都经 `onWarning` 暴露稳定 reason：
 * - `video-overlay-unavailable`：加载失败、5s 内未取得首帧或时长无效，该视频全程保留海报帧
 * - `video-overlay-frame-unavailable`：seek 超时或帧数据不可用，受影响的帧可能是海报或非目标时刻的画面
 */
export class MediaOverlay {
  /** 全局媒体表：元素属于某页，但时间轴是全稿毫秒轴（跨页媒体由起始页登记） */
  private videos = new Map<number, OverlayElement[]>();
  private disposed = false;

  constructor(private readonly warn: OverlayWarning | undefined) {}

  /** 预加载页面的视频媒体（每页一个列表；须在导出循环前调用） */
  async load(pres: Presentation, slide: Slide, slideNumber: number, groupStarts: number[]): Promise<void> {
    const list: OverlayElement[] = [];
    // 组链与 SVG 渲 renderGroup 一致：位置尺寸经 placeGroupChild 折算，组自身 rotate/flip 由容器承担
    const walk = (elements: SlideElement[], chain: DOMMatrix[], parent?: GroupElement): void => {
      for (const raw of elements) {
        const el = parent ? placeGroupChild(parent, raw) : raw;
        if (el.kind === 'group') {
          const nested = [...chain, baseMatrix(el), flipMatrix(el)];
          walk(el.children, nested, el);
        } else if (el.kind === 'image' && el.media && el.media.kind === 'video' && el.media.src) {
          const playback = el.media.playback;
          if (!playback) continue; // 无 timing 播放语义的媒体不响（与幻灯片触发一致）
          const startMs = groupStarts.length
            ? groupStarts[Math.min(playback.clickGroup, groupStarts.length - 1)]
            : 0;
          const video = document.createElement('video');
          video.muted = true; video.preload = 'auto'; video.playsInline = true;
          video.src = el.media.src;
          list.push({
            el: video, x: el.x, y: el.y, w: el.w, h: el.h, rot: el.rot, flipH: el.flipH, flipV: el.flipV,
            crop: el.crop, alpha: el.alpha, clipPath: el.clipPath, filter: el.filter,
            chain, startMs, durationS: Number.isFinite(video.duration) ? video.duration : 0,
            loop: playback.loop, name: el.name ?? '', frameWarned: false,
          });
        }
      }
    };
    walk(slide.elements, []);
    if (!list.length) return;
    const ready = await Promise.all(list.map(v => firstFrame(v.el)));
    if (this.disposed) { for (const v of list) release(v.el); return; }
    const usable = list.filter((v, i) => {
      if (ready[i]) { v.durationS = v.el.duration; return true; }
      release(v.el);
      this.warn?.('video-overlay-unavailable', { slideNumber, elementName: v.name });
      return false;
    });
    this.videos.set(slideNumber, usable);
  }

  /**
   * 把当前时间轴的视频帧画到画布。在 SVG 光栅化之后调用，叠加在海报帧之上；
   * scaleX/scaleY 把幻灯片坐标换算到导出画布坐标。
   */
  async draw(context: CanvasRenderingContext2D, slideNumber: number, timelineMs: number, scaleX: number, scaleY: number): Promise<void> {
    const list = this.videos.get(slideNumber);
    if (!list) return;
    for (const video of list) {
      const elapsed = (timelineMs - video.startMs) / 1000;
      if (elapsed < 0) continue; // 尚未开始
      const target = video.loop
        ? video.durationS > 0 ? elapsed % video.durationS : 0
        : Math.min(elapsed, video.durationS);
      // 仅在目标时间与当前时间差 > 1/30s 时才跳（避免同帧重复 seek）
      const seeked = Math.abs(video.el.currentTime - target) <= 1 / 30 || await seek(video.el, target);
      if (!seeked || video.el.readyState < 2) {
        if (!video.frameWarned) {
          video.frameWarned = true;
          this.warn?.('video-overlay-frame-unavailable', { slideNumber, elementName: video.name });
        }
        if (video.el.readyState < 2) continue;
      }
      // 变换链：画布全局缩放 → 祖先组容器 → 元素 rotate+translate → 元素翻转
      context.save();
      context.setTransform(new DOMMatrix().scaleSelf(scaleX, scaleY));
      for (const matrix of video.chain) context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
      context.transform(...(() => { const m = baseMatrix(video); return [m.a, m.b, m.c, m.d, m.e, m.f] as const; })());
      const flip = flipMatrix(video);
      context.transform(flip.a, flip.b, flip.c, flip.d, flip.e, flip.f);
      if (video.clipPath) context.clip(new Path2D(video.clipPath));
      if (video.alpha !== undefined) context.globalAlpha *= Math.max(0, Math.min(1, video.alpha));
      if (video.filter) context.filter = video.filter;
      const source = video.el;
      if (video.crop && (video.crop.l || video.crop.t || video.crop.r || video.crop.b)) {
        const vw = source.videoWidth, vh = source.videoHeight;
        context.drawImage(source,
          video.crop.l * vw, video.crop.t * vh,
          Math.max(1, (1 - video.crop.l - video.crop.r) * vw), Math.max(1, (1 - video.crop.t - video.crop.b) * vh),
          0, 0, video.w, video.h);
      } else {
        context.drawImage(source, 0, 0, video.w, video.h);
      }
      context.restore();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const list of this.videos.values()) for (const v of list) release(v.el);
    this.videos.clear();
  }
}
