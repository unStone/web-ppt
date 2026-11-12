import { canvasToPngBytes } from './canvas-png';
import { validateRasterSize } from './raster-size';
import { escapeXml } from './render/serialize';
import { groupSteps, hiddenBefore, staticHidden } from './anim-steps';
import { renderSlideToSvg } from './render/svg';
import { collectFonts } from './font/collect';
import type { FontUsage } from './font/collect';
import { sfntMime } from './font/eot';
import type { EmbeddedFont, ExportFontOptions, Presentation, Slide } from './types';

function browserApi(): void {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('图片导出只能在提供 DOM、Image 与 canvas 的浏览器环境中调用');
  }
}

function xmlUrl(value: string): string {
  return value.split('&amp;').join('&').split('&quot;').join('"').split('&apos;').join("'");
}

function cssUrl(value: string): string {
  return value.replace(/\\([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|\\([^\r\n])/gi,(_,hex: string | undefined,char: string) => {
    const code = hex === undefined ? 0 : Number.parseInt(hex,16);
    return hex === undefined ? char : String.fromCodePoint(code > 0 && code <= 0x10ffff ? code : 0xfffd);
  });
}

async function blobDataUri(blob: Blob): Promise<string> {
  if (typeof FileReader === 'undefined') throw new Error('当前浏览器缺少 FileReader，无法内联导出资源');
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取导出资源失败'));
    reader.readAsDataURL(blob);
  });
}

/** 字体字节 → Blob；slice 拷贝成独立 ArrayBuffer，避开 SharedArrayBuffer 泛型不被 BlobPart 接受的问题 */
function fontBlob(bytes: Uint8Array, mime: string): Blob {
  return new Blob([bytes.slice().buffer], { type: mime });
}

/* ── 导出字体子集化 ───────────────────────────── */

/** 一次导出任务的字体子集化上下文；打印整稿时跨页共享并集字符集与内联缓存 */
interface FontPipeline {
  readonly subsetter: NonNullable<ExportFontOptions['subsetter']>;
  /** 归一化家族名 → 用量 */
  readonly usages: Map<string, FontUsage>;
  /** 字体资源 URL → 脸信息；只登记 Presentation.embeddedFonts（追加脸集由宿主自备） */
  readonly faces: Map<string, EmbeddedFont>;
  readonly onFallback?: (family: string, reason: string) => void;
  /** URL → 内联任务（data URI，或原 URL 表示维持原样）；缓存 Promise，打印整稿并发页不会重复子集化 */
  readonly cache: Map<string, Promise<string>>;
}

const FONT_FACE_BLOCK = /@font-face\{[^}]*\}/g;
const FONT_FACE_SRC = /src:url\((?:'([^']+)'|"([^"]+)"|([^)\s]+))\)/;

function normalizeFamily(family: string): string {
  return family.trim().toLowerCase();
}

/** 子集化开启才建管线；未开启时导出与字节保持现状 */
function fontPipeline(
  pres: Presentation,
  slides: readonly Slide[],
  fonts: ExportFontOptions | undefined,
): FontPipeline | undefined {
  if (!fonts?.subsetter) return undefined;
  const usages = new Map<string, FontUsage>();
  for (const usage of collectFonts(slides)) usages.set(normalizeFamily(usage.family), usage);
  const faces = new Map<string, EmbeddedFont>();
  for (const face of pres.embeddedFonts ?? []) {
    if (!faces.has(face.src)) faces.set(face.src, face);
  }
  return { subsetter: fonts.subsetter, usages, faces, onFallback: fonts.onFontFallback, cache: new Map() };
}

/** 抓一份字体资源；失败时按 strict 语义抛错或维持原地址 */
async function fetchFontBytes(url: string, strict: boolean): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (strict) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`无法内联导出资源 ${url}：${detail}`);
    }
    return null;
  }
}

/**
 * 一条嵌入字体脸的内联决策：能子集化就子集化，失败回退整字体（不劣于现状）。
 *
 * 结果进任务级缓存：打印整稿里同一字体跨页只子集化一次，各页共用同一份 data URI。
 * 缓存的是 Promise 本身——整稿各页并发内联，只缓存已决值挡不住并发的重复未命中。
 */
function inlineFontFace(url: string, face: EmbeddedFont, usage: FontUsage, pipeline: FontPipeline, strict: boolean): Promise<string> {
  const pending = pipeline.cache.get(url);
  if (pending) return pending;
  const job = subsetOrInline(url, face, usage, pipeline, strict);
  pipeline.cache.set(url, job);
  return job;
}

async function subsetOrInline(url: string, face: EmbeddedFont, usage: FontUsage, pipeline: FontPipeline, strict: boolean): Promise<string> {
  const bytes = await fetchFontBytes(url, strict);
  if (!bytes) return url;
  let result: Awaited<ReturnType<FontPipeline['subsetter']['subset']>>;
  try {
    result = await pipeline.subsetter.subset({
      bytes,
      mime: sfntMime(bytes) ?? 'font/ttf',
      chars: usage.chars,
      family: face.family,
      bold: face.bold,
      italic: face.italic,
    });
  } catch {
    result = { ok: false, reason: 'subsetter-error' };
  }
  if (!result.ok) {
    pipeline.onFallback?.(face.family, result.reason);
    return blobDataUri(fontBlob(bytes, sfntMime(bytes) ?? 'font/ttf'));
  }
  return blobDataUri(fontBlob(result.bytes, result.mime));
}

/**
 * 子集化开启时的嵌入字体处理：导出范围没有用量的家族整脸剔除（现状是把全部
 * 嵌入字体都塞进单页产物），有用量的按字符集子集化。认识的 URL 处理完后，
 * 剩下的（宿主自备的 blob 来源切片等）留给旧路径照常整体内联。
 */
async function inlineEmbeddedFonts(svg: string, pipeline: FontPipeline, strict: boolean): Promise<string> {
  let output = svg;
  for (const match of svg.matchAll(FONT_FACE_BLOCK)) {
    const block = match[0];
    const src = block.match(FONT_FACE_SRC);
    if (!src) continue;
    const url = cssUrl(src[1] ?? src[2] ?? src[3]);
    if (!/^(?:blob:|https?:)/.test(url)) continue;
    const face = pipeline.faces.get(url);
    if (!face) continue;
    const usage = pipeline.usages.get(normalizeFamily(face.family));
    if (!usage) {
      pipeline.onFallback?.(face.family, 'unused-family');
      output = output.split(block).join('');
      continue;
    }
    let inlined: string;
    try {
      inlined = await inlineFontFace(url, face, usage, pipeline, strict);
    } catch (error) {
      // strict 的资源失败边界由 subsetOrInline 抛出；这里兜住其余异常，维持旧行为
      if (strict) throw error;
      inlined = url;
    }
    output = inlined === url ? output : output.split(url).join(inlined);
  }
  return output;
}

/** 把 SVG 中的会话与外链资源替换成 data URI，使其可被 <img> 独立加载。 */
async function inlineImages(svg: string, strict = false, pipeline?: FontPipeline): Promise<string> {
  const withFonts = pipeline ? await inlineEmbeddedFonts(svg, pipeline, strict) : svg;
  const encoded = new Map<string,string>();
  for (const match of withFonts.matchAll(/<image\b[^>]*\bhref="((?:blob:|https?:\/\/)[^"]+)"/g)) {
    encoded.set(match[1],xmlUrl(match[1]));
  }
  for (const match of withFonts.matchAll(/@font-face\{[^}]*\bsrc:url\((?:'((?:blob:|https?:\/\/)[^']+)'|"((?:blob:|https?:\/\/)[^"]+)"|((?:blob:|https?:\/\/)[^)\s]+))\)/g)) {
    const value = match[1] ?? match[2] ?? match[3];
    encoded.set(value,cssUrl(value));
  }
  if (!encoded.size) return withFonts;
  const loads = [...encoded].map(async ([value,url]) => {
    try {
      const resource = await fetch(url);
      if (!resource.ok) throw new Error(`HTTP ${resource.status}`);
      return [value, await blobDataUri(await resource.blob())] as const;
    } catch (error) {
      if (strict) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`无法内联导出资源 ${url}：${detail}`);
      }
      // 维持单页导出的旧行为：资源内联失败时仍让 SVG 加载器尝试原地址。
      return [value, value] as const;
    }
  });
  let pairs: readonly (readonly [string, string])[];
  if (strict) {
    // 同页资源属于一个失败边界；必须等全部读取收束，不能在拒绝后留下后台任务。
    const outcomes = await Promise.allSettled(loads);
    const failed = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    pairs = outcomes.map((outcome) => (outcome as PromiseFulfilledResult<readonly [string, string]>).value);
  } else {
    pairs = await Promise.all(loads);
  }
  let output = withFonts;
  for (const [value, data] of pairs) output = output.split(value).join(data);
  return output;
}

/**
 * 必须用 data URI：含 foreignObject 的 SVG 经 blob URL 加载仍会污染 Chrome 148 的画布。
 */
function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('SVG 渲染失败'));
    image.src = svgDataUri(svg);
  });
  return image;
}

export interface CommentExportOptions {
  /** 包含来源批注标记，默认 false；打印同时附上批注正文。 */
  showComments?: boolean;
}

export interface PngExportOptions extends CommentExportOptions {
  hiddenElements?: readonly number[];
  strictResources?: boolean;
  /** 导出字体处理：子集化引擎与追加脸集，缺省即现状 */
  fonts?: ExportFontOptions;
}

async function rasterize(
  pres: Presentation,
  slide: Slide,
  options: PngExportOptions & { scale: number },
  textMode: 'html' | 'svg',
  pipeline: FontPipeline | undefined,
): Promise<Blob> {
  browserApi();
  const size = validateRasterSize(pres, options.scale);
  const svg = await inlineImages(renderSlideToSvg(pres, slide, {
    textMode,
    hiddenElements: options.hiddenElements,
    showComments: options.showComments,
    fontFaces: options.fonts?.extraFontFaces,
  }), options.strictResources, pipeline);
  const image = await loadSvgImage(svg);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法获取 canvas 上下文');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Blob([canvasToPngBytes(canvas, '导出 PNG 失败')], { type: 'image/png' });
  } finally {
    // 归零会立即释放浏览器的像素后备存储；批量导出只需再约束同时在途的页数。
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** 供按需批量入口复用的唯一光栅化实现。 */
export async function slideToPngWithOptions(
  pres: Presentation,
  slide: Slide,
  options: PngExportOptions & { scale: number },
): Promise<Blob> {
  // 污染回退会再光栅化一次；同一次导出共享一份子集化结果
  const pipeline = fontPipeline(pres, [slide], options.fonts);
  try {
    return await rasterize(pres, slide, options, 'html', pipeline);
  } catch (error) {
    if ((error as { name?: string } | null)?.name !== 'SecurityError') throw error;
    return rasterize(pres, slide, options, 'svg', pipeline);
  }
}

/** 单页导出为 PNG Blob；优先复用浏览器 HTML 排版，污染画布时退回原生 SVG 文本。 */
export function slideToPng(pres: Presentation, slide: Slide, scale = 2, options: PngExportOptions = {}): Promise<Blob> {
  return slideToPngWithOptions(pres, slide, { ...options, scale });
}

/** 单页导出为不含 foreignObject、可交付给设计工具的自包含 SVG。 */
export async function slideToSvgFile(
  pres: Presentation,
  slide: Slide,
  hiddenElements?: readonly number[],
  options: CommentExportOptions & { fonts?: ExportFontOptions } = {},
): Promise<string> {
  return inlineSvgPage(pres, slide, options, hiddenElements, fontPipeline(pres, [slide], options.fonts));
}

/** 单页 SVG 的公共内联实现；打印整稿传入跨页共享的管线 */
function inlineSvgPage(
  pres: Presentation,
  slide: Slide,
  options: CommentExportOptions & { fonts?: ExportFontOptions },
  hiddenElements: readonly number[] | undefined,
  pipeline: FontPipeline | undefined,
): Promise<string> {
  return inlineImages(renderSlideToSvg(pres, slide, {
    textMode: 'svg',
    hiddenElements,
    showComments: options.showComments,
    fontFaces: options.fonts?.extraFontFaces,
  }), false, pipeline);
}

export interface PrintableOptions extends CommentExportOptions {
  /** 有动画的页按点击批次展开；默认每页只导出动画终态。 */
  animationSteps?: boolean;
  fonts?: ExportFontOptions;
}

/** 整份演示导出为可通过浏览器“打印为 PDF”的 HTML。 */
export async function presentationToPrintableHtml(
  pres: Presentation,
  options: PrintableOptions = {},
): Promise<string> {
  // 整稿一份并集字符集 + 一份跨页缓存：同一字体不逐页重复子集化与 base64
  const pipeline = fontPipeline(pres, pres.slides, options.fonts);
  const jobs: Promise<string>[] = [];
  for (const slide of pres.slides) {
    const groups = options.animationSteps ? groupSteps(slide.animations) : [];
    if (!groups.length) {
      jobs.push(inlineSvgPage(pres, slide, options, [...staticHidden(slide)], pipeline));
      continue;
    }
    for (let index = 0; index <= groups.length; index++) {
      jobs.push(inlineSvgPage(pres, slide, options, [...hiddenBefore(groups, index)], pipeline));
    }
  }
  const pages = await Promise.all(jobs);
  const { printDocument } = await import('./comment-export');
  return printDocument(pres, pages, options.showComments, escapeXml);
}
