export interface Mp4Box { type: string; start: number; data: number; end: number }

export const invalidMp4 = (): never => { throw new Error('视频不是完整的自包含 MP4 文件'); };
export const mp4Tag = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + 4));

export function mp4Uint(bytes: Uint8Array, box: Mp4Box, offset: number, size: 1 | 2 | 4 | 8 = 4): number {
  const at = box.data + offset;
  if (offset < 0 || at + size > box.end) invalidMp4();
  let value = 0;
  for (let i = at; i < at + size; i++) value = value * 256 + bytes[i];
  if (!Number.isSafeInteger(value)) invalidMp4();
  return value;
}

/** 未知 box 按声明长度跳过；不扫描载荷中的伪标签，也不把 64 位长度截断到 32 位。 */
export function mp4Boxes(bytes: Uint8Array, start = 0, end = bytes.length): Mp4Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: Mp4Box[] = [];
  while (start < end) {
    if (end - start < 8 || boxes.length >= 100000) invalidMp4();
    let size = view.getUint32(start), header = 8;
    if (size === 1) {
      if (end - start < 16) invalidMp4();
      size = view.getUint32(start + 8) * 2 ** 32 + view.getUint32(start + 12);
      header = 16;
    } else if (!size) size = end - start;
    if (!Number.isSafeInteger(size) || size < header || size > end - start) invalidMp4();
    boxes.push({ type: mp4Tag(bytes, start + 4), start, data: start + header, end: start + size });
    start += size;
  }
  return boxes;
}

export function mp4Box(boxes: readonly Mp4Box[], type: string): Mp4Box {
  const found = boxes.filter((box) => box.type === type);
  if (found.length !== 1) invalidMp4();
  return found[0];
}
