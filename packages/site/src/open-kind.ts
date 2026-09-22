/**
 * 打开前先认文件（预览与编辑器共用）。
 *
 * 解析器按魔数说话，报出来的是 Zip / CFB。人拖进来的却是 PDF / Word / 图片。
 * 必须在钩子扫描之前认完：prepareAdvancedRendering 对非 PK 会扫整份字节找 EMF+。
 */
import { unzipSync } from 'fflate';
import { OPEN_KIND, OpenKindError, type OpenKindMessage, type OpenKindResult } from './open-kind-error';

export { OPEN_KIND, OpenKindError, mapOpenError } from './open-kind-error';
export type { OpenKindMessage, OpenKindResult } from './open-kind-error';

export function rejectIfNotPresentation(input: ArrayBuffer | Uint8Array): void {
  const identified = identifyOpenBytes(input);
  if (identified.kind === 'reject') throw new OpenKindError(identified.message);
}

function bytesOf(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function reject(message: OpenKindMessage): OpenKindResult {
  return { kind: 'reject', message };
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  let offset = 0;
  if (hasPrefix(bytes, [0xef, 0xbb, 0xbf])) offset = 3;
  while (offset < bytes.length && (bytes[offset] === 0x20 || bytes[offset] === 0x09
    || bytes[offset] === 0x0a || bytes[offset] === 0x0d)) {
    offset += 1;
  }
  const head = new TextDecoder().decode(bytes.subarray(offset, offset + 32)).toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head');
}

function identifyZip(bytes: Uint8Array): OpenKindResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (entry) => (
        entry.name === '[Content_Types].xml'
        || entry.name === 'ppt/presentation.xml'
        || entry.name === 'mimetype'
      ) && entry.originalSize <= 4 * 1024 * 1024,
    });
  } catch {
    return reject(OPEN_KIND.zip);
  }
  if (files['ppt/presentation.xml']) return { kind: 'presentation' };
  const types = files['[Content_Types].xml']
    ? new TextDecoder().decode(files['[Content_Types].xml'])
    : '';
  const mime = files.mimetype ? new TextDecoder().decode(files.mimetype) : '';
  if (
    types.includes('vnd.openxmlformats-officedocument.presentationml')
    || types.includes('vnd.ms-powerpoint.presentation')
  ) {
    return { kind: 'presentation' };
  }
  if (types.includes('wordprocessingml') || types.includes('msword')) return reject(OPEN_KIND.word);
  if (types.includes('spreadsheetml') || types.includes('ms-excel')) return reject(OPEN_KIND.excel);
  if (mime.includes('opendocument.presentation') || types.includes('opendocument.presentation')) {
    return reject(OPEN_KIND.odp);
  }
  return reject(OPEN_KIND.zip);
}

/** 只根据字节判断。扩展名和 File.type 不参与——改后缀不能把 PDF 变成演示文稿。 */
export function identifyOpenBytes(input: ArrayBuffer | Uint8Array): OpenKindResult {
  const bytes = bytesOf(input);
  if (bytes.length === 0) return reject(OPEN_KIND.empty);
  if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46])) return reject(OPEN_KIND.pdf);
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47])) return reject(OPEN_KIND.image);
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return reject(OPEN_KIND.image);
  if (hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38])) return reject(OPEN_KIND.image);
  if (hasPrefix(bytes, [0x42, 0x4d]) && bytes.length > 14) return reject(OPEN_KIND.image);
  if (
    bytes.length >= 12
    && hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return reject(OPEN_KIND.image);
  }
  if (looksLikeHtml(bytes)) return reject(OPEN_KIND.html);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return identifyZip(bytes);
  // 加密 .pptx 与 .ppt / .doc 同是 CFB，这里不能拒。
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return { kind: 'presentation' };
  return reject(OPEN_KIND.unknown);
}
