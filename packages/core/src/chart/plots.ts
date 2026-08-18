/**
 * 各类图组的几何生成：柱/条、折线、面积、散点、饼/环，以及标记与数据标签。
 */
import type { ColorCtx } from '../pptx/color';
import type { Fill, ShapeElement, SlideElement, Stroke } from '../types';
import type { DLblSpec, PlotGroup, Series } from './model';
import { isStacked, labelVisible } from './model';
import type { Cartesian, XYPlot } from './frame';
import { lineH } from './frame';
import {
  Depth3D, Pt, Rect, accentColor, clamp, darken, formatNumber, lighten, lineEl, measure, mix, nf,
  polyEl, px, quadEl, rectEl, shapeEl, solid, strokeFrom, textEl,
} from './util';

const TAU = Math.PI * 2;
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

function pointStroke(s: Series, i: number, def: string | null, defW: number): Stroke | null {
  const dp = s.dPts.get(i);
  return strokeFrom(dp?.ln.present ? dp.ln : s.ln, def, defW);
}

// ---------- 通用小工具 ----------

const num = (v: number | null | undefined): number | null =>
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
function pathEl(
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

function circlePath(cx: number, cy: number, r: number): string {
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

function labelString(
  s: Series,
  i: number,
  v: number,
  pct: number | null,
  env: PlotEnv,
  sizeVal: number | null = null,
): string {
  const l = s.dLbls;
  const parts: string[] = [];
  if (l.showSer) parts.push(s.name);
  if (l.showCat) parts.push(env.cats[i] ?? '');
  if (l.showVal) parts.push(formatNumber(v, l.fmt ?? s.fmt));
  // 气泡大小有自己的格式，套 y 值的百分比格式会得到荒唐的数字
  if (l.showSize && sizeVal !== null) parts.push(formatNumber(sizeVal, s.sizeFmt ?? l.fmt ?? s.fmt));
  if (l.showPercent && pct !== null) parts.push(formatNumber(pct, l.fmt && l.fmt.includes('%') ? l.fmt : '0%'));
  return parts.filter((p) => p !== '').join(' ');
}

function labelEl(cx: number, cy: number, text: string, l: DLblSpec, env: PlotEnv): ShapeElement | null {
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
function box3D(r: Rect, d: Depth3D, fill: Fill, base: string, stroke: Stroke | null): ShapeElement[] {
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

// ---------- 柱 / 条 ----------

export interface BarSlot {
  /** 本组在簇中的起始槽位 */
  base: number;
  /** 同一坐标轴上的簇总槽位数 */
  total: number;
}

interface BarRec {
  r: Rect;
  fill: Fill;
  color: string;
  stroke: Stroke | null;
  /** 柱脚（值 = 基线处）的屏幕坐标，用于 3D 遮挡排序 */
  anchor: Pt;
}

export function renderBars(
  g: PlotGroup,
  c: Cartesian,
  slot: BarSlot,
  env: PlotEnv,
  depth: Depth3D | null = null,
): SlideElement[] {
  const out: SlideElement[] = [];
  const gapW = clamp(g.gapWidth, 0, 800) / 100;
  const ov = clamp(g.overlap, -100, 100) / 100;
  const total = Math.max(slot.total, 1);
  const denom = 1 + (total - 1) * (1 - ov) + gapW;
  let barW = c.band / (denom > 0 ? denom : 1);
  if (!(barW > 0)) barW = c.band * 0.6;
  barW = Math.min(barW, c.band);
  const occupied = barW * (1 + (total - 1) * (1 - ov));
  const step = barW * (1 - ov);
  const stacked = isStacked(g);
  const percent = g.grouping === 'percentStacked';

  const n = g.series.reduce((a, s) => Math.max(a, s.vals.length), 0);
  const posAcc = new Array<number>(n).fill(0);
  const negAcc = new Array<number>(n).fill(0);
  const totals = new Array<number>(n).fill(0);
  if (percent) {
    for (let i = 0; i < n; i++) {
      let t = 0;
      for (const s of g.series) t += Math.abs(num(s.vals[i]) ?? 0);
      totals[i] = t;
    }
  }

  const labels: SlideElement[] = [];
  const recs: BarRec[] = [];
  g.series.forEach((s, si) => {
    const k = slot.base + (stacked ? 0 : si);
    const sym = c.horizontal ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const raw = num(s.vals[i]);
      if (raw === null) continue;
      const v = percent ? (totals[i] > 0 ? raw / totals[i] : 0) : raw;
      let base = 0;
      if (stacked) {
        base = v >= 0 ? posAcc[i] : negAcc[i];
        if (v >= 0) posAcc[i] += v;
        else negAcc[i] += v;
      }
      // 类目方向的中心：条形图槽位自下而上，柱状图自左而右
      const cc = c.cat(i) + sym * (-occupied / 2 + k * step + barW / 2);
      const v0 = c.val(c.clampVal(base));
      const v1 = c.val(c.clampVal(base + v));
      const [ax, ay] = c.pt(cc - barW / 2, v0);
      const [bx, by] = c.pt(cc + barW / 2, v1);
      const r: Rect = {
        x: Math.min(ax, bx),
        y: Math.min(ay, by),
        w: Math.abs(bx - ax),
        h: Math.abs(by - ay),
      };
      const { fill, color } = pointFill(g, s, i, env.ctx);
      if (r.w > 0.05 && r.h > 0.05) {
        recs.push({ r, fill, color, stroke: pointStroke(s, i, null, 0), anchor: c.pt(cc, v0) });
      }
      if (labelVisible(s.dLbls)) {
        const text = labelString(s, i, raw, percent && totals[i] > 0 ? Math.abs(raw) / totals[i] : null, env);
        const size = s.dLbls.size ?? env.size * 0.92;
        const padOut = lineH(size) * 0.6;
        const pos = s.dLbls.pos ?? (stacked ? 'ctr' : 'outEnd');
        let lx = (r.x + r.x + r.w) / 2;
        let ly = (r.y + r.y + r.h) / 2;
        if (pos !== 'ctr') {
          const inward = pos === 'inEnd' || pos === 'inBase';
          const sign = inward ? -1 : 1;
          if (c.horizontal) lx = (v >= 0 ? r.x + r.w : r.x) + sign * (v >= 0 ? padOut : -padOut);
          else ly = (v >= 0 ? r.y : r.y + r.h) - sign * (v >= 0 ? padOut : -padOut);
        }
        const el = labelEl(lx, ly, text, s.dLbls, env);
        if (el) labels.push(el);
      }
    }
  });

  if (depth) {
    // 画家算法：沿深度方向投影越大（越靠近观察者一侧）越后画
    const key = (b: BarRec): number => b.anchor[0] * depth.dx + b.anchor[1] * depth.dy;
    recs.sort((a, b) => key(a) - key(b));
    for (const b of recs) out.push(...box3D(b.r, depth, b.fill, b.color, b.stroke));
  } else {
    for (const b of recs) {
      out.push(
        shapeEl(b.r.x, b.r.y, b.r.w, b.r.h,
          `M 0 0 L ${nf(b.r.w)} 0 L ${nf(b.r.w)} ${nf(b.r.h)} L 0 ${nf(b.r.h)} Z`, b.fill, b.stroke),
      );
    }
  }
  return out.concat(labels);
}

// ---------- 折线 / 面积 ----------

/** 堆叠时按序累计；返回每个系列每个类目的「顶」值与「底」值 */
function stackLevels(g: PlotGroup): { top: (number | null)[][]; bottom: (number | null)[][] } {
  const n = g.series.reduce((a, s) => Math.max(a, s.vals.length), 0);
  const stacked = isStacked(g);
  const percent = g.grouping === 'percentStacked';
  const totals = new Array<number>(n).fill(0);
  if (percent) {
    for (let i = 0; i < n; i++) {
      let t = 0;
      for (const s of g.series) t += Math.abs(num(s.vals[i]) ?? 0);
      totals[i] = t;
    }
  }
  const acc = new Array<number>(n).fill(0);
  const top: (number | null)[][] = [];
  const bottom: (number | null)[][] = [];
  for (const s of g.series) {
    const t: (number | null)[] = [];
    const b: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
      const raw = num(s.vals[i]);
      if (raw === null) {
        t.push(null);
        b.push(null);
        continue;
      }
      const v = percent ? (totals[i] > 0 ? raw / totals[i] : 0) : raw;
      if (stacked) {
        b.push(acc[i]);
        acc[i] += v;
        t.push(acc[i]);
      } else {
        b.push(0);
        t.push(v);
      }
    }
    top.push(t);
    bottom.push(b);
  }
  return { top, bottom };
}

export function renderLines(g: PlotGroup, c: Cartesian, env: PlotEnv): SlideElement[] {
  const out: SlideElement[] = [];
  const overlay: SlideElement[] = [];
  const { top } = stackLevels(g);
  const percent = g.grouping === 'percentStacked';

  g.series.forEach((s, si) => {
    const vals = top[si] ?? [];
    const runs: Pt[][] = [];
    let cur: Pt[] = [];
    const pts: (Pt | null)[] = [];
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v === null) {
        if (cur.length) runs.push(cur);
        cur = [];
        pts.push(null);
        continue;
      }
      const p = c.pt(c.cat(i), c.val(c.clampVal(v)));
      cur.push(p);
      pts.push(p);
    }
    if (cur.length) runs.push(cur);

    const stroke = strokeFrom(s.ln, s.color, px(2.25));
    const el = pathEl(runs, null, stroke, false, s.smooth);
    if (el) out.push(el);

    const sym = markerSymbol(g, s, si);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p) continue;
      const { color } = pointFill(g, s, i, env.ctx);
      const mk = markerEl(p[0], p[1], sym, s, g.varyColors ? color : s.color);
      if (mk) overlay.push(mk);
      if (labelVisible(s.dLbls)) {
        const raw = num(s.vals[i]) ?? 0;
        const text = labelString(s, i, raw, percent ? (vals[i] ?? 0) : null, env);
        const size = s.dLbls.size ?? env.size * 0.92;
        const el2 = labelEl(p[0], p[1] - lineH(size) * 0.85, text, s.dLbls, env);
        if (el2) overlay.push(el2);
      }
    }
  });
  return out.concat(overlay);
}

export function renderAreas(g: PlotGroup, c: Cartesian, env: PlotEnv): SlideElement[] {
  const out: SlideElement[] = [];
  const labels: SlideElement[] = [];
  const { top, bottom } = stackLevels(g);
  const percent = g.grouping === 'percentStacked';

  g.series.forEach((s, si) => {
    const tv = top[si] ?? [];
    const bv = bottom[si] ?? [];
    const runs: Pt[][] = [];
    let upper: Pt[] = [];
    let lower: Pt[] = [];
    const flush = (): void => {
      if (upper.length >= 2) runs.push(upper.concat(lower.slice().reverse()));
      upper = [];
      lower = [];
    };
    for (let i = 0; i < tv.length; i++) {
      const v = tv[i];
      if (v === null) {
        flush();
        continue;
      }
      upper.push(c.pt(c.cat(i), c.val(c.clampVal(v))));
      lower.push(c.pt(c.cat(i), c.val(c.clampVal(bv[i] ?? 0))));
    }
    flush();

    const { fill } = pointFill(g, s, 0, env.ctx);
    const el = pathEl(runs, fill, strokeFrom(s.ln, null, 0), true, s.smooth);
    if (el) out.push(el);

    if (labelVisible(s.dLbls)) {
      for (let i = 0; i < tv.length; i++) {
        const v = tv[i];
        if (v === null) continue;
        const [x, y] = c.pt(c.cat(i), c.val(c.clampVal(v)));
        const raw = num(s.vals[i]) ?? 0;
        const size = s.dLbls.size ?? env.size * 0.92;
        const el2 = labelEl(x, y - lineH(size) * 0.8, labelString(s, i, raw, percent ? v : null, env), s.dLbls, env);
        if (el2) labels.push(el2);
      }
    }
  });
  return out.concat(labels);
}

// ---------- 散点 ----------

export function renderScatter(g: PlotGroup, p: XYPlot, env: PlotEnv): SlideElement[] {
  const out: SlideElement[] = [];
  const overlay: SlideElement[] = [];
  const drawLine = g.scatterStyle !== 'marker' && g.scatterStyle !== 'none';

  g.series.forEach((s, si) => {
    const runs: Pt[][] = [];
    let cur: Pt[] = [];
    const pts: (Pt | null)[] = [];
    for (let i = 0; i < s.vals.length; i++) {
      const yv = num(s.vals[i]);
      const xv = s.xs ? num(s.xs[i]) : i + 1;
      if (yv === null || xv === null) {
        if (cur.length) runs.push(cur);
        cur = [];
        pts.push(null);
        continue;
      }
      const pt: Pt = [p.x(p.clampX(xv)), p.y(p.clampY(yv))];
      cur.push(pt);
      pts.push(pt);
    }
    if (cur.length) runs.push(cur);

    if (drawLine) {
      const stroke = strokeFrom(s.ln, s.color, px(2.25));
      const el = pathEl(runs, null, stroke, false, s.smooth || g.scatterStyle === 'smoothMarker');
      if (el) out.push(el);
    }
    const sym = markerSymbol(g, s, si);
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      if (!q) continue;
      const { color } = pointFill(g, s, i, env.ctx);
      const mk = markerEl(q[0], q[1], sym === 'none' && !drawLine ? 'circle' : sym, s, g.varyColors ? color : s.color);
      if (mk) overlay.push(mk);
      if (labelVisible(s.dLbls)) {
        const size = s.dLbls.size ?? env.size * 0.92;
        const el2 = labelEl(q[0], q[1] - lineH(size) * 0.85, labelString(s, i, num(s.vals[i]) ?? 0, null, env), s.dLbls, env);
        if (el2) overlay.push(el2);
      }
    }
  });
  return out.concat(overlay);
}

// ---------- 气泡 ----------

/**
 * 气泡图：位置同散点（xVal / yVal），半径由 c:bubbleSize 决定。
 * 默认 sizeRepresents=area，即面积正比于数值（半径按平方根），w 模式则半径直接正比。
 * 大气泡先画，避免小气泡被完全盖住。
 */
export function renderBubbles(g: PlotGroup, p: XYPlot, env: PlotEnv): SlideElement[] {
  const scale = clamp(g.bubbleScale, 0, 300) / 100;
  const maxR = Math.max(2, Math.min(p.rect.w, p.rect.h) * 0.13 * scale);
  let maxSize = 0;
  for (const s of g.series) {
    for (const v of s.sizes ?? []) {
      const n = num(v);
      if (n !== null) maxSize = Math.max(maxSize, Math.abs(n));
    }
  }
  const byArea = g.bubbleSizeBy !== 'w';

  interface Bub {
    x: number;
    y: number;
    r: number;
    fill: Fill;
    color: string;
    stroke: Stroke | null;
    label: string;
    lblSpec: Series;
  }
  const bubbles: Bub[] = [];

  for (const s of g.series) {
    for (let i = 0; i < s.vals.length; i++) {
      const yv = num(s.vals[i]);
      const xv = s.xs ? num(s.xs[i]) : i + 1;
      if (yv === null || xv === null) continue;
      const sz = s.sizes ? Math.abs(num(s.sizes[i]) ?? 0) : 0;
      const frac = maxSize > 0 ? sz / maxSize : 1;
      const rr = Math.max(1.5, maxR * (byArea ? Math.sqrt(frac) : frac));
      const { fill, color } = pointFill(g, s, i, env.ctx);
      const auto = g.varyColors ? color : s.color;
      bubbles.push({
        x: p.x(p.clampX(xv)),
        y: p.y(p.clampY(yv)),
        r: rr,
        fill: g.varyColors ? solid(auto) : fill,
        color: auto,
        stroke: pointStroke(s, i, darken(auto, 0.35), Math.max(1, px(0.75))),
        label: labelVisible(s.dLbls) ? labelString(s, i, yv, null, env, s.sizes ? num(s.sizes[i]) : null) : '',
        lblSpec: s,
      });
    }
  }

  bubbles.sort((a, b) => b.r - a.r);
  const out: SlideElement[] = [];
  const labels: SlideElement[] = [];
  for (const b of bubbles) {
    out.push(shapeEl(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2, circlePath(b.r, b.r, b.r), b.fill, b.stroke));
    if (b.label) {
      const el = labelEl(b.x, b.y, b.label, b.lblSpec.dLbls, env);
      if (el) labels.push(el);
    }
  }
  return out.concat(labels);
}

// ---------- 股价图 ----------

/**
 * 股价图：系列顺序按 OOXML 约定（4 个系列 = 开高低收，3 个 = 高低收）。
 * 有 c:upDownBars 时画蜡烛（实体 = 开收之间），否则画传统 OHLC 竖线 + 左右短横。
 */
export function renderStock(g: PlotGroup, c: Cartesian, env: PlotEnv): SlideElement[] {
  const n = g.series.length;
  if (n < 3) return [];
  const seq = n >= 4 ? g.series.slice(n - 4) : g.series;
  const open = n >= 4 ? seq[0] : null;
  const high = seq[n >= 4 ? 1 : 0];
  const low = seq[n >= 4 ? 2 : 1];
  const close = seq[n >= 4 ? 3 : 2];

  const lineColor = mix(env.color, 'rgb(255,255,255)', 0.15);
  const wick: Stroke = strokeFrom(g.hiLowLines, lineColor, 1) ?? { color: lineColor, width: 1, dash: null };
  const count = Math.max(high.vals.length, low.vals.length, close.vals.length);
  const gap = clamp(g.upDown?.gapWidth ?? 150, 0, 500) / 100;
  const bodyW = Math.max(1.5, Math.min(c.band / (1 + gap), c.band * 0.9));
  const tick = Math.max(1.5, bodyW / 2);

  const out: SlideElement[] = [];
  for (let i = 0; i < count; i++) {
    const hv = num(high.vals[i]);
    const lv = num(low.vals[i]);
    const cv = num(close.vals[i]);
    const ov = open ? num(open.vals[i]) : null;
    if (hv === null || lv === null) continue;
    const cc = c.cat(i);
    const yHi = c.val(c.clampVal(Math.max(hv, lv)));
    const yLo = c.val(c.clampVal(Math.min(hv, lv)));
    const [x1, y1] = c.pt(cc, yHi);
    const [x2, y2] = c.pt(cc, yLo);
    const ln = lineEl(x1, y1, x2, y2, wick);
    if (ln) out.push(ln);

    if (g.upDown && ov !== null && cv !== null) {
      const up = cv >= ov;
      const yo = c.val(c.clampVal(ov));
      const yc = c.val(c.clampVal(cv));
      const [ax, ay] = c.pt(cc - bodyW / 2, Math.min(yo, yc));
      const [bx, by] = c.pt(cc + bodyW / 2, Math.max(yo, yc));
      const rect: Rect = {
        x: Math.min(ax, bx),
        y: Math.min(ay, by),
        w: Math.max(Math.abs(bx - ax), 1),
        h: Math.max(Math.abs(by - ay), 1),
      };
      const spec = up ? g.upDown.upFill : g.upDown.downFill;
      const fill = spec ?? solid(up ? 'rgb(255,255,255)' : lineColor);
      const stroke = strokeFrom(up ? g.upDown.upLn : g.upDown.downLn, lineColor, 1)
        ?? { color: lineColor, width: 1, dash: null };
      out.push(shapeEl(rect.x, rect.y, rect.w, rect.h,
        `M 0 0 L ${nf(rect.w)} 0 L ${nf(rect.w)} ${nf(rect.h)} L 0 ${nf(rect.h)} Z`, fill, stroke));
    } else {
      // OHLC：开盘在左、收盘在右
      if (ov !== null) {
        const [ox, oy] = c.pt(cc, c.val(c.clampVal(ov)));
        const t = lineEl(ox - (c.horizontal ? 0 : tick), oy - (c.horizontal ? tick : 0), ox, oy, wick);
        if (t) out.push(t);
      }
      if (cv !== null) {
        const [qx, qy] = c.pt(cc, c.val(c.clampVal(cv)));
        const t = lineEl(qx, qy, qx + (c.horizontal ? 0 : tick), qy + (c.horizontal ? tick : 0), wick);
        if (t) out.push(t);
      }
    }

    if (labelVisible(close.dLbls) && cv !== null) {
      const [lx, ly] = c.pt(cc, c.val(c.clampVal(cv)));
      const size = close.dLbls.size ?? env.size * 0.92;
      const el = labelEl(lx + bodyW, ly - lineH(size) * 0.2, labelString(close, i, cv, null, env), close.dLbls, env);
      if (el) out.push(el);
    }
  }
  return out;
}

// ---------- 饼 / 环 ----------

function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const P = (r: number, a: number): string => `${nf(cx + r * Math.cos(a))} ${nf(cy + r * Math.sin(a))}`;
  const sweep = a1 - a0;
  if (sweep >= TAU - 1e-6) {
    const outer = circlePath(cx, cy, r1);
    // evenodd 填充规则下，内圆自动成为孔
    return r0 > 0.01 ? `${outer} ${circlePath(cx, cy, r0)}` : outer;
  }
  const large = sweep > Math.PI ? 1 : 0;
  if (r0 <= 0.01) {
    return `M ${nf(cx)} ${nf(cy)} L ${P(r1, a0)} A ${nf(r1)} ${nf(r1)} 0 ${large} 1 ${P(r1, a1)} Z`;
  }
  return (
    `M ${P(r1, a0)} A ${nf(r1)} ${nf(r1)} 0 ${large} 1 ${P(r1, a1)}` +
    ` L ${P(r0, a1)} A ${nf(r0)} ${nf(r0)} 0 ${large} 0 ${P(r0, a0)} Z`
  );
}

// ---------- 3D 饼 ----------

/** 椭圆压扁比例与侧壁高度（相对水平半径） */
const PIE3D_KY = 0.55;
const PIE3D_WALL = 0.17;

const ellipsePt = (cx: number, cy: number, rx: number, ry: number, a: number): string =>
  `${nf(cx + rx * Math.cos(a))} ${nf(cy + ry * Math.sin(a))}`;

function ellipseSector(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): string {
  const P = (a: number): string => ellipsePt(cx, cy, rx, ry, a);
  const sweep = a1 - a0;
  if (sweep >= TAU - 1e-6) {
    return (
      `M ${nf(cx - rx)} ${nf(cy)} A ${nf(rx)} ${nf(ry)} 0 1 1 ${nf(cx + rx)} ${nf(cy)}` +
      ` A ${nf(rx)} ${nf(ry)} 0 1 1 ${nf(cx - rx)} ${nf(cy)} Z`
    );
  }
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${nf(cx)} ${nf(cy)} L ${P(a0)} A ${nf(rx)} ${nf(ry)} 0 ${large} 1 ${P(a1)} Z`;
}

/** 扇区落在「前半圈」（屏幕下半，sin>0）的角度片段——只有这部分侧壁可见 */
function frontArcs(a0: number, a1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = -1; k <= 2; k++) {
    const lo = Math.max(a0, k * TAU);
    const hi = Math.min(a1, k * TAU + Math.PI);
    if (hi - lo > 1e-4) out.push([lo, hi]);
  }
  return out;
}

function wallPath(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, h: number): string {
  const P = (a: number, dy: number): string => ellipsePt(cx, cy + dy, rx, ry, a);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return (
    `M ${P(a0, 0)} A ${nf(rx)} ${nf(ry)} 0 ${large} 1 ${P(a1, 0)}` +
    ` L ${P(a1, h)} A ${nf(rx)} ${nf(ry)} 0 ${large} 0 ${P(a0, h)} Z`
  );
}

/** 等轴测伪 3D 饼：压扁椭圆 + 前半圈侧壁，扇区按「前后」排序保证遮挡正确 */
export function renderPie3D(g: PlotGroup, rect: Rect, env: PlotEnv): SlideElement[] {
  const s = g.series[0];
  if (!s) return [];
  const shrinkK = labelVisible(s.dLbls) ? 0.8 : 0.94;
  const rx = Math.min(rect.w / 2, rect.h / (2 * PIE3D_KY + PIE3D_WALL)) * shrinkK;
  if (!(rx > 0)) return [];
  const ry = rx * PIE3D_KY;
  const wall = rx * PIE3D_WALL;
  const cx0 = rect.x + rect.w / 2;
  const cy0 = rect.y + (rect.h - (2 * ry + wall)) / 2 + ry;

  const vals = s.vals.map((v) => Math.abs(num(v) ?? 0));
  const total = vals.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return [];

  const walls: Array<{ el: ShapeElement; depth: number }> = [];
  const tops: SlideElement[] = [];
  const labels: SlideElement[] = [];
  let a = (clamp(g.firstSliceAng, 0, 360) - 90) * (Math.PI / 180);

  for (let i = 0; i < vals.length; i++) {
    const frac = vals[i] / total;
    const sweep = frac * TAU;
    if (!(sweep > 0)) continue;
    const a1 = a + sweep;
    const mid = a + sweep / 2;
    const boom = (clamp(s.dPts.get(i)?.explosion ?? 0, 0, 400) / 100) * rx * 0.5;
    const cx = cx0 + Math.cos(mid) * boom;
    const cy = cy0 + Math.sin(mid) * boom * PIE3D_KY;
    const { fill, color } = pointFill(g, s, i, env.ctx);
    const stroke = pointStroke(s, i, null, 0);

    for (const [b0, b1] of frontArcs(a, a1)) {
      const el = shapeEl(
        cx - rx, cy - ry, rx * 2, ry * 2 + wall,
        wallPath(rx, ry, rx, ry, b0, b1, wall),
        solid(darken(color)),
        stroke,
      );
      walls.push({ el, depth: Math.sin((b0 + b1) / 2) });
    }

    tops.push(shapeEl(cx - rx, cy - ry, rx * 2, ry * 2, ellipseSector(rx, ry, rx, ry, a, a1), fill, stroke));

    if (labelVisible(s.dLbls)) {
      const outside = s.dLbls.pos === 'outEnd' || s.dLbls.pos === 'bestFit';
      const k = outside ? 1.2 : 0.62;
      const sin = Math.sin(mid);
      // 前半圈的标签要让开侧壁，后半圈不需要
      const drop = sin > 0 ? wall * (outside ? 1 : 0.5) : 0;
      const text = labelString(s, i, num(s.vals[i]) ?? 0, frac, env);
      const el = labelEl(cx + Math.cos(mid) * rx * k, cy + sin * ry * k + drop, text, s.dLbls, env);
      if (el) labels.push(el);
    }
    a = a1;
  }

  // 侧壁从后往前，再盖上顶面
  walls.sort((p, q) => p.depth - q.depth);
  return (walls.map((w) => w.el) as SlideElement[]).concat(tops, labels);
}

/** 饼图只画第一个系列；环形图每个系列一圈（第一个系列在内圈） */
export function renderPie(g: PlotGroup, rect: Rect, env: PlotEnv): SlideElement[] {
  const out: SlideElement[] = [];
  const labels: SlideElement[] = [];
  const ringSeries = g.kind === 'doughnut' ? g.series : g.series.slice(0, 1);
  if (!ringSeries.length) return out;

  const anyLabel = ringSeries.some((s) => labelVisible(s.dLbls));
  const outerR = (Math.min(rect.w, rect.h) / 2) * (anyLabel ? 0.78 : 0.92);
  if (!(outerR > 0)) return out;
  const cx0 = rect.x + rect.w / 2;
  const cy0 = rect.y + rect.h / 2;
  const hole = g.kind === 'doughnut' ? clamp(g.holeSize, 0, 90) / 100 : 0;
  const thick = (outerR * (1 - hole)) / ringSeries.length;

  ringSeries.forEach((s, ri) => {
    const r0 = outerR * hole + ri * thick;
    const r1 = r0 + thick;
    const vals = s.vals.map((v) => Math.abs(num(v) ?? 0));
    const total = vals.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return;
    let a = (clamp(g.firstSliceAng, 0, 360) - 90) * (Math.PI / 180);
    for (let i = 0; i < vals.length; i++) {
      const frac = vals[i] / total;
      const sweep = frac * TAU;
      if (!(sweep > 0)) continue;
      const mid = a + sweep / 2;
      const boom = (clamp(s.dPts.get(i)?.explosion ?? 0, 0, 400) / 100) * r1 * 0.5;
      const cx = cx0 + Math.cos(mid) * boom;
      const cy = cy0 + Math.sin(mid) * boom;
      const { fill } = pointFill(g, s, i, env.ctx);
      out.push(
        shapeEl(
          cx - r1,
          cy - r1,
          r1 * 2,
          r1 * 2,
          sectorPath(r1, r1, r0, r1, a, a + sweep),
          fill,
          pointStroke(s, i, null, 0),
        ),
      );
      if (labelVisible(s.dLbls)) {
        const outside = s.dLbls.pos === 'outEnd' || s.dLbls.pos === 'bestFit';
        const lr = outside ? r1 * 1.16 : (r0 + r1) / 2 + (r0 > 0 ? 0 : r1 * 0.12);
        const text = labelString(s, i, num(s.vals[i]) ?? 0, frac, env);
        const el = labelEl(cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr, text, s.dLbls, env);
        if (el) labels.push(el);
      }
      a += sweep;
    }
  });
  return out.concat(labels);
}

// ---------- 复合饼图（子母饼 / 复合条饼） ----------

/** 按 c:splitType 决定哪些点落进次绘图区 */
function ofPieSecondary(g: PlotGroup, vals: number[]): Set<number> {
  const spec = g.ofPie;
  const out = new Set<number>();
  if (!spec || !vals.length) return out;
  const total = vals.reduce((a, b) => a + b, 0);
  switch (spec.splitType) {
    case 'val': {
      const th = spec.splitPos ?? 0;
      vals.forEach((v, i) => {
        if (v < th) out.add(i);
      });
      break;
    }
    case 'percent': {
      const th = (spec.splitPos ?? 0) / 100;
      vals.forEach((v, i) => {
        if (total > 0 && v / total < th) out.add(i);
      });
      break;
    }
    case 'custom':
      for (const i of spec.custSplit) if (i >= 0 && i < vals.length) out.add(i);
      break;
    default: {
      // pos / auto：末尾 n 个点进次图
      const n = clamp(Math.round(spec.splitPos ?? 2), 1, Math.max(vals.length - 1, 1));
      for (let i = Math.max(vals.length - n, 1); i < vals.length; i++) out.add(i);
    }
  }
  // 主饼至少要留一个真实扇区
  if (out.size >= vals.length) out.delete(0);
  return out;
}

/**
 * 主饼（含一个「其他」汇总扇区）+ 次饼 / 次条 + 两条连接线。
 * 次图放右侧，连接线从汇总扇区的两条边缘引到次图的上下缘。
 */
export function renderOfPie(g: PlotGroup, rect: Rect, env: PlotEnv): SlideElement[] {
  const s = g.series[0];
  const spec = g.ofPie;
  if (!s || !spec) return [];
  const vals = s.vals.map((v) => Math.abs(num(v) ?? 0));
  const total = vals.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return [];

  const second = ofPieSecondary(g, vals);
  const mainIdx = vals.map((_, i) => i).filter((i) => !second.has(i));
  const secIdx = vals.map((_, i) => i).filter((i) => second.has(i));
  const secSum = secIdx.reduce((a, i) => a + vals[i], 0);

  const anyLabel = labelVisible(s.dLbls);
  const gapX = rect.w * 0.08;
  const halfW = (rect.w - gapX) / 2;
  const r1 = Math.max(6, Math.min(halfW * (anyLabel ? 0.72 : 0.86), rect.h * (anyLabel ? 0.38 : 0.46)));
  const r2 = Math.max(4, Math.min(r1 * clamp(spec.secondSize, 5, 200) / 100, halfW * 0.86, rect.h * 0.46));
  const cy = rect.y + rect.h / 2;
  const cx1 = rect.x + halfW / 2;
  const cx2 = rect.x + halfW + gapX + halfW / 2;

  const out: SlideElement[] = [];
  const labels: SlideElement[] = [];
  const gray = mix(env.color, 'rgb(255,255,255)', 0.55);

  const pushLabel = (x: number, y: number, i: number | null, v: number): void => {
    if (!anyLabel) return;
    const text = i === null
      ? `其他 ${formatNumber(secSum / total, '0%')}`
      : labelString(s, i, v, total > 0 ? v / total : null, env);
    const el = labelEl(x, y, text, s.dLbls, env);
    if (el) labels.push(el);
  };

  // 主饼：真实扇区 + 末尾的汇总扇区
  const entries: Array<{ idx: number | null; v: number }> = mainIdx.map((i) => ({ idx: i, v: vals[i] }));
  if (secSum > 0) entries.push({ idx: null, v: secSum });
  let a = (clamp(g.firstSliceAng, 0, 360) - 90) * (Math.PI / 180);
  let joinA0 = 0;
  let joinA1 = 0;
  for (const e of entries) {
    const sweep = (e.v / total) * TAU;
    if (!(sweep > 0)) continue;
    const mid = a + sweep / 2;
    const fill = e.idx === null ? solid(gray) : pointFill(g, s, e.idx, env.ctx).fill;
    const stroke = e.idx === null ? null : pointStroke(s, e.idx, null, 0);
    out.push(shapeEl(cx1 - r1, cy - r1, r1 * 2, r1 * 2, sectorPath(r1, r1, 0, r1, a, a + sweep), fill, stroke));
    const lr = s.dLbls.pos === 'outEnd' || s.dLbls.pos === 'bestFit' ? r1 * 1.15 : r1 * 0.62;
    pushLabel(cx1 + Math.cos(mid) * lr, cy + Math.sin(mid) * lr, e.idx, e.v);
    if (e.idx === null) {
      joinA0 = a;
      joinA1 = a + sweep;
    }
    a += sweep;
  }

  // 次图：饼 或 堆叠条
  const secTotal = secSum > 0 ? secSum : 1;
  let boxTop = cy - r2;
  let boxBottom = cy + r2;
  let boxLeft = cx2 - r2;
  if (spec.type === 'bar') {
    const barW = Math.max(8, r2 * 0.9);
    const barH = Math.max(12, r2 * 2);
    boxTop = cy - barH / 2;
    boxBottom = cy + barH / 2;
    boxLeft = cx2 - barW / 2;
    let y = boxTop;
    for (const i of secIdx) {
      const hh = (vals[i] / secTotal) * barH;
      if (!(hh > 0)) continue;
      const { fill } = pointFill(g, s, i, env.ctx);
      out.push(shapeEl(boxLeft, y, barW, hh,
        `M 0 0 L ${nf(barW)} 0 L ${nf(barW)} ${nf(hh)} L 0 ${nf(hh)} Z`, fill, pointStroke(s, i, null, 0)));
      pushLabel(boxLeft + barW / 2, y + hh / 2, i, vals[i]);
      y += hh;
    }
  } else {
    let a2 = -Math.PI / 2;
    for (const i of secIdx) {
      const sweep = (vals[i] / secTotal) * TAU;
      if (!(sweep > 0)) continue;
      const mid = a2 + sweep / 2;
      const { fill } = pointFill(g, s, i, env.ctx);
      out.push(shapeEl(cx2 - r2, cy - r2, r2 * 2, r2 * 2, sectorPath(r2, r2, 0, r2, a2, a2 + sweep), fill, pointStroke(s, i, null, 0)));
      const lr = s.dLbls.pos === 'outEnd' || s.dLbls.pos === 'bestFit' ? r2 * 1.18 : r2 * 0.62;
      pushLabel(cx2 + Math.cos(mid) * lr, cy + Math.sin(mid) * lr, i, vals[i]);
      a2 += sweep;
    }
  }

  // 连接线：汇总扇区的两条边 → 次图上下缘
  if (spec.serLines !== false && secSum > 0) {
    const conn: Stroke = { color: mix(env.color, 'rgb(255,255,255)', 0.45), width: 1, dash: null };
    const p0: Pt = [cx1 + Math.cos(joinA0) * r1, cy + Math.sin(joinA0) * r1];
    const p1: Pt = [cx1 + Math.cos(joinA1) * r1, cy + Math.sin(joinA1) * r1];
    const top = p0[1] <= p1[1] ? p0 : p1;
    const bottom = p0[1] <= p1[1] ? p1 : p0;
    const a1El = lineEl(top[0], top[1], boxLeft, boxTop, conn);
    const b1El = lineEl(bottom[0], bottom[1], boxLeft, boxBottom, conn);
    if (a1El) out.push(a1El);
    if (b1El) out.push(b1El);
  }
  return out.concat(labels);
}

// ---------- 曲面图（俯视等高线着色） ----------

/** 由蓝到红的等高线色带（无 bandFmts 时的默认配色） */
const BAND_RAMP = [
  'rgb(49,84,163)', 'rgb(84,148,200)', 'rgb(160,208,224)', 'rgb(224,238,196)',
  'rgb(253,224,144)', 'rgb(244,146,74)', 'rgb(200,60,44)',
];

function rampColor(t: number): string {
  const x = clamp(t, 0, 1) * (BAND_RAMP.length - 1);
  const i = Math.min(Math.floor(x), BAND_RAMP.length - 2);
  return mix(BAND_RAMP[i], BAND_RAMP[i + 1], x - i);
}

export interface SurfaceFrame {
  rect: Rect;
  /** 值域下限 / 上限，用于色带分级 */
  min: number;
  max: number;
  /** 色带层数 */
  bands: number;
  fmt: string | null;
}

/**
 * 真三维曲面无法在本渲染器里表达，退化为「俯视等高线图」：
 * 横向为类目、纵向为系列（深度方向），单元格按值落入的色带着色，右侧给出色带图例。
 */
export function renderSurface(g: PlotGroup, f: SurfaceFrame, env: PlotEnv): SlideElement[] {
  const rows = g.series.length;
  const cols = g.series.reduce((a, s) => Math.max(a, s.vals.length), 0);
  if (!rows || !cols) return [];

  const legendW = Math.min(f.rect.w * 0.16, env.size * 7);
  const labelW = Math.min(f.rect.w * 0.2, Math.max(env.size * 4, measure(longest(g.series.map((s) => s.name)), env.size) + env.size));
  const labelH = lineH(env.size) * 1.2;
  const gridX = f.rect.x + labelW;
  const gridY = f.rect.y;
  const gridW = Math.max(f.rect.w - labelW - legendW - env.size, 12);
  const gridH = Math.max(f.rect.h - labelH, 12);
  const cw = gridW / cols;
  const ch = gridH / rows;
  const span = f.max - f.min || 1;

  const out: SlideElement[] = [];
  const cellStroke: Stroke = { color: 'rgba(255,255,255,0.75)', width: 0.75, dash: null };
  g.series.forEach((s, ri) => {
    // 第一个系列画在最下方，与 3D 曲面的深度方向一致
    const y = gridY + gridH - (ri + 1) * ch;
    for (let ci = 0; ci < cols; ci++) {
      const v = num(s.vals[ci]);
      if (v === null) continue;
      const t = (v - f.min) / span;
      const band = clamp(Math.floor(t * f.bands), 0, f.bands - 1);
      const fill = g.bandFills.get(band) ?? solid(rampColor(f.bands > 1 ? band / (f.bands - 1) : t));
      out.push(rectEl({ x: gridX + ci * cw, y, w: cw, h: ch }, fill, cellStroke));
    }
    out.push(textEl(f.rect.x, y + ch / 2 - labelH / 2, Math.max(labelW - env.size * 0.4, 8), labelH, s.name, {
      size: env.size, color: env.color, align: 'right', anchor: 'middle', fonts: env.fonts,
    }));
  });

  // 类目标签
  for (let ci = 0; ci < cols && ci < env.cats.length; ci++) {
    out.push(textEl(gridX + ci * cw, gridY + gridH, cw, labelH, env.cats[ci], {
      size: env.size, color: env.color, align: 'center', anchor: 'middle', fonts: env.fonts,
    }));
  }

  // 色带图例
  const barW = Math.min(env.size * 1.1, legendW * 0.35);
  const barX = gridX + gridW + env.size * 0.6;
  const barH = gridH * 0.9;
  const barY = gridY + (gridH - barH) / 2;
  const step = barH / f.bands;
  for (let b = 0; b < f.bands; b++) {
    const fill = g.bandFills.get(b) ?? solid(rampColor(f.bands > 1 ? b / (f.bands - 1) : 0.5));
    out.push(rectEl({ x: barX, y: barY + barH - (b + 1) * step, w: barW, h: step }, fill, null));
    out.push(
      textEl(barX + barW + env.size * 0.3, barY + barH - (b + 1) * step - lineH(env.size * 0.85) / 2,
        legendW, lineH(env.size * 0.85), formatNumber(f.min + ((b + 1) * span) / f.bands, f.fmt), {
          size: env.size * 0.85, color: env.color, align: 'left', anchor: 'middle', fonts: env.fonts,
        }),
    );
  }
  return out;
}

const longest = (list: string[]): string => list.reduce((a, b) => (b.length > a.length ? b : a), '');

// ---------- 雷达图 ----------

export interface RadarFrame {
  cx: number;
  cy: number;
  radius: number;
  /** 值 → 半径比例（0-1） */
  norm: (v: number) => number;
  /** 类目索引 → 角度（弧度，从正上方顺时针） */
  angle: (i: number) => number;
  count: number;
}

/** 极坐标取点 */
function radarPt(f: RadarFrame, i: number, v: number): Pt {
  const a = f.angle(i);
  const r = f.radius * f.norm(v);
  return [f.cx + r * Math.sin(a), f.cy - r * Math.cos(a)];
}

/**
 * 雷达网格：同心多边形（`radarStyle` 为 filled 时用同心圆更贴近 PowerPoint）
 * + 从圆心指向各类目的辐条 + 类目标签。
 */
export function renderRadarGrid(
  f: RadarFrame,
  ticks: number[],
  env: PlotEnv,
  gridStroke: Stroke | null,
  axisStroke: Stroke | null,
  labelFmt: (v: number) => string,
): SlideElement[] {
  const out: SlideElement[] = [];
  if (f.count < 3) return out;

  for (const t of ticks) {
    const ring: Pt[] = [];
    for (let i = 0; i < f.count; i++) ring.push(radarPt(f, i, t));
    const el = polyEl([ring], null, gridStroke, true);
    if (el) out.push(el);
  }

  for (let i = 0; i < f.count; i++) {
    const a = f.angle(i);
    const spoke = lineEl(f.cx, f.cy, f.cx + f.radius * Math.sin(a), f.cy - f.radius * Math.cos(a), axisStroke);
    if (spoke) out.push(spoke);
  }

  // 类目标签沿外圈摆放，按象限决定对齐方式避免压到图形
  const lh = env.size * 1.4;
  for (let i = 0; i < f.count && i < env.cats.length; i++) {
    const a = f.angle(i);
    const gap = env.size * 0.9;
    const px = f.cx + (f.radius + gap) * Math.sin(a);
    const py = f.cy - (f.radius + gap) * Math.cos(a);
    const sin = Math.sin(a);
    const align: 'left' | 'center' | 'right' = sin > 0.2 ? 'left' : sin < -0.2 ? 'right' : 'center';
    const boxW = Math.max(env.size * 6, 30);
    const x = align === 'left' ? px : align === 'right' ? px - boxW : px - boxW / 2;
    out.push(textEl(x, py - lh / 2, boxW, lh, env.cats[i], {
      size: env.size, color: env.color, align, fonts: env.fonts,
    }));
  }

  // 数值刻度沿正上方那条辐条标注
  for (const t of ticks) {
    if (t === 0) continue;
    const [tx, ty] = radarPt(f, 0, t);
    out.push(textEl(tx + 2, ty - lh / 2, env.size * 5, lh, labelFmt(t), {
      size: env.size * 0.9, color: env.color, align: 'left', fonts: env.fonts,
    }));
  }
  return out;
}

/** 雷达数据：每个系列一条闭合折线，filled 样式额外填充 */
export function renderRadar(g: PlotGroup, f: RadarFrame, env: PlotEnv): SlideElement[] {
  const out: SlideElement[] = [];
  const overlay: SlideElement[] = [];
  const filled = g.radarStyle === 'filled';
  const withMarker = g.radarStyle === 'marker';

  g.series.forEach((s, si) => {
    const { fill, color } = pointFill(g, s, 0, env.ctx);
    const pts: Pt[] = [];
    for (let i = 0; i < f.count; i++) {
      const v = s.vals[i];
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      pts.push(radarPt(f, i, v));
    }
    if (pts.length < 2) return;

    const stroke: Stroke = strokeFrom(s.ln, color, 2) ?? { color, width: 2, dash: null };
    const area = filled
      ? (fill.type === 'solid' ? { type: 'solid' as const, color: withAlpha(fill.color, 0.45) } : fill)
      : null;
    const el = polyEl([pts], area, stroke, true);
    if (el) out.push(el);

    if (withMarker) {
      const sym = markerSymbol(g, s, si);
      for (const [x, y] of pts) {
        const m = markerEl(x, y, sym, s, color);
        if (m) overlay.push(m);
      }
    }
  });

  return out.concat(overlay);
}

/** 给 css 颜色加透明度 */
function withAlpha(color: string, alpha: number): string {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return color;
  const p = m[1].split(',').map((v) => Number(v.trim()));
  return `rgba(${p[0] || 0},${p[1] || 0},${p[2] || 0},${alpha})`;
}
