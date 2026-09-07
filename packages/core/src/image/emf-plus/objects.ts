import { base64, encodePng } from '../gdi';
import type { Mat } from '../gdi';
import { Bytes, color } from './binary';
import type { Box } from './binary';
import { pathData } from './geometry';

export type Paint = { kind: 'solid'; color: string } | {
  kind: 'gradient'; box: Box; stops: { offset: number; color: string }[]; matrix?: Mat; wrap: number; gamma: boolean;
} | { kind: 'hatch'; style: number; color: string; background: string };
export interface Pen {
  paint: Paint; unit: number; width: number; start: number; end: number; join: number; miter: number; dash: number[]; offset: number;
}
export interface Font { name: string; size: number; unit: number; style: number }
export interface Format { flags: number; align: number; lineAlign: number }
export interface Bitmap { width: number; height: number; href: string }
export interface ObjectTypes { 1: Paint; 2: Pen; 3: string; 5: Bitmap; 6: Font; 7: Format }

function brush(r: Bytes): Paint {
  r.u32(); const type = r.u32();
  if (type === 0) return { kind: 'solid', color: color(r.u32()) };
  if (type === 1) {
    const style = r.u32(); if (style > 5) throw new Error('EMF+ 暂不支持该网纹');
    return { kind: 'hatch', style, color: color(r.u32()), background: color(r.u32()) };
  }
  if (type !== 4) throw new Error('EMF+ 暂不支持该画刷');
  const flags = r.u32(), wrap = r.u32(), box = r.rect(), start = r.u32(), end = r.u32(); r.take(8);
  if (flags & ~0x9e || flags & 0x10) throw new Error('EMF+ 暂不支持双向渐变');
  const matrix = flags & 2 ? r.matrix() : undefined;
  let stops = [{ offset: 0, color: color(start) }, { offset: 1, color: color(end) }];
  if (flags & 4 || flags & 8) {
    const count = r.count(4096), positions = Array.from({ length: count }, () => r.f32());
    stops = positions.map((offset) => {
      if (offset < 0 || offset > 1) throw new Error('EMF+ 非法渐变位置');
      if (flags & 4) return { offset, color: color(r.u32()) };
      const f = Math.max(0, Math.min(1, r.f32())); let mixed = 0;
      for (let shift = 0; shift <= 24; shift += 8) mixed += Math.round(((start >>> shift) & 255) * (1 - f) + ((end >>> shift) & 255) * f) * 2 ** shift;
      return { offset, color: color(mixed) };
    });
  }
  return { kind: 'gradient', box, stops, matrix, wrap, gamma: !!(flags & 128) };
}

function pen(r: Bytes): Pen {
  r.u32(); if (r.u32()) throw new Error('EMF+ 非法画笔类型');
  const flags = r.u32(), unit = r.u32(), width = r.f32();
  // 非中心笔、复合笔、任意帽及非单位笔矩阵需要描边轮廓，不能按普通 stroke 静默近似。
  if (flags & ~0x1fe) throw new Error('EMF+ 暂不支持该画笔轮廓');
  const start = flags & 2 ? r.u32() : 0, end = flags & 4 ? r.u32() : 0;
  const join = flags & 8 ? r.u32() : 0, miter = flags & 16 ? r.f32() : 10, style = flags & 32 ? r.u32() : 0;
  const dashCap = flags & 64 ? r.u32() : 0, offset = flags & 128 ? r.f32() : 0;
  const dash = flags & 256 ? Array.from({ length: r.count(4096) }, () => r.f32()) : [[], [3, 1], [1, 1], [3, 1, 1, 1], [3, 1, 1, 1, 1, 1]][style];
  if (!dash || dash.some(v => v < 0) || width < 0 || start > 2 || end > 2 || dashCap > 2 || join > 3) throw new Error('EMF+ 非法描边参数');
  return { paint: brush(r), unit, width, start, end, join, miter, dash, offset };
}

function bitmap(r: Bytes): Bitmap {
  r.u32(); if (r.u32() !== 1) throw new Error('EMF+ 嵌套图元暂不支持');
  const width = r.i32(), height = r.i32(), stride = r.i32(), format = r.u32(), type = r.u32();
  if (type === 1) {
    const b = r.take(r.left);
    const mime = b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 ? 'png' : b[0] === 255 && b[1] === 216 ? 'jpeg' : b[0] === 71 && b[1] === 73 && b[2] === 70 ? 'gif' : '';
    if (!mime) throw new Error('EMF+ 未识别压缩图片');
    // 压缩图的宽高可以为零；SVG-as-image 自行读取图片固有尺寸。
    return { width, height, href: `data:image/${mime};base64,${base64(b)}` };
  }
  const bpp = (format >>> 8) & 255;
  if (type !== 0 || width <= 0 || height <= 0 || width * height > 16000000 || ![24, 32].includes(bpp)
    || Math.abs(stride) < width * bpp / 8) throw new Error('EMF+ 非法位图');
  const source = r.take(Math.abs(stride) * height), rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const s = (stride < 0 ? height - 1 - y : y) * Math.abs(stride) + x * bpp / 8, d = (y * width + x) * 4;
    const alpha = bpp === 32 && format & 0x40000 ? source[s + 3] : 255;
    const unpremultiply = format & 0x80000 ? (alpha ? 255 / alpha : 0) : 1;
    for (let c = 0; c < 3; c++) rgba[d + c] = Math.min(255, Math.round(source[s + 2 - c] * unpremultiply));
    rgba[d + 3] = alpha;
  }
  return { width, height, href: `data:image/png;base64,${base64(encodePng(rgba, width, height))}` };
}

export class ObjectTable {
  private raw = new Map<number, { type: number; bytes: Uint8Array; value?: unknown }>();
  private partial = new Map<number, { type: number; size: number; at: number; bytes: Uint8Array }>();
  set(flags: number, data: Uint8Array): void {
    const id = flags & 255, type = (flags >>> 8) & 127;
    if (id > 63 || data.length > 32 * 1024 * 1024) throw new Error('EMF+ 对象超限');
    let part = this.partial.get(id);
    if (flags & 0x8000 || part) {
      const r = new Bytes(data), size = r.count(32 * 1024 * 1024);
      part ??= { type, size, at: 0, bytes: new Uint8Array(size) };
      if (type !== part.type || size !== part.size || part.at + r.left > size) throw new Error('EMF+ 继续对象不一致');
      const bytes = r.take(r.left); part.bytes.set(bytes, part.at); part.at += bytes.length;
      if (flags & 0x8000) { this.partial.set(id, part); return; }
      if (part.at !== size) throw new Error('EMF+ 对象不完整');
      this.partial.delete(id); data = part.bytes;
    }
    this.raw.set(id, { type, bytes: data });
  }
  get<K extends keyof ObjectTypes>(id: number, type: K): ObjectTypes[K] {
    const obj = this.raw.get(id);
    if (!obj || obj.type !== type || this.partial.has(id)) throw new Error('EMF+ 对象引用失效');
    if (obj.value === undefined) obj.value = decode(type, new Bytes(obj.bytes));
    return obj.value as ObjectTypes[K];
  }
  finish(): void { if (this.partial.size) throw new Error('EMF+ 对象缺少尾段'); }
}

function decode(type: keyof ObjectTypes, r: Bytes): unknown {
  if (type === 1) return brush(r);
  if (type === 2) return pen(r);
  if (type === 5) return bitmap(r);
  r.u32();
  if (type === 3) {
    const count = r.count(), flags = r.u32(), points = r.points(count, flags);
    const types: number[] = [];
    while (types.length < count) {
      const value = r.u8();
      if (flags & 0x800 && value & 0x40) {
        const run = value & 63, type = r.u8();
        if (!run || run + types.length > count) throw new Error('EMF+ 路径 RLE 越界');
        for (let i = 0; i < run; i++) types.push(type);
      } else types.push(value);
    }
    return pathData(points, types);
  }
  if (type === 6) {
    const size = r.f32(), unit = r.u32(), style = r.u32(); r.u32();
    if (size <= 0) throw new Error('EMF+ 非法字号');
    return { size, unit, style, name: r.text(r.count(4096)) };
  }
  const flags = r.u32(); r.u32(); const align = r.u32(), lineAlign = r.u32();
  return { flags, align, lineAlign };
}
