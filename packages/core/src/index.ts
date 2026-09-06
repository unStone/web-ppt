import { parseChart } from './chart';
import { metafileToSvg } from './image';
import { readImageMetadata } from './image-metadata';
import { setChartParser } from './chart/hook';
import { setMetafileDecoder } from './metafile';
import { Cfb } from './ppt/cfb';
import { getDecryptor, setDecryptor, setPptDecryptor } from './crypto/hook';
import { decryptOoxml } from './crypto/ooxml';
import { decryptPptStream } from './crypto/ppt';
import { parsePpt } from './ppt/parser';
import { parsePptx } from './pptx/parser';
import {
  releasePptxLayoutReparseSession, reparsePptxLayoutTemplate, reparsePptxMasterTemplate,
  reparsePptxSlideWithLayout,
} from './pptx/layout-reparse';
import { renderElementToSvg, renderSlideToSvg } from './render/svg';
import { renderTextBodyToHtml } from './render/text-html';
import { fitTextShapeHeight } from './render/text-fit';
import { layoutText } from './render/text-layout';
import { isKnownPreset, resolveGeomPath } from './geometry/index';
import type { Presentation, Slide, SlideElement, TextBody } from './types';
import { tableStyleCellAppearance, tableStylePreview } from './table-style';

export * from './types';
export { transitionDefaultDirection, transitionPreferredDirection } from './transition';
export { tableStyleCellAppearance, tableStylePreview };
export * from './edit-metadata';
export * from './placeholder-match';
export * from './text-body-edit';
export { formatDrawingAutoNumber } from './text-auto-number';
export { fitTextShapeHeight, layoutText, renderElementToSvg, renderSlideToSvg, renderTextBodyToHtml };
export {
  releasePptxLayoutReparseSession, reparsePptxLayoutTemplate, reparsePptxMasterTemplate,
  reparsePptxSlideWithLayout,
};
export type { RenderElementOptions, RenderElementResult, RenderOptions } from './render/svg';
export type { RenderTextBodyHtmlOptions } from './render/text-html';
export type {
  TextLayout, TextLayoutCaret, TextLayoutLine, TextLayoutOptions, TextLayoutSegment, TextMeasure,
} from './render/text-layout';
export { isKnownPreset, resolveGeomPath };
export type {
  Adj, CustomGeometry, CustomGeometryCloseCommand, CustomGeometryCommand, CustomGeometryGuide, CustomGeometryPath,
  CustomGeometryPoint, CustomGeometryScalar, Geom, GeomSpec,
} from './geometry/index';
export { groupSteps, hiddenBefore, staticHidden } from './anim-steps';
export { presentationToPrintableHtml, slideToPng, slideToSvgFile } from './browser-export';
export type { PrintableOptions } from './browser-export';
export { setChartParser, setChartRenderer, setChartExParser, inheritPptxParsingContext } from './chart/hook';
export type { ChartEnv, ChartParser, ChartRenderer } from './chart/hook';

export { setMetafileDecoder, hasMetafileDecoder } from './metafile';
export { setFontDecoder, hasFontDecoder } from './font/eot';
export type { FontDecoder } from './font/eot';
export { collectFonts } from './font/collect';
export type { FontUsage } from './font/collect';
export { setDecryptor, setPptDecryptor, hasDecryptor } from './crypto/hook';
export type { Decryptor, PptDecryptor } from './crypto/hook';
export { WrongPasswordError, encryptionScheme } from './crypto/ooxml';
export { sha256 } from './crypto/primitives';
export { metafileToSvg, detectMetafile } from './image';
export { readImageMetadata };
export type { ImageMetadata } from './image-metadata';

// 接入图表渲染器与图元文件解码器（解析器通过 hook 解耦调用）
setChartParser(parseChart);
setMetafileDecoder(metafileToSvg);
setDecryptor(decryptOoxml);
setPptDecryptor(decryptPptStream);

export interface ParseOptions {
  /**
   * 惰性解析幻灯片（默认开启，仅对 .pptx 生效）。
   * 每页在首次访问时才解析，200 页文件首屏约快 11 倍。
   * 需要把整份演示文稿 `structuredClone` 或序列化时，设为 false 更省心。
   */
  lazy?: boolean;
  /** 为 OOXML 元素和幻灯片保留回写锚点、占位符身份等编辑元数据；默认关闭 */
  edit?: boolean;
  /** 保留原始 ZIP 字节与解压 part，并通过 `Presentation.package` 暴露；默认关闭 */
  keepPackage?: boolean;
  /** 打开密码。文件加密时必填，密码错误抛 {@link WrongPasswordError} */
  password?: string;
}

/**
 * 加密的 OOXML 是个 CFB 容器。EncryptedPackage 流的存在就是判据——
 * 只要有它就是加密文档，哪怕 EncryptionInfo 缺失（那是文件坏了，
 * 也不该被误诊成「这是个 .ppt」）。
 */
function encryptedStreams(bytes: Uint8Array): { info: Uint8Array | null; pkg: Uint8Array } | null {
  let cfb: Cfb;
  try {
    cfb = new Cfb(bytes);
  } catch {
    return null;
  }
  const pkg = cfb.stream('EncryptedPackage');
  return pkg ? { info: cfb.stream('EncryptionInfo'), pkg } : null;
}

/** 按魔数自动识别 .pptx（Zip）/ .ppt（CFB）并解析为统一 Schema */
export async function parse(
  input: File | Blob | ArrayBuffer | Uint8Array,
  opts: ParseOptions = {},
): Promise<Presentation> {
  let bytes: Uint8Array;
  if (input instanceof Uint8Array) bytes = input;
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else bytes = new Uint8Array(await input.arrayBuffer());

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return parsePptx(bytes, opts);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    // 设了打开密码的 .pptx 也是 CFB，魔数与 .ppt 无法区分，只能看流名
    const enc = encryptedStreams(bytes);
    if (enc) {
      if (!enc.info) throw new Error('该文件已加密，但 EncryptionInfo 流缺失，文件可能已损坏');
      const decrypt = getDecryptor();
      if (!decrypt) throw new Error('该文件已加密，但未注入解密器（setDecryptor）');
      if (opts.password === undefined) throw new Error('该文件已加密，请通过 parse(input, { password }) 提供打开密码');
      return parsePptx(decrypt(enc.info, enc.pkg, opts.password), opts);
    }
    return parsePpt(bytes, opts.password, opts.edit === true);
  }
  throw new Error('无法识别的文件格式：既不是 .pptx（Zip）也不是 .ppt（CFB）');
}

// ---------------- Worker 解析 ----------------

/** 把 Schema 里的 asset:N 令牌换成真实 blob URL */
function rehydrateAssets(pres: Presentation, urls: (string | null)[]): void {
  const map = (v: string | undefined | null): string | null | undefined => {
    if (typeof v !== 'string' || !v.startsWith('asset:')) return v;
    const i = Number(v.slice(6));
    return Number.isInteger(i) ? urls[i] ?? null : null;
  };

  const fixFill = (f: unknown): void => {
    const fill = f as { type?: string; src?: string } | null;
    if (fill && fill.type === 'image' && typeof fill.src === 'string') {
      fill.src = map(fill.src) ?? '';
    }
  };

  const walk = (els: SlideElement[]): void => {
    for (const el of els) {
      if (el.kind === 'image') {
        el.src = map(el.src) ?? '';
        if (el.media?.src) el.media.src = map(el.media.src) ?? null;
      } else if (el.kind === 'shape') {
        fixFill(el.fill);
        for (const p of el.text?.paragraphs ?? []) {
          if (p.bulletImage) p.bulletImage = map(p.bulletImage) ?? null;
        }
      } else if (el.kind === 'group') {
        walk(el.children);
      } else if (el.kind === 'table') {
        for (const row of el.rows) for (const cell of row.cells) fixFill(cell.fill);
      }
    }
  };

  for (const s of pres.slides) {
    fixFill(s.background);
    walk(s.elements);
  }
  for (const f of pres.embeddedFonts ?? []) f.src = map(f.src) ?? '';
}

let workerSeq = 0;

/**
 * 在 Worker 里解析 .pptx，主线程零阻塞。
 *
 * 调用方负责提供 Worker 实例（打包器各异，库不代为创建）：
 * ```ts
 * // 走 exports 里声明的 ./worker 子路径；深路径（dist/worker.js）会被 exports 挡掉
 * const worker = new Worker(new URL('@web-ppt/core/worker', import.meta.url), { type: 'module' });
 * const pres = await parseInWorker(worker, bytes);
 * ```
 * 返回的 `Presentation` 是纯数据，`dispose()` 由本函数补上以回收图片 URL。
 */
export function parseInWorker(worker: Worker, input: ArrayBuffer | Uint8Array): Promise<Presentation> {
  const bytes = input instanceof Uint8Array
    ? input.slice().buffer as ArrayBuffer
    : input;
  const id = ++workerSeq;

  return new Promise<Presentation>((resolve, reject) => {
    const onMessage = (e: MessageEvent<{ id: number; ok: boolean; presentation?: Presentation;
      assets?: { mime: string; data: ArrayBuffer }[]; error?: string }>): void => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', onMessage);
      if (!e.data.ok || !e.data.presentation) {
        reject(new Error(e.data.error ?? 'Worker 解析失败'));
        return;
      }
      const urls: (string | null)[] = [];
      for (const a of e.data.assets ?? []) {
        try {
          urls.push(URL.createObjectURL(new Blob([a.data], { type: a.mime })));
        } catch {
          urls.push(null);
        }
      }
      const pres = e.data.presentation;
      rehydrateAssets(pres, urls);
      pres.dispose = () => {
        for (const u of urls) if (u) URL.revokeObjectURL(u);
        urls.length = 0;
      };
      resolve(pres);
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ id, bytes }, [bytes]);
  });
}

// ---------------- 文本提取（搜索 / 无障碍） ----------------

function textOfBody(t: TextBody | null): string {
  if (!t) return '';
  return t.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
}

function collectText(els: SlideElement[], out: string[]): void {
  for (const el of els) {
    switch (el.kind) {
      case 'shape':
        out.push(textOfBody(el.text));
        break;
      case 'group':
        collectText(el.children, out);
        break;
      case 'table':
        for (const row of el.rows) for (const cell of row.cells) out.push(textOfBody(cell.text));
        break;
    }
  }
}

export function slideText(slide: Slide): string {
  const out: string[] = [];
  collectText(slide.elements, out);
  if (slide.notes) out.push(slide.notes);
  return out.filter(Boolean).join('\n');
}
