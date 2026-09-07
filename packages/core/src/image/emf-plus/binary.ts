import type { Mat, Pt } from '../gdi';

/** EMF+ 不能沿用 GDI 越界补零：对象长度错位会把后续记录解释成可见图形。 */
export class Bytes {
  p = 0;
  private view: DataView;
  constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  get left(): number { return this.bytes.length - this.p; }
  take(size: number): Uint8Array {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.left) throw new Error('EMF+ 数据越界');
    const out = this.bytes.subarray(this.p, this.p + size); this.p += size; return out;
  }
  u8(): number { return this.take(1)[0]; }
  u16(): number { const p = this.p; this.take(2); return this.view.getUint16(p, true); }
  i16(): number { const n = this.u16(); return n & 0x8000 ? n - 65536 : n; }
  u32(): number { const p = this.p; this.take(4); return this.view.getUint32(p, true); }
  i32(): number { return this.u32() | 0; }
  f32(): number {
    const p = this.p; this.take(4); const n = this.view.getFloat32(p, true);
    if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new Error('EMF+ 非法坐标');
    return n;
  }
  count(limit = 100000): number { const n = this.u32(); if (n > limit) throw new Error('EMF+ 数量超限'); return n; }
  text(count: number): string {
    this.take(count * 2); let text = '';
    for (let i = this.p - count * 2; i < this.p; i += 2) text += String.fromCharCode(this.view.getUint16(i, true));
    return text.replace(/\0+$/, '');
  }
  matrix(): Mat { return [this.f32(), this.f32(), this.f32(), this.f32(), this.f32(), this.f32()]; }
  rect(compact = false): Box {
    const v = () => compact ? this.i16() : this.f32();
    return { x: v(), y: v(), w: v(), h: v() };
  }
  relative(): number {
    const a = this.u8(), n = a & 127;
    return a & 128 ? ((n & 64 ? n - 128 : n) * 256 + this.u8()) : (n & 64 ? n - 128 : n);
  }
  points(count: number, flags: number): Pt[] {
    if (count > 100000) throw new Error('EMF+ 点数量超限');
    const out: Pt[] = []; let x = 0, y = 0;
    for (let i = 0; i < count; i++) {
      if (flags & 0x800) { x += this.relative(); y += this.relative(); }
      else { x = flags & 0x4000 ? this.i16() : this.f32(); y = flags & 0x4000 ? this.i16() : this.f32(); }
      out.push({ x, y });
    }
    return out;
  }
}
export interface Box { x: number; y: number; w: number; h: number }
export const color = (v: number): string => `#${(v >>> 0).toString(16).padStart(8, '0').slice(2)}${(v >>> 24).toString(16).padStart(2, '0')}`;
export function unitScale(unit: number, dpi: number): number {
  const scale = [1, 1, 1, dpi / 72, dpi, dpi / 300, dpi / 25.4][unit];
  if (scale === undefined) throw new Error('EMF+ 未知单位');
  return scale;
}
