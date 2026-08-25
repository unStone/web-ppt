export interface ImageMetadata {
  /** 编码像素尺寸；矢量/图元文件使用其原生坐标范围。 */
  readonly width: number;
  readonly height: number;
  /** 缺少可靠物理分辨率时回退到 CSS 的 96 DPI。 */
  readonly dpiX: number;
  readonly dpiY: number;
}

const ascii = (bytes: Uint8Array, offset: number, value: string): boolean =>
  [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
const u16be = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] * 0x100 + bytes[offset + 1];
const u16le = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] + bytes[offset + 1] * 0x100;
const u24le = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000;
const u32be = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000
  + bytes[offset + 2] * 0x100 + bytes[offset + 3];
const u32le = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000
    + bytes[offset + 3] * 0x1000000) >>> 0;
const i16be = (bytes: Uint8Array, offset: number): number => {
  const value = u16be(bytes, offset);
  return value > 0x7fff ? value - 0x10000 : value;
};
const i16le = (bytes: Uint8Array, offset: number): number => {
  const value = u16le(bytes, offset);
  return value > 0x7fff ? value - 0x10000 : value;
};
const i32le = (bytes: Uint8Array, offset: number): number => u32le(bytes, offset) | 0;
const sane = (width: number, height: number, dpiX = 96, dpiY = 96): ImageMetadata | null =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height, dpiX: dpiX > 0 ? dpiX : 96, dpiY: dpiY > 0 ? dpiY : 96 }
    : null;

function pngMetadata(bytes: Uint8Array): ImageMetadata | null {
  if (bytes.length < 24 || !ascii(bytes, 1, 'PNG')) return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  let dpiX = 96;
  let dpiY = 96;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = u32be(bytes, offset);
    if (length > bytes.length - offset - 12) break;
    if (ascii(bytes, offset + 4, 'pHYs') && length === 9 && bytes[offset + 16] === 1) {
      dpiX = u32be(bytes, offset + 8) * 0.0254;
      dpiY = u32be(bytes, offset + 12) * 0.0254;
    }
    offset += length + 12;
  }
  return sane(width, height, dpiX, dpiY);
}

const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function exifDpi(bytes: Uint8Array, data: number, end: number): readonly [number, number] | null {
  if (data + 14 > end || !ascii(bytes, data, 'Exif\0\0')) return null;
  const base = data + 6;
  const little = ascii(bytes, base, 'II');
  if (!little && !ascii(bytes, base, 'MM')) return null;
  const inside = (offset: number, length: number): boolean => offset >= base && offset + length <= end;
  const read16 = (offset: number): number => little ? u16le(bytes, offset) : u16be(bytes, offset);
  const read32 = (offset: number): number => little ? u32le(bytes, offset) : u32be(bytes, offset);
  if (!inside(base, 8) || read16(base + 2) !== 42) return null;
  const ifd = base + read32(base + 4);
  if (!inside(ifd, 2)) return null;
  let x = 0;
  let y = 0;
  let unit = 2;
  const count = read16(ifd);
  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12;
    if (!inside(entry, 12)) break;
    const tag = read16(entry);
    const type = read16(entry + 2);
    const length = read32(entry + 4);
    let value = 0;
    if (length === 1 && type === 3) value = read16(entry + 8);
    else if (length === 1 && type === 5) {
      const rational = base + read32(entry + 8);
      if (inside(rational, 8)) value = read32(rational) / Math.max(read32(rational + 4), 1);
    }
    if (tag === 0x011a) x = value;
    else if (tag === 0x011b) y = value;
    else if (tag === 0x0128 && value) unit = value;
  }
  const factor = unit === 3 ? 2.54 : unit === 2 ? 1 : 0;
  return x > 0 && factor ? [x * factor, (y || x) * factor] : null;
}

function jpegMetadata(bytes: Uint8Array): ImageMetadata | null {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let width = 0;
  let height = 0;
  let jfifDensity: readonly [number, number] | null = null;
  let exifDensity: readonly [number, number] | null = null;
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset++] !== 0xff) continue;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) break;
    const data = offset + 2;
    if (marker === 0xe0 && length >= 14 && ascii(bytes, data, 'JFIF\0')) {
      const units = bytes[data + 7];
      const factor = units === 1 ? 1 : units === 2 ? 2.54 : 0;
      if (factor) {
        jfifDensity = [u16be(bytes, data + 8) * factor, u16be(bytes, data + 10) * factor];
      }
    } else if (marker === 0xe1 && length >= 16) {
      exifDensity ??= exifDpi(bytes, data, offset + length);
    } else if (JPEG_SOF.has(marker) && length >= 7) {
      height = u16be(bytes, data + 1);
      width = u16be(bytes, data + 3);
    }
    offset += length;
  }
  const density = jfifDensity ?? exifDensity ?? [96, 96];
  return sane(width, height, density[0], density[1]);
}

function gifMetadata(bytes: Uint8Array): ImageMetadata | null {
  if (bytes.length < 10 || (!ascii(bytes, 0, 'GIF87a') && !ascii(bytes, 0, 'GIF89a'))) return null;
  return sane(u16le(bytes, 6), u16le(bytes, 8));
}

function bmpMetadata(bytes: Uint8Array): ImageMetadata | null {
  if (bytes.length < 26 || !ascii(bytes, 0, 'BM')) return null;
  const dib = u32le(bytes, 14);
  if (dib === 12) return sane(u16le(bytes, 18), u16le(bytes, 20));
  if (dib < 40 || bytes.length < 46) return null;
  const width = Math.abs(i32le(bytes, 18));
  const height = Math.abs(i32le(bytes, 22));
  const dpiX = i32le(bytes, 38) * 0.0254;
  const dpiY = i32le(bytes, 42) * 0.0254;
  return sane(width, height, dpiX, dpiY);
}

function webpMetadata(bytes: Uint8Array): ImageMetadata | null {
  if (bytes.length < 30 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) return null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = u32le(bytes, offset + 4);
    const data = offset + 8;
    if (length > bytes.length - data) break;
    if (ascii(bytes, offset, 'VP8X') && length >= 10) {
      return sane(u24le(bytes, data + 4) + 1, u24le(bytes, data + 7) + 1);
    }
    if (ascii(bytes, offset, 'VP8L') && length >= 5 && bytes[data] === 0x2f) {
      const packed = u32le(bytes, data + 1);
      return sane((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
    }
    if (ascii(bytes, offset, 'VP8 ') && length >= 10 && ascii(bytes, data + 3, '\u009d\u0001*')) {
      return sane(u16le(bytes, data + 6) & 0x3fff, u16le(bytes, data + 8) & 0x3fff);
    }
    offset = data + length + (length & 1);
  }
  return null;
}

function tiffMetadata(bytes: Uint8Array): ImageMetadata | null {
  if (bytes.length < 16) return null;
  const little = ascii(bytes, 0, 'II');
  if (!little && !ascii(bytes, 0, 'MM')) return null;
  const u16 = (offset: number): number => little ? u16le(bytes, offset) : u16be(bytes, offset);
  const u32 = (offset: number): number => little ? u32le(bytes, offset) : u32be(bytes, offset);
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > bytes.length) return null;
  const count = u16(ifd);
  const values = new Map<number, number>();
  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > bytes.length) break;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const length = u32(entry + 4);
    let value = 0;
    if (length === 1 && type === 3) value = u16(entry + 8);
    else if (length === 1 && type === 4) value = u32(entry + 8);
    else if (length === 1 && type === 5) {
      const at = u32(entry + 8);
      if (at + 8 <= bytes.length) value = u32(at) / Math.max(u32(at + 4), 1);
    }
    if (value) values.set(tag, value);
  }
  const unit = values.get(296) ?? 2;
  const factor = unit === 3 ? 2.54 : unit === 2 ? 1 : 0;
  return sane(values.get(256) ?? 0, values.get(257) ?? 0,
    factor ? (values.get(282) ?? 96) * factor : 96,
    factor ? (values.get(283) ?? values.get(282) ?? 96) * factor : 96);
}

function svgMetadata(bytes: Uint8Array): ImageMetadata | null {
  const source = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const tag = source.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;
  const dimension = (name: string): number | null => {
    const raw = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
    const match = raw?.trim().match(/^([0-9]+(?:\.[0-9]+)?)(px|in|cm|mm|pt|pc)?$/i);
    if (!match) return null;
    const factor: Record<string, number> = {
      px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16,
    };
    return Number(match[1]) * factor[(match[2] ?? 'px').toLowerCase()];
  };
  let width = dimension('width');
  let height = dimension('height');
  const viewBox = tag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
    .trim().split(/[ ,]+/).map(Number);
  if ((!width || !height) && viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    width ||= Math.abs(viewBox[2]);
    height ||= Math.abs(viewBox[3]);
  }
  return sane(width ?? 0, height ?? 0);
}

function metafileMetadata(bytes: Uint8Array): ImageMetadata | null {
  if (bytes.length >= 44 && u32le(bytes, 0) === 1 && u32le(bytes, 40) === 0x464d4520) {
    const pixelWidth = Math.abs(i32le(bytes, 16) - i32le(bytes, 8));
    const pixelHeight = Math.abs(i32le(bytes, 20) - i32le(bytes, 12));
    const frameWidth = Math.abs(i32le(bytes, 32) - i32le(bytes, 24));
    const frameHeight = Math.abs(i32le(bytes, 36) - i32le(bytes, 28));
    return sane(pixelWidth || frameWidth * 96 / 2540, pixelHeight || frameHeight * 96 / 2540,
      frameWidth ? pixelWidth * 2540 / frameWidth : 96,
      frameHeight ? pixelHeight * 2540 / frameHeight : 96);
  }
  if (bytes.length >= 22 && u32le(bytes, 0) === 0x9ac6cdd7) {
    return sane(Math.abs(i16le(bytes, 10) - i16le(bytes, 6)),
      Math.abs(i16le(bytes, 12) - i16le(bytes, 8)), u16le(bytes, 14), u16le(bytes, 14));
  }
  for (const base of [512, 0]) {
    if (base + 14 > bytes.length) continue;
    const top = i16be(bytes, base + 2);
    const left = i16be(bytes, base + 4);
    const bottom = i16be(bytes, base + 6);
    const right = i16be(bytes, base + 8);
    if (right > left && bottom > top) return sane(right - left, bottom - top, 72, 72);
  }
  return null;
}

/** 魔数优先；调用者的扩展名和 MIME 只用于存储，不参与几何真值。 */
export function readImageMetadata(bytes: Uint8Array): ImageMetadata | null {
  return pngMetadata(bytes) ?? jpegMetadata(bytes) ?? gifMetadata(bytes) ?? bmpMetadata(bytes)
    ?? webpMetadata(bytes) ?? tiffMetadata(bytes) ?? svgMetadata(bytes) ?? metafileMetadata(bytes);
}
