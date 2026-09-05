import { bytesToBase64, sha256 } from '../clipboard-binary';
import type { ClipboardResource, ImageResourcePatch } from './types';
import type { EditDoc, ElementInsertionResource } from '../types';
import { validateImageFormat } from './image-format';

export const MAX_REPLACE_IMAGE_BYTES = 5 * 1024 * 1024;

export function generatedImageResource(resource: ClipboardResource): ElementInsertionResource {
  return { ...resource, targetPart: `ppt/media/web-ppt-${resource.hash}.${resource.extension}`, created: true };
}

/** 已被文档保留的资源不能随另一个使用者撤销；新增资源与使用它的覆盖共同进退。 */
export function imageResourcePatches(
  doc: EditDoc, resources: readonly ElementInsertionResource[], origin: string,
): { forward: ImageResourcePatch[]; inverse: ImageResourcePatch[] } {
  const added = resources.filter((resource) => !doc.imageResources[resource.hash]);
  return {
    forward: added.map((resource) => ({ op: 'set', path: ['imageResources', resource.hash], value: resource, origin })),
    inverse: added.map((resource) => ({ op: 'del', path: ['imageResources', resource.hash], origin })),
  };
}

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
