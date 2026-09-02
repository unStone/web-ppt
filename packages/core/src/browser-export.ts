import { groupSteps, hiddenBefore, staticHidden } from './anim-steps';
import { renderSlideToSvg } from './render/svg';
import type { Presentation, Slide } from './types';

const MAX_CANVAS_EDGE = 32_767;

function browserApi(): void {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('图片导出只能在提供 DOM、Image 与 canvas 的浏览器环境中调用');
  }
}

export function validateRasterSize(
  pres: Presentation,
  scale: number,
): { width: number; height: number } {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('scale 必须是大于 0 的有限数');
  }
  const width = Math.round(pres.width * scale);
  const height = Math.round(pres.height * scale);
  if (width < 1 || height < 1 || width > MAX_CANVAS_EDGE || height > MAX_CANVAS_EDGE) {
    throw new RangeError(`scale 产生了浏览器 canvas 不支持的尺寸：${width}×${height}`);
  }
  return { width, height };
}

function xmlUrl(value: string): string {
  return value.split('&amp;').join('&').split('&quot;').join('"').split('&apos;').join("'");
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

/** 把 SVG 中的会话与外链资源替换成 data URI，使其可被 <img> 独立加载。 */
async function inlineImages(svg: string, strict = false): Promise<string> {
  const encoded = new Set<string>();
  for (const match of svg.matchAll(/<image\b[^>]*\bhref="((?:blob:|https?:\/\/)[^"]+)"/g)) {
    encoded.add(match[1]);
  }
  for (const match of svg.matchAll(/@font-face\{[^}]*\bsrc:url\(((?:blob:|https?:\/\/)[^)]+)\)/g)) {
    encoded.add(match[1]);
  }
  if (!encoded.size) return svg;
  const loads = [...encoded].map(async (value) => {
    try {
      const resource = await fetch(xmlUrl(value));
      if (!resource.ok) throw new Error(`HTTP ${resource.status}`);
      return [value, await blobDataUri(await resource.blob())] as const;
    } catch (error) {
      if (strict) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`无法内联导出资源 ${xmlUrl(value)}：${detail}`);
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
  let output = svg;
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

interface RasterOptions {
  scale: number;
  hiddenElements?: readonly number[];
  strictResources?: boolean;
}

async function rasterize(
  pres: Presentation,
  slide: Slide,
  options: RasterOptions,
  textMode: 'html' | 'svg',
): Promise<Blob> {
  browserApi();
  const size = validateRasterSize(pres, options.scale);
  const svg = await inlineImages(renderSlideToSvg(pres, slide, {
    textMode,
    hiddenElements: options.hiddenElements,
  }), options.strictResources);
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
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('导出 PNG 失败'))), 'image/png');
    });
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
  options: RasterOptions,
): Promise<Blob> {
  try {
    return await rasterize(pres, slide, options, 'html');
  } catch (error) {
    if ((error as { name?: string } | null)?.name !== 'SecurityError') throw error;
    return rasterize(pres, slide, options, 'svg');
  }
}

/** 单页导出为 PNG Blob；优先复用浏览器 HTML 排版，污染画布时退回原生 SVG 文本。 */
export function slideToPng(pres: Presentation, slide: Slide, scale = 2): Promise<Blob> {
  return slideToPngWithOptions(pres, slide, { scale });
}

/** 单页导出为不含 foreignObject、可交付给设计工具的自包含 SVG。 */
export async function slideToSvgFile(
  pres: Presentation,
  slide: Slide,
  hiddenElements?: readonly number[],
): Promise<string> {
  return inlineImages(renderSlideToSvg(pres, slide, { textMode: 'svg', hiddenElements }));
}

export interface PrintableOptions {
  /** 有动画的页按点击批次展开；默认每页只导出动画终态。 */
  animationSteps?: boolean;
}

/** 整份演示导出为可通过浏览器“打印为 PDF”的 HTML。 */
export async function presentationToPrintableHtml(
  pres: Presentation,
  options: PrintableOptions = {},
): Promise<string> {
  const jobs: Promise<string>[] = [];
  for (const slide of pres.slides) {
    const groups = options.animationSteps ? groupSteps(slide.animations) : [];
    if (!groups.length) {
      jobs.push(slideToSvgFile(pres, slide, [...staticHidden(slide)]));
      continue;
    }
    for (let index = 0; index <= groups.length; index++) {
      jobs.push(slideToSvgFile(pres, slide, [...hiddenBefore(groups, index)]));
    }
  }
  const pages = await Promise.all(jobs);
  return '<!doctype html><html><head><meta charset="utf-8"><title>slides</title><style>'
    + `@page{size:${Math.round(pres.width)}px ${Math.round(pres.height)}px;margin:0}`
    + 'html,body{margin:0;padding:0}'
    + '.pg{page-break-after:always;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center}'
    + '.pg svg{width:100%;height:100%}'
    + '</style></head><body>'
    + pages.map((page) => `<div class="pg">${page}</div>`).join('')
    + '</body></html>';
}
