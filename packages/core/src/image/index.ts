/**
 * EMF / WMF 矢量图元文件 → SVG（纯浏览器，无原生依赖）。
 *
 * PPT 里的剪贴画、OLE 预览、老版本图表大量以 EMF/WMF 存储，
 * 浏览器无法原生解码，这里把它们转成可直接内联或做 data URI 的 SVG。
 */

import { emfToSvg, isEmf } from './emf';
import type { MetafileOptions } from './emf';
import { isWmf, wmfToSvg } from './wmf';
import { isPict, pictToSvg } from './pict';

export type { MetafileOptions };
export { emfToSvg, wmfToSvg, pictToSvg, isEmf, isWmf, isPict };

/** 按魔数识别图元文件类型 */
export function detectMetafile(bytes: Uint8Array): 'emf' | 'wmf' | 'pict' | null {
  if (!bytes || bytes.length < 20) return null;
  if (isEmf(bytes)) return 'emf';
  if (isWmf(bytes)) return 'wmf';
  // PICT 放最后：它没有真正的魔数，靠 picFrame 合理性 + 版本号识别，
  // 先让有确定魔数的两种认领，避免误判
  if (isPict(bytes)) return 'pict';
  return null;
}

/** 把 EMF/WMF 字节流转成独立可用的 SVG 字符串；无法解码时返回 null */
export function metafileToSvg(bytes: Uint8Array, opts?: MetafileOptions): string | null {
  try {
    const kind = detectMetafile(bytes);
    if (kind === 'emf') return emfToSvg(bytes, opts);
    if (kind === 'wmf') return wmfToSvg(bytes, opts);
    if (kind === 'pict') return pictToSvg(bytes, opts);
    return null;
  } catch {
    return null;
  }
}

/** SVG 字符串 → data URI，可直接塞进 <img src> / CSS url() */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 一步到位：图元文件字节 → data URI；失败返回 null */
export function metafileToDataUri(bytes: Uint8Array, opts?: MetafileOptions): string | null {
  const svg = metafileToSvg(bytes, opts);
  return svg ? svgToDataUri(svg) : null;
}
