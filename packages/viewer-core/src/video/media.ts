import type { ImageElement, SlideElement } from '@web-ppt/core';
import { groupDuration, videoPlan } from './timing';
import { Mp4FrameSource } from './media-decode';

export type VideoPlan = ReturnType<typeof videoPlan>;

const MIN_CROP = 1 / 100000;

export interface VideoMediaClip {
  id: number;
  src: string;
  /** 与音轨同一时间基准：切页动画结束后、本页内容开始。 */
  startMs: number;
  /** 默认本页结束；crossSlide 时延到整篇结束。 */
  endMs: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
  alpha: number;
  crop: { l: number; t: number; r: number; b: number } | null;
  clipPath: string | null;
  loop: boolean;
  crossSlide: boolean;
  slideNumber: number;
}

/** 从内嵌 MP4 解出的音轨，交给 006 混音链路。 */
export interface VideoMediaAudioClip {
  startMs: number;
  volume: number;
  buffer: AudioBuffer;
}

function visit(elements: readonly SlideElement[], fn: (el: SlideElement) => void): void {
  for (const el of elements) {
    fn(el);
    if (el.kind === 'group') visit(el.children, fn);
  }
}

function pageContentDuration(page: VideoPlan['pages'][number]): number {
  let ms = 0;
  for (const group of page.groups) {
    if (page.click) ms += page.click;
    ms += groupDuration(group);
  }
  return ms + page.hold;
}

/**
 * 盘点可尝试合成的内嵌视频。
 * 缺源 / 非 MP4 不进 clips，由调用方在无 clips 且无 mediaPosters 时拒绝。
 */
export function videoMediaPlan(plan: VideoPlan): { clips: VideoMediaClip[]; hasVideoMedia: boolean; durationMs: number } {
  const clips: VideoMediaClip[] = [];
  let hasVideoMedia = false;
  let durationMs = 0;
  for (const page of plan.pages) {
    if (page.transition) durationMs += page.transition;
    durationMs += pageContentDuration(page);
  }
  let ms = 0;
  for (const page of plan.pages) {
    if (page.transition) ms += page.transition;
    const startMs = ms;
    const endMs = startMs + pageContentDuration(page);
    visit(page.slide.elements, el => {
      if (el.kind !== 'image' || !el.media || el.media.kind !== 'video') return;
      hasVideoMedia = true;
      if (!el.media.src) return;
      const mime = el.media.mime ?? 'video/mp4';
      if (mime !== 'video/mp4') return;
      const image = el as ImageElement;
      // 贴帧只用静态 xfrm：动画位移/缩放不进入计划（已知边界，见 007 拒绝项）。
      const loop = !!el.media.loop;
      const crossSlide = !!el.media.crossSlide;
      clips.push({
        id: el.id ?? clips.length + 1,
        src: el.media.src,
        startMs,
        endMs: crossSlide ? durationMs : endMs,
        x: el.x, y: el.y, w: el.w, h: el.h,
        rot: el.rot, flipH: el.flipH, flipV: el.flipV,
        alpha: image.alpha ?? 1,
        crop: image.crop,
        clipPath: image.clipPath ?? null,
        loop, crossSlide,
        slideNumber: page.slideNumber,
      });
    });
    ms = endMs;
  }
  return { clips, hasVideoMedia, durationMs };
}

async function readMedia(src: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(`视频资源读取失败：${response.status}`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > 64 * 1024 * 1024) throw new Error('单个视频超过 64 MiB 上限');
  return buffer;
}

/** 用浏览器容器解码器抽出 MP4 内嵌音轨；无音轨则返回 null，有音轨但解不出则抛错。 */
export async function decodeMp4Audio(bytes: Uint8Array, signal?: AbortSignal): Promise<AudioBuffer | null> {
  if (typeof OfflineAudioContext === 'undefined' || typeof AudioContext === 'undefined') {
    throw new Error('当前环境不支持解码内嵌视频音轨');
  }
  if (signal?.aborted) throw new DOMException('视频导出已取消', 'AbortError');
  // 快速探测：progressive MP4 里是否有 soun handler，避免对纯视频误抛。
  const text = typeof TextDecoder !== 'undefined'
    ? new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)))
    : '';
  if (!text.includes('soun') && !text.includes('mp4a')) return null;
  const copy = bytes.slice().buffer;
  try {
    const probe = new OfflineAudioContext(1, 1, 48000);
    return await probe.decodeAudioData(copy);
  } catch (error) {
    throw new Error(`内嵌视频音轨（AAC 等）无法解码：${error instanceof Error ? error.message : String(error)}`);
  }
}

function paintClip(
  ctx: CanvasRenderingContext2D,
  frame: CanvasImageSource,
  clip: VideoMediaClip,
  scale: number,
): void {
  const x = clip.x * scale, y = clip.y * scale, w = clip.w * scale, h = clip.h * scale;
  const fw = 'width' in frame ? Number(frame.width) : clip.w;
  const fh = 'height' in frame ? Number(frame.height) : clip.h;
  const crop = clip.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const visibleW = Math.max(MIN_CROP, 1 - crop.l - crop.r);
  const visibleH = Math.max(MIN_CROP, 1 - crop.t - crop.b);
  const sx = crop.l * fw, sy = crop.t * fh, sw = visibleW * fw, sh = visibleH * fh;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, clip.alpha));
  ctx.translate(x + w / 2, y + h / 2);
  if (clip.rot) ctx.rotate(clip.rot * Math.PI / 180);
  ctx.scale(clip.flipH ? -1 : 1, clip.flipV ? -1 : 1);
  ctx.translate(-w / 2, -h / 2);
  if (clip.clipPath) {
    try {
      ctx.save();
      ctx.scale(w / Math.max(clip.w, 1e-6), h / Math.max(clip.h, 1e-6));
      ctx.clip(new Path2D(clip.clipPath));
      ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, clip.w, clip.h);
      ctx.restore();
    } catch {
      ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, w, h);
    }
  } else {
    ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, w, h);
  }
  ctx.restore();
}

/** 打开全部画面源，并尝试解出可混入的 AAC/音轨。 */
export async function openVideoMedia(
  clips: readonly VideoMediaClip[],
  signal?: AbortSignal,
): Promise<{
  paint: (ctx: CanvasRenderingContext2D, timeMs: number, scale: number) => Promise<void>;
  audioClips: VideoMediaAudioClip[];
  close: () => void;
}> {
  const sources = new Map<string, Mp4FrameSource>();
  const audioBySrc = new Map<string, AudioBuffer | null>();
  try {
    for (const clip of clips) {
      if (signal?.aborted) throw new DOMException('视频导出已取消', 'AbortError');
      if (sources.has(clip.src)) continue;
      const bytes = await readMedia(clip.src, signal);
      sources.set(clip.src, await Mp4FrameSource.open(bytes, signal));
      audioBySrc.set(clip.src, await decodeMp4Audio(bytes, signal));
    }
  } catch (error) {
    for (const source of sources.values()) source.close();
    throw error;
  }
  const audioClips: VideoMediaAudioClip[] = [];
  const seenAudio = new Set<string>();
  for (const clip of clips) {
    const buffer = audioBySrc.get(clip.src);
    if (!buffer) continue;
    // 同 src + 起点只混一次，避免同页多路画面把音轨叠响。
    const key = `${clip.src}\0${clip.startMs}`;
    if (seenAudio.has(key)) continue;
    seenAudio.add(key);
    audioClips.push({ startMs: clip.startMs, volume: 1, buffer });
  }
  return {
    audioClips,
    async paint(ctx, timeMs, scale) {
      for (const clip of clips) {
        if (timeMs + 1e-6 < clip.startMs || timeMs >= clip.endMs) continue;
        const source = sources.get(clip.src);
        if (!source) continue;
        let localUs = Math.round((timeMs - clip.startMs) * 1000);
        const durationUs = Math.max(1, source.durationUs);
        if (clip.loop) {
          localUs = ((localUs % durationUs) + durationUs) % durationUs;
        } else if (localUs >= durationUs) {
          localUs = durationUs - 1; // 页内结束策略：定格末帧
        }
        const frame = await source.frameAt(localUs, signal);
        if (!frame) continue;
        paintClip(ctx, frame, clip, scale);
      }
    },
    close() { for (const source of sources.values()) source.close(); sources.clear(); },
  };
}
