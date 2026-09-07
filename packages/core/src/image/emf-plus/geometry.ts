import { n } from '../gdi';
import type { Pt } from '../gdi';
import type { Box } from './binary';

const xy = (p: Pt): string => `${n(p.x)} ${n(p.y)}`;
export function pathData(points: Pt[], types?: number[], closed = false): string {
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const type = types?.[i] ?? (i ? 1 : 0), kind = type & 7;
    if (!i && kind !== 0) throw new Error('EMF+ 路径缺少起点');
    if (kind === 0) d += `M${xy(points[i])}`;
    else if (kind === 1) d += `L${xy(points[i])}`;
    else if (kind === 3 && i + 2 < points.length && (types![i + 1] & 7) === 3 && (types![i + 2] & 7) === 3) {
      d += `C${xy(points[i])} ${xy(points[i + 1])} ${xy(points[i + 2])}`; i += 2;
    } else throw new Error('EMF+ 非法路径点类型');
    if ((types?.[i] ?? type) & 128) d += 'Z';
  }
  return d + (closed ? 'Z' : '');
}
export function spline(points: Pt[], tension: number, closed: boolean, offset = 0, segments = points.length - 1): string {
  if (points.length < 2 || offset < 0 || segments < 1 || offset + segments >= points.length && !closed) throw new Error('EMF+ 非法样条');
  const at = (i: number) => closed ? points[(i + points.length) % points.length] : points[Math.max(0, Math.min(points.length - 1, i))];
  let d = `M${xy(at(offset))}`;
  for (let i = offset; i < offset + (closed ? points.length : segments); i++) {
    const a = at(i - 1), b = at(i), c = at(i + 1), e = at(i + 2), t = tension / 3;
    d += `C${n(b.x + (c.x - a.x) * t)} ${n(b.y + (c.y - a.y) * t)} ${n(c.x - (e.x - b.x) * t)} ${n(c.y - (e.y - b.y) * t)} ${xy(c)}`;
  }
  return d + (closed ? 'Z' : '');
}
export function arc(box: Box, start: number, sweep: number, pie: boolean): string {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, rx = Math.abs(box.w / 2), ry = Math.abs(box.h / 2);
  sweep = Math.max(-360, Math.min(360, sweep));
  const pt = (deg: number): Pt => ({ x: cx + rx * Math.cos(deg * Math.PI / 180), y: cy + ry * Math.sin(deg * Math.PI / 180) });
  let d = pie ? `M${n(cx)} ${n(cy)}L${xy(pt(start))}` : `M${xy(pt(start))}`;
  // 完整圆的起终点相同，SVG 单个 A 命令会退化为空；拆成不超过半圆的弧。
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / 180));
  for (let i = 1; i <= count; i++) d += `A${n(rx)} ${n(ry)} 0 0 ${sweep >= 0 ? 1 : 0} ${xy(pt(start + sweep * i / count))}`;
  return d + (pie ? 'Z' : '');
}
