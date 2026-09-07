import type { ShapeElement } from '../types';
import { readInkRoot } from './model';

/** 保留显式 InkML 画布边界，删除边缘笔画不会把剩余文字拉满整个框。 */
export function inkStrokes(root: Element, w: number, h: number): ShapeElement[] {
  const data = readInkRoot(root), traces = data.strokes.filter((s) => s.points.length >= 2)
    .map((s) => ({ pts: s.points.map((p): [number, number] => [p.x, p.y]), brush: s }));
  if (!traces.length) return [];
  const { x: minX, y: minY, width, height } = data.bounds, maxX = minX + width, maxY = minY + height;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const scale = Math.min(spanX > 0 ? w / spanX : Infinity, spanY > 0 ? h / spanY : Infinity);
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const offX = (w - spanX * k) / 2;
  const offY = (h - spanY * k) / 2;

  const out: ShapeElement[] = [];
  for (const t of traces) {
    const pts = t.pts.map(([x, y]): [number, number] => [offX + (x - minX) * k, offY + (y - minY) * k]);
    let bx = Infinity;
    let by = Infinity;
    let bx2 = -Infinity;
    let by2 = -Infinity;
    for (const [x, y] of pts) {
      if (x < bx) bx = x;
      if (y < by) by = y;
      if (x > bx2) bx2 = x;
      if (y > by2) by2 = y;
    }
    const n = (v: number): string => String(Math.round(v * 100) / 100);
    const d = 'M ' + pts.map(([x, y]) => `${n(x - bx)} ${n(y - by)}`).join(' L ');
    const width = Math.max(0.75, Math.min((t.brush?.width ?? 0) * k || 2, 24));
    out.push({
      kind: 'shape',
      x: bx, y: by, w: Math.max(bx2 - bx, 0), h: Math.max(by2 - by, 0),
      rot: 0, flipH: false, flipV: false,
      path: d,
      fill: { type: 'none' },
      stroke: { color: t.brush?.color ?? 'rgb(0,0,0)', width, dash: null, cap: 'round', join: 'round' },
      text: null,
      openGeom: true,
    });
  }
  return out;
}

