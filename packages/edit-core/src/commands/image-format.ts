export type SupportedImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const bytesEqual = (bytes: Uint8Array, offset: number, expected: readonly number[]): boolean =>
  expected.every((value, index) => bytes[offset + index] === value);

const asciiAt = (bytes: Uint8Array, offset: number, text: string): boolean =>
  [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));

const u16be = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] * 0x100 + bytes[offset + 1];

const u16le = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] + bytes[offset + 1] * 0x100;

const u32be = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000
  + bytes[offset + 2] * 0x100 + bytes[offset + 3];

const u32le = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000
  + bytes[offset + 3] * 0x1000000;

function validPng(bytes: Uint8Array): boolean {
  if (bytes.length < 45
    || !bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return false;
  let offset = 8;
  let first = true;
  let hasImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = u32be(bytes, offset);
    if (length > bytes.length - offset - 12) return false;
    if (first && (length !== 13 || !asciiAt(bytes, offset + 4, 'IHDR')
      || u32be(bytes, offset + 8) === 0 || u32be(bytes, offset + 12) === 0)) return false;
    const next = offset + length + 12;
    if (asciiAt(bytes, offset + 4, 'IDAT')) hasImageData ||= length > 0;
    if (asciiAt(bytes, offset + 4, 'IEND')) {
      return hasImageData && length === 0 && next === bytes.length;
    }
    offset = next;
    first = false;
  }
  return false;
}

function skipGifBlocks(bytes: Uint8Array, from: number): number {
  let offset = from;
  while (offset < bytes.length) {
    const length = bytes[offset++];
    if (length === 0) return offset;
    if (length > bytes.length - offset) return -1;
    offset += length;
  }
  return -1;
}

function validGif(bytes: Uint8Array): boolean {
  if (bytes.length < 14 || (!asciiAt(bytes, 0, 'GIF87a') && !asciiAt(bytes, 0, 'GIF89a'))
    || u16le(bytes, 6) === 0 || u16le(bytes, 8) === 0) return false;
  const packed = bytes[10];
  let offset = 13 + ((packed & 0x80) ? 3 * (2 ** ((packed & 0x07) + 1)) : 0);
  let hasFrame = false;
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) return hasFrame && offset === bytes.length;
    if (marker === 0x21) {
      if (offset >= bytes.length) return false;
      offset = skipGifBlocks(bytes, offset + 1);
    } else if (marker === 0x2c) {
      hasFrame = true;
      if (offset + 9 > bytes.length) return false;
      const imagePacked = bytes[offset + 8];
      offset += 9 + ((imagePacked & 0x80) ? 3 * (2 ** ((imagePacked & 0x07) + 1)) : 0);
      if (offset >= bytes.length) return false;
      offset = skipGifBlocks(bytes, offset + 1);
    } else return false;
    if (offset < 0) return false;
  }
  return false;
}

const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function validJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || !bytesEqual(bytes, 0, [0xff, 0xd8])
    || !bytesEqual(bytes, bytes.length - 2, [0xff, 0xd9])) return false;
  let offset = 2;
  let dimensions = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) continue;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      if (offset + 2 > bytes.length) return false;
      const length = u16be(bytes, offset);
      return dimensions && length >= 6 && offset + length < bytes.length - 2;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (JPEG_SOF.has(marker)) {
      if (length < 7 || u16be(bytes, offset + 3) === 0 || u16be(bytes, offset + 5) === 0) return false;
      dimensions = true;
    }
    offset += length;
  }
  return dimensions;
}

function validWebpPixels(bytes: Uint8Array, typeOffset: number, dataOffset: number, length: number): boolean {
  if (asciiAt(bytes, typeOffset, 'VP8L')) {
    if (length < 5 || bytes[dataOffset] !== 0x2f) return false;
    const dimensions = u32le(bytes, dataOffset + 1) >>> 0;
    return (dimensions >>> 29) === 0;
  }
  return asciiAt(bytes, typeOffset, 'VP8 ') && length >= 10
    && bytesEqual(bytes, dataOffset + 3, [0x9d, 0x01, 0x2a])
    && (u16le(bytes, dataOffset + 6) & 0x3fff) > 0
    && (u16le(bytes, dataOffset + 8) & 0x3fff) > 0;
}

function validWebpFrame(bytes: Uint8Array, from: number, to: number): boolean {
  let offset = from;
  while (offset + 8 <= to) {
    const length = u32le(bytes, offset + 4);
    const next = offset + 8 + length + (length & 1);
    if (next > to) return false;
    if (validWebpPixels(bytes, offset, offset + 8, length)) return true;
    offset = next;
  }
  return false;
}

function validWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 26 || !asciiAt(bytes, 0, 'RIFF') || !asciiAt(bytes, 8, 'WEBP')
    || u32le(bytes, 4) + 8 !== bytes.length) return false;
  let offset = 12;
  let hasPixels = false;
  while (offset + 8 <= bytes.length) {
    const chunkLength = u32le(bytes, offset + 4);
    const dataOffset = offset + 8;
    const next = dataOffset + chunkLength + (chunkLength & 1);
    if (next > bytes.length) return false;
    if (asciiAt(bytes, offset, 'VP8X') && (offset !== 12 || chunkLength !== 10)) return false;
    hasPixels ||= validWebpPixels(bytes, offset, dataOffset, chunkLength);
    if (asciiAt(bytes, offset, 'ANMF')) {
      hasPixels ||= chunkLength >= 16
        && validWebpFrame(bytes, dataOffset + 16, dataOffset + chunkLength);
    }
    offset = next;
  }
  return offset === bytes.length && hasPixels;
}

const FORMATS: Readonly<Record<SupportedImageMime, {
  readonly extension: string;
  readonly validate: (bytes: Uint8Array) => boolean;
}>> = {
  'image/png': { extension: 'png', validate: validPng },
  'image/jpeg': { extension: 'jpg', validate: validJpeg },
  'image/gif': { extension: 'gif', validate: validGif },
  'image/webp': { extension: 'webp', validate: validWebp },
};

export function detectImageMime(bytes: Uint8Array): SupportedImageMime | null {
  for (const [mime, format] of Object.entries(FORMATS) as [SupportedImageMime, typeof FORMATS[SupportedImageMime]][]) {
    if (format.validate(bytes)) return mime;
  }
  return null;
}

export function validateImageFormat(bytes: Uint8Array, mime: unknown): { extension: string } {
  if (typeof mime !== 'string' || !Object.prototype.hasOwnProperty.call(FORMATS, mime)) {
    throw new Error(`AddImage.mime 不支持：${String(mime)}`);
  }
  const format = FORMATS[mime as SupportedImageMime];
  if (detectImageMime(bytes) !== mime) {
    throw new Error(`AddImage.bytes 与声明格式 ${mime} 不一致或容器不完整`);
  }
  return { extension: format.extension };
}
