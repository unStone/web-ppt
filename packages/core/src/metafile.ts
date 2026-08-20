/**
 * EMF / WMF 解码器的注入点。
 * 解码器体积较大且非必需，通过 hook 注入以保持解析器与其解耦，
 * 未注入时相关图片降级为占位框。
 */

export type MetafileDecoder = (bytes: Uint8Array, opts?: { width?: number; height?: number }) => string | null;

let decoder: MetafileDecoder | null = null;

export function setMetafileDecoder(fn: MetafileDecoder): void {
  decoder = fn;
}

export function hasMetafileDecoder(): boolean {
  return decoder !== null;
}

/** 图元文件字节流 → SVG 的 data URI；无解码器或解码失败返回 null */
export function metafileDataUrl(bytes: Uint8Array, opts?: { width?: number; height?: number }): string | null {
  if (!decoder) return null;
  let svg: string | null = null;
  try {
    svg = decoder(bytes, opts);
  } catch {
    return null;
  }
  if (!svg) return null;
  try {
    // 用 encodeURIComponent 而非 btoa，避免非 Latin-1 字符（中文字体名等）抛错
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    return null;
  }
}

export const METAFILE_EXT = new Set(['emf', 'wmf', 'pict', 'pct', 'pic']);
