/**
 * Node 无 Office 渲染按需入口。
 *
 * Agent 在没有浏览器、LibreOffice 与 Office 的 Node 环境里，经此入口得到与浏览器
 * 原生 `<text>` 路径一致的 SVG；PNG 由宿主注入的光栅化函数生成（如 resvg）。
 *
 * 刻意不在缺注入时退回估算宽度：估算断行与真实字体断行不同，静默产出一个
 * 「看起来对」的 SVG 比 fast-fail 更难排查。测字与光栅化都不进 core 依赖，
 * 由宿主显式提供（`@web-ppt/fonts/glyphs` 的 `withFontMeasurement` 产出的
 * `TextMeasure` 可直接作为 `measureText` 传入）。
 */
import { renderSlideToSvg } from './render/svg';
import type { RenderOptions } from './render/svg';
import { validateRasterSize } from './raster-size';
import type { Presentation, Slide } from './types';
import type { TextMeasure } from './render/text-measure';

/** 缺注入时抛出的稳定错误；`reason` 供程序判定，消息供人读。 */
export class NodeRenderError extends Error {
  readonly reason: 'node-measure-required' | 'node-rasterizer-required';
  constructor(reason: NodeRenderError['reason'], message: string) {
    super(message);
    this.name = 'NodeRenderError';
    this.reason = reason;
  }
}

/** SVG 渲染选项；`measureText` 必填，其余与 `RenderOptions` 同义。 */
export interface NodeSvgOptions extends Omit<RenderOptions, 'textMode' | 'measureText' | 'media'> {
  measureText: TextMeasure;
}

/** PNG 光栅化回调：拿到自包含 SVG 与目标像素尺寸，返回 PNG 字节。 */
export type NodeRasterizer = (
  svg: string,
  size: { width: number; height: number },
) => Uint8Array | Promise<Uint8Array>;

export interface NodePngOptions extends NodeSvgOptions {
  rasterize: NodeRasterizer;
  /** 相对页面尺寸的放大倍数，默认 2，与浏览器 `slideToPng` 的默认一致。 */
  scale?: number;
}

/** 在 Node 中渲染单页为原生 `<text>` 的 SVG 字符串。 */
export function renderSlideSvgInNode(pres: Presentation, slide: Slide, options: NodeSvgOptions): string {
  if (typeof options?.measureText !== 'function') {
    throw new NodeRenderError('node-measure-required',
      'Node 渲染需要显式注入 measureText（例如 @web-ppt/fonts/glyphs 的 withFontMeasurement 产物）；'
      + '不注入时没有可信字宽，渲染会静默退回估算断行，这里直接拒绝');
  }
  return renderSlideToSvg(pres, slide, {
    ...options,
    textMode: 'svg',
    measureText: options.measureText,
    // 'player' 依赖 foreignObject 与真实媒体元素，脱离浏览器无意义；导出语义下 badge 是唯一正确形态。
    media: 'badge',
  });
}

/** 在 Node 中渲染单页并交给宿主光栅化函数，返回 PNG 字节。 */
export async function renderSlidePngInNode(pres: Presentation, slide: Slide, options: NodePngOptions): Promise<Uint8Array> {
  if (typeof options?.measureText !== 'function') {
    throw new NodeRenderError('node-measure-required',
      'Node PNG 渲染需要显式注入 measureText；不注入时没有可信字宽，渲染会静默退回估算断行，这里直接拒绝');
  }
  if (typeof options?.rasterize !== 'function') {
    throw new NodeRenderError('node-rasterizer-required',
      'Node PNG 需要宿主注入 rasterize 光栅化函数（例如 resvg）；core 不内置任何光栅化依赖');
  }
  const svg = renderSlideSvgInNode(pres, slide, options);
  const bytes = await options.rasterize(svg, validateRasterSize(pres, options.scale ?? 2));
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new NodeRenderError('node-rasterizer-required',
      `rasterize 必须返回非空 PNG 字节（Uint8Array），收到 ${bytes === null || bytes === undefined ? String(bytes) : `长度 ${bytes.length}`}`);
  }
  return bytes;
}
