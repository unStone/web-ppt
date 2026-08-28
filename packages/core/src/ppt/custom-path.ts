import type { EscherProps } from './escher';
import { P } from './escher';

/** pVertices + pSegmentInfo → SVG path（复用 pptx 的 custGeom 逻辑不适用，这里直接生成） */
export function customPath(
  dv: DataView,
  props: EscherProps,
  w: number,
  h: number,
): string | null {
  const v = props.complex.get(P.pVertices);
  const s = props.complex.get(P.pSegmentInfo);
  if (!v) return null;
  // 复杂属性数组头：u16 count, u16 countMax, u16 entrySize
  const readArray = (c: { start: number; len: number }, parse: (off: number) => number[]): number[][] => {
    if (c.len < 6 || c.start < 0 || c.start + 6 > dv.byteLength) return [];
    const count = dv.getUint16(c.start, true);
    const entrySize = dv.getInt16(c.start + 4, true);
    const size = entrySize === -4 ? 8 : entrySize;
    if (size <= 0) return [];
    const end = Math.min(c.start + c.len, dv.byteLength);
    const out: number[][] = [];
    for (let i = 0; i < count; i++) {
      const off = c.start + 6 + i * size;
      if (off + size > end) break;
      out.push(parse(off));
    }
    return out;
  };
  if (v.len < 6 || v.start < 0 || v.start + 6 > dv.byteLength) return null;
  const entrySize = dv.getInt16(v.start + 4, true);
  const pts = readArray(v, (off) =>
    entrySize === 4 ? [dv.getInt16(off, true), dv.getInt16(off + 2, true)] : [dv.getInt32(off, true), dv.getInt32(off + 4, true)],
  );
  if (!pts.length) return null;

  const gl = props.simple.get(P.geoLeft) ?? 0;
  const gt = props.simple.get(P.geoTop) ?? 0;
  const gr = props.simple.get(P.geoRight) ?? 21600;
  const gb = props.simple.get(P.geoBottom) ?? 21600;
  const sx = w / Math.max(1, gr - gl);
  const sy = h / Math.max(1, gb - gt);
  const px = (p: number[]): string => `${((p[0] - gl) * sx).toFixed(2)} ${((p[1] - gt) * sy).toFixed(2)}`;

  if (!s) return `M ${pts.map(px).join(' L ')} Z`;

  const segs = readArray(s, (off) => [dv.getUint16(off, true)]);
  const out: string[] = [];
  let pi = 0;
  for (const [seg] of segs) {
    const msoType = seg >> 13;
    if (seg === 0x4000) out.push(`M ${px(pts[pi++] ?? [0, 0])}`);
    else if (seg === 0x6001) out.push('Z');
    else if (seg === 0x8000) break;
    else if (msoType === 0b010 || seg === 0xb300) {
      const a = pts[pi++], b = pts[pi++], c = pts[pi++];
      if (a && b && c) out.push(`C ${px(a)} ${px(b)} ${px(c)}`);
    } else if (seg < 0x4000) {
      const n = seg & 0xfff;
      for (let i = 0; i < Math.max(1, n) && pts[pi]; i++) out.push(`L ${px(pts[pi++])}`);
    }
  }
  return out.length ? out.join(' ') : `M ${pts.map(px).join(' L ')} Z`;
}
