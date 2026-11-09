/**
 * 各类图组共用的绘制件：数据点配色、折线 / 曲线路径、标记、数据标签与立体块。
 */
import type { ColorCtx } from '../pptx/color';
import type { Fill, ShapeElement, Stroke } from '../types';
import type { DLblSpec, PlotGroup, Series } from './model';
import { lineH } from './frame';
import {
  Depth3D, Pt, Rect, accentColor, clamp, darken, formatNumber, lighten, nf, px, quadEl, shapeEl, solid,
  strokeFrom, textEl,
} from './util';

export const TAU = Math.PI * 2;
const AUTO_SYMBOLS = ['circle', 'square', 'diamond', 'triangle', 'x', 'plus', 'star', 'dot'];

export interface PlotEnv {
  ctx: ColorCtx;
  fonts: string[];
  /** 图表默认文字大小 / 颜色 */
  size: number;
  color: string;
  cats: string[];
}

// ---------- 颜色 ----------

/** 数据点最终的填充与主色：dPt > 系列 spPr > varyColors 自动色 > 系列自动色 */
export function pointFill(g: PlotGroup, s: Series, i: number, ctx: ColorCtx): { fill: Fill; color: string } {
  const dp = s.dPts.get(i);
  const auto = g.varyColors ? accentColor(ctx, i) : s.color;
  const fill = dp?.fill ?? s.fill ?? solid(auto);
  return { fill, color: fill.type === 'solid' ? fill.color : auto };
}

export function pointStroke(s: Series, i: number, def: string | null, defW: number): Stroke | null {
  const dp = s.dPts.get(i);
  return strokeFrom(dp?.ln.present ? dp.ln : s.ln, def, defW);
}

// ---------- 通用小工具 ----------

export const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v;

function bbox(pts: Pt[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Catmull-Rom → 三次贝塞尔，用于 c:smooth */
function curveTo(run: Pt[], ox: number, oy: number): string {
  const p = run.map(([x, y]): Pt => [x - ox, y - oy]);
  let d = `M ${nf(p[0][0])} ${nf(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i === 0 ? 0 : i - 1];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2 < p.length ? i + 2 : p.length - 1];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${nf(c1[0])} ${nf(c1[1])} ${nf(c2[0])} ${nf(c2[1])} ${nf(p2[0])} ${nf(p2[1])}`;
  }
  return d;
}

/** 多段折线/平滑曲线 → 单个 ShapeElement（坐标为图表局部绝对坐标） */
export function pathEl(
  runs: Pt[][],
  fill: Fill | null,
  stroke: Stroke | null,
  close: boolean,
  smooth: boolean,
): ShapeElement | null {
  const valid = runs
    .map((r) => r.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)))
    .filter((r) => r.length >= (close ? 3 : 2));
  if (!valid.length) return null;
  const box = bbox(valid.flat());
  const d = valid
    .map((run) =>
      (smooth && run.length > 2
        ? curveTo(run, box.x, box.y)
        : 'M ' + run.map(([x, y]) => `${nf(x - box.x)} ${nf(y - box.y)}`).join(' L ')) + (close ? ' Z' : ''),
    )
    .join(' ');
  return shapeEl(box.x, box.y, box.w, box.h, d, fill, stroke);
}

export function circlePath(cx: number, cy: number, r: number): string {
  return (
    `M ${nf(cx - r)} ${nf(cy)} A ${nf(r)} ${nf(r)} 0 1 1 ${nf(cx + r)} ${nf(cy)}` +
    ` A ${nf(r)} ${nf(r)} 0 1 1 ${nf(cx - r)} ${nf(cy)} Z`
  );
}

// ---------- 标记 ----------

function symbolPath(sym: string, r: number): { d: string; open: boolean } {
  const c = r;
  const s = r * 2;
  switch (sym) {
    case 'square':
      return { d: `M 0 0 L ${nf(s)} 0 L ${nf(s)} ${nf(s)} L 0 ${nf(s)} Z`, open: false };
    case 'diamond':
      return { d: `M ${nf(c)} 0 L ${nf(s)} ${nf(c)} L ${nf(c)} ${nf(s)} L 0 ${nf(c)} Z`, open: false };
    case 'triangle':
      return { d: `M ${nf(c)} 0 L ${nf(s)} ${nf(s)} L 0 ${nf(s)} Z`, open: false };
    case 'x':
      return { d: `M 0 0 L ${nf(s)} ${nf(s)} M ${nf(s)} 0 L 0 ${nf(s)}`, open: true };
    case 'plus':
      return { d: `M ${nf(c)} 0 L ${nf(c)} ${nf(s)} M 0 ${nf(c)} L ${nf(s)} ${nf(c)}`, open: true };
    case 'star':
      return {
        d:
          `M ${nf(c)} 0 L ${nf(c)} ${nf(s)} M 0 ${nf(c)} L ${nf(s)} ${nf(c)}` +
          ` M 0 0 L ${nf(s)} ${nf(s)} M ${nf(s)} 0 L 0 ${nf(s)}`,
        open: true,
      };
    case 'dash':
      return { d: `M 0 ${nf(c)} L ${nf(s)} ${nf(c)}`, open: true };
    case 'dot':
      return { d: circlePath(c, c, r * 0.55), open: false };
    default:
      return { d: circlePath(c, c, r), open: false };
  }
}

/** 解析系列最终使用的标记符号；'none' 表示不画 */
export function markerSymbol(g: PlotGroup, s: Series, si: number): string {
  const wanted = g.kind === 'scatter' ? g.scatterStyle !== 'line' && g.scatterStyle !== 'smooth' : g.showMarker;
  let sym = s.marker ? s.marker.symbol : wanted ? 'auto' : 'none';
  if (sym === 'auto') sym = wanted ? AUTO_SYMBOLS[si % AUTO_SYMBOLS.length] : 'none';
  return sym;
}

export function markerEl(cx: number, cy: number, sym: string, s: Series, color: string): ShapeElement | null {
  if (sym === 'none' || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const r = Math.max(px(clamp(s.marker?.size ?? 5, 2, 72)) / 2, 1);
  const { d, open } = symbolPath(sym, r);
  const mf = s.marker?.fill;
  const ml = s.marker ? strokeFrom(s.marker.ln, null, 0) : null;
  if (open) {
    return shapeEl(cx - r, cy - r, r * 2, r * 2, d, null, ml ?? { color, width: 1.25, dash: null });
  }
  return shapeEl(cx - r, cy - r, r * 2, r * 2, d, mf ?? solid(color), ml);
}

// ---------- 数据标签 ----------

export function labelString(
  s: Series,
  i: number,
  v: number,
  pct: number | null,
  env: PlotEnv,
  sizeVal: number | null = null,
  category: string = env.cats[i] ?? '',
): string {
  const l = s.dLbls;
  const parts: string[] = [];
  if (l.showSer) parts.push(s.name);
  if (l.showCat) parts.push(category);
  if (l.showVal) parts.push(formatNumber(v, l.fmt ?? s.fmt));
  // 气泡大小有自己的格式，套 y 值的百分比格式会得到荒唐的数字
  if (l.showSize && sizeVal !== null) parts.push(formatNumber(sizeVal, s.sizeFmt ?? l.fmt ?? s.fmt));
  if (l.showPercent && pct !== null) parts.push(formatNumber(pct, l.fmt && l.fmt.includes('%') ? l.fmt : '0%'));
  return parts.filter((p) => p !== '').join(' ');
}

export function labelEl(cx: number, cy: number, text: string, l: DLblSpec, env: PlotEnv): ShapeElement | null {
  if (!text || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const size = l.size ?? env.size * 0.92;
  const w = Math.max(text.length * size * 0.75, size * 2);
  const h = lineH(size);
  return textEl(cx - w / 2, cy - h / 2, w, h, text, {
    size,
    color: l.color ?? env.color,
    align: 'center',
    anchor: 'middle',
    fonts: env.fonts,
  });
}

// ---------- 立体块 ----------

/**
 * 等轴测立体块：正面矩形 + 一个侧面 + 一个顶（底）面。
 * 顶面用主色提亮 25%，侧面压暗 20%；面片顺序为「侧面 → 顶面 → 正面」，正面最后压在最上。
 */
export function box3D(r: Rect, d: Depth3D, fill: Fill, base: string, stroke: Stroke | null): ShapeElement[] {
  const out: ShapeElement[] = [];
  const x0 = r.x;
  const x1 = r.x + r.w;
  const y0 = r.y;
  const y1 = r.y + r.h;
  const push = (pts: Pt[], color: string): void => {
    const el = quadEl(pts, solid(color), stroke);
    if (el) out.push(el);
  };
  // 侧面：背面偏右时看到右侧面，偏左时看到左侧面
  const sx = d.dx >= 0 ? x1 : x0;
  push([[sx, y0], [sx + d.dx, y0 + d.dy], [sx + d.dx, y1 + d.dy], [sx, y1]], darken(base));
  // 顶面（俯视）/ 底面（仰视）
  const cy = d.dy <= 0 ? y0 : y1;
  push([[x0, cy], [x1, cy], [x1 + d.dx, cy + d.dy], [x0 + d.dx, cy + d.dy]], lighten(base));
  out.push(shapeEl(r.x, r.y, r.w, r.h, `M 0 0 L ${nf(r.w)} 0 L ${nf(r.w)} ${nf(r.h)} L 0 ${nf(r.h)} Z`, fill, stroke));
  return out;
}
