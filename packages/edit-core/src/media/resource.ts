import { bytesToBase64, sha256 } from '../clipboard-binary';
import { copyImageBytes } from '../commands/image-resource';
import type { ClipboardResource } from '../commands/types';

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const ascii = (bytes: Uint8Array, offset: number, count: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + count));

/** 容器签名不足以证明可交付：RIFF 长度、PCM 格式及数据对齐也必须彼此一致。 */
function assertWav(bytes: Uint8Array): void {
  const invalid = (): never => { throw new Error('音频不是完整的 PCM WAV 文件'); };
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== bytes.length - 8) invalid();
  let frameSize = 0, samples = 0, offset = 12;
  while (offset + 8 <= bytes.length) {
    const tag = ascii(bytes, offset, 4), size = view.getUint32(offset + 4, true);
    const start = offset + 8, end = start + size;
    if (end > bytes.length) invalid();
    if (tag === 'fmt ') {
      if (frameSize || size < 16 || view.getUint16(start, true) !== 1) invalid();
      const channels = view.getUint16(start + 2, true), rate = view.getUint32(start + 4, true);
      const bits = view.getUint16(start + 14, true);
      frameSize = view.getUint16(start + 12, true);
      // 上传只接受可供常规播放器处理的范围，不把容器的 uint32 上限当作播放能力。
      if (channels < 1 || channels > 8 || !rate || rate > 192000 || ![8, 16, 24, 32].includes(bits)
        || frameSize !== channels * bits / 8 || view.getUint32(start + 8, true) !== rate * frameSize) invalid();
    }
    if (tag === 'data') {
      if (samples || !size) invalid();
      samples = size;
    }
    offset = end + size % 2;
  }
  if (offset !== bytes.length || !frameSize || !samples || samples % frameSize) invalid();
}

export function validateMediaResource(resource: Pick<ClipboardResource, 'mime' | 'extension'>, bytes: Uint8Array): boolean {
  if (resource.mime !== 'audio/wav' || resource.extension !== 'wav') return false;
  if (bytes.length > MAX_MEDIA_BYTES) throw new Error(`媒体不能超过 ${MAX_MEDIA_BYTES} 字节`);
  assertWav(bytes);
  return true;
}

export function createMediaResource(value: unknown, mime: unknown): ClipboardResource {
  const bytes = copyImageBytes(value, 'AddMedia.source.bytes', MAX_MEDIA_BYTES);
  const descriptor = { mime: typeof mime === 'string' ? mime : '', extension: 'wav' };
  if (!validateMediaResource(descriptor, bytes)) throw new Error('不支持的媒体 MIME');
  return { ...descriptor, bytes: bytesToBase64(bytes), hash: sha256(bytes) };
}
