import { bytesToBase64, sha256 } from '../clipboard-binary';
import type { ClipboardResource } from './types';
import { validateImageFormat } from './image-format';

export const MAX_REPLACE_IMAGE_BYTES = 5 * 1024 * 1024;

export function copyImageBytes(value: unknown, label: string, maxBytes?: number): Uint8Array {
  if (!ArrayBuffer.isView(value) || Object.prototype.toString.call(value) !== '[object Uint8Array]') {
    throw new Error(`${label} 必须是 Uint8Array`);
  }
  const view = value as Uint8Array;
  if (!view.byteLength) throw new Error(`${label} 不能为空`);
  if (maxBytes !== undefined && view.byteLength > maxBytes) {
    throw new Error(`${label} 不能超过 ${maxBytes} 字节`);
  }
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

export function createImageResource(
  bytesInput: unknown,
  mime: unknown,
  label: string,
  maxBytes?: number,
): ClipboardResource {
  const bytes = copyImageBytes(bytesInput, `${label}.bytes`, maxBytes);
  const format = validateImageFormat(bytes, mime, label);
  return {
    hash: sha256(bytes), mime: mime as ClipboardResource['mime'],
    extension: format.extension, bytes: bytesToBase64(bytes),
  };
}
