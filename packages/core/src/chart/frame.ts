/**
 * 图表框架层：数值轴分级、绘图区留白计算、网格线 / 轴线 / 刻度标签 / 轴标题的生成。
 * 只依赖 model.ts + util.ts，不认识具体图形（柱/线/饼由 plots.ts 负责）。
 */
import type { ShapeElement, SlideElement } from '../types';
import type { Axis, ChartModel, PlotGroup, View3D } from './model';
import { isStacked } from './model';
import {
  Depth3D, Pt, Rect, Scale, clamp, formatNumber, lineEl, measure, mix, niceScale, quadEl,
  solid, strokeFrom, textEl, tickValues,
} from './util';

export type Side = 'l' | 'r' | 'b' | 't';

/** 一条轴的「已解算」视图：分级 / 刻度文本 / 显示样式 */
export interface AxisView {
  axis: Axis;
  side: Side;
  /** 数值轴的分级；类目轴为 null */
  scale: Scale | null;
  /** 数值轴：刻度值；类目轴：类目下标 */
  ticks: number[];
  labels: string[];
  /** 类目轴：类目落在带中心（crossBetween=between） */
  between: boolean;
  catCount: number;
  size: number;
  color: string;
}

/** 类目 × 数值 的映射（柱/条/线/面积） */
export interface Cartesian {
  rect: Rect;
  /** 值沿水平方向（条形图 barDir=bar） */
  horizontal: boolean;
  catView: AxisView;
  valView: AxisView;
  band: number;
  /** 类目 i 的中心（沿类目方向的坐标） */
  cat: (i: number) => number;
  /** 第 i 条类目边界 */
  edge: (i: number) => number;
  /** 值 v 的坐标（沿值方向） */
  val: (v: number) => number;
  /** 把值裁进轴范围，避免溢出绘图区 */
  clampVal: (v: number) => number;
  /** 值 0（裁进轴范围）对应的坐标 */
  zero: number;
  /** (类目坐标, 值坐标) → (x, y) */
  pt: (c: number, v: number) => Pt;
}

/** 数值 × 数值 的映射（散点） */
export interface XYPlot {
  rect: Rect;
  x: (v: number) => number;
  y: (v: number) => number;
  clampX: (v: number) => number;
  clampY: (v: number) => number;
}

/** 轴渲染需要的统一视角：横轴 + 纵轴，与图种无关 */
export interface Grid {
  rect: Rect;
  hAxis: AxisView;
  vAxis: AxisView;
  /** 横轴第 i 个刻度/类目的 x */
  hPos: (i: number) => number;
  /** 纵轴第 i 个刻度/类目的 y */
  vPos: (i: number) => number;
  /** 横轴网格线位置（类目轴用边界），null 表示用 hPos */
  hEdge: ((i: number) => number) | null;
  hEdgeCount: number;
  vEdge: ((i: number) => number) | null;
  vEdgeCount: number;
  /** 横轴线的 y */
  hLineAt: number;
  /** 纵轴线的 x */
  vLineAt: number;
  /** 横轴标签是否需要换行（类目过密） */
  hWrap: boolean;
  hBand: number;
  /** 非 null 时网格线画到背面平面，并用连接段勾出「地面 + 背墙」 */
  depth: Depth3D | null;
}

export interface Insets {
  l: number;
  r: number;
  t: number;
  b: number;
}

// ---------- 尺寸常量 ----------

export const lineH = (size: number): number => size * 1.4;
export const wrapH = (size: number): number => size * 2.9;
export const labelBoxW = (s: string, size: number): number => measure(s, size) + size * 0.5;

export function maxLabelW(v: AxisView): number {
  let m = 0;
  for (const s of v.labels) {
    const w = labelBoxW(s, v.size);
    if (w > m) m = w;
  }
  return m;
}

const showTicks = (v: AxisView): boolean => !v.axis.del && v.axis.tickLblPos !== 'none';

// ---------- 伪 3D ----------

/** 深度基准：绘图区高度的 8% */
const DEPTH_RATIO = 0.08;

/**
 * 由 c:view3D 线性近似出深度向量。rotY 决定左右偏移，rotX 决定上下偏移，
 * 默认视角（rotX=15, rotY=20）给出「背面偏右上」的等轴测观感。
 */
export function depthOf(v: View3D | null, rect: Rect): Depth3D {
  const base = Math.max(Math.min(rect.h, rect.w * 1.2) * DEPTH_RATIO, 6);
  const rx = clamp(v ? v.rotX : 15, -60, 60);
  const ry = clamp(v ? v.rotY : 20, -90, 90);
  const scale = clamp((v ? v.depthPercent : 100) / 100, 0.2, 3);
  const dx = base * clamp(ry / 20, -2, 2) * scale;
  const dy = -base * clamp(rx / 20, -2, 2) * scale;
  // 完全正视（rotX=rotY=0）时给一点点偏移，否则立体块退化成纯矩形
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return { dx: base * 0.5, dy: -base * 0.4 };
  return { dx, dy };
}

/** 为深度方向预留空间：背面平面必须仍落在 region 内 */
export function reserveDepth(rect: Rect, d: Depth3D): Rect {
  const ox = Math.abs(d.dx);
  const oy = Math.abs(d.dy);
  return {
    x: rect.x + (d.dx < 0 ? ox : 0),
    y: rect.y + (d.dy < 0 ? oy : 0),
    w: Math.max(rect.w - ox, 8),
    h: Math.max(rect.h - oy, 8),
  };
}

/** 「地面 + 背墙 + 侧墙」浅色底板，画在网格线与数据之前 */
export function floor3D(rect: Rect, d: Depth3D, base: string): ShapeElement[] {
  const out: ShapeElement[] = [];
  const x0 = rect.x;
  const x1 = rect.x + rect.w;
  const y0 = rect.y;
  const y1 = rect.y + rect.h;
  const wall = solid(mix(base, '#ffffff', 0.93));
  const floor = solid(mix(base, '#ffffff', 0.86));
  const side = solid(mix(base, '#ffffff', 0.89));
  const push = (pts: Pt[], f: ReturnType<typeof solid>): void => {
    const el = quadEl(pts, f, null);
    if (el) out.push(el);
  };
  // 背墙
  push([[x0 + d.dx, y0 + d.dy], [x1 + d.dx, y0 + d.dy], [x1 + d.dx, y1 + d.dy], [x0 + d.dx, y1 + d.dy]], wall);
  // 侧墙（dx>0 时看到左侧墙）
  const sx = d.dx >= 0 ? x0 : x1;
  push([[sx, y0], [sx + d.dx, y0 + d.dy], [sx + d.dx, y1 + d.dy], [sx, y1]], side);
  // 地面（dy<0 俯视看到底面）
  const fy = d.dy <= 0 ? y1 : y0;
  push([[x0, fy], [x1, fy], [x1 + d.dx, fy + d.dy], [x0 + d.dx, fy + d.dy]], floor);
  return out;
}

// ---------- 值域 ----------

export interface Extent {
  lo: number;
  hi: number;
}

function pad(e: Extent): Extent {
  if (e.lo !== e.hi) return e;
  if (e.lo === 0) return { lo: 0, hi: 1 };
  const d = Math.abs(e.lo) * 0.2;
  return { lo: e.lo - d, hi: e.hi + d };
}

/** 跨图组求数值轴范围；堆叠按累计值，百分比堆叠固定 0-1 */
export function valueExtent(groups: PlotGroup[]): Extent {
  let lo = Infinity;
  let hi = -Infinity;
  let baseline = false;
  const push = (v: number): void => {
    if (!Number.isFinite(v)) return;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  };
  for (const g of groups) {
    if (g.kind === 'bar' || g.kind === 'area') baseline = true;
    if (g.grouping === 'percentStacked') {
      let neg = false;
      let pos = false;
      for (const s of g.series) {
        for (const v of s.vals) {
          if (v === null) continue;
          if (v < 0) neg = true;
          else if (v > 0) pos = true;
        }
      }
      push(0);
      if (pos || !neg) push(1);
      if (neg) push(-1);
    } else if (isStacked(g)) {
      let n = 0;
      for (const s of g.series) n = Math.max(n, s.vals.length);
      for (let i = 0; i < n; i++) {
        let p = 0;
        let m = 0;
        for (const s of g.series) {
          const v = s.vals[i];
          if (v === null || v === undefined || !Number.isFinite(v)) continue;
          if (v >= 0) p += v;
          else m += v;
        }
        push(p);
        push(m);
      }
    } else {
      for (const s of g.series) for (const v of s.vals) if (v !== null) push(v);
    }
  }
  if (lo === Infinity) return { lo: 0, hi: 1 };
  if (baseline) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  return pad({ lo, hi });
}

/** 散点 X 值域；缺 xVal 时退化为 1..n */
export function xExtent(groups: PlotGroup[]): Extent {
  let lo = Infinity;
  let hi = -Infinity;
  for (const g of groups) {
    for (const s of g.series) {
      if (s.xs) {
        for (const v of s.xs) {
          if (v === null || !Number.isFinite(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      } else if (s.vals.length) {
        lo = Math.min(lo, 1);
        hi = Math.max(hi, s.vals.length);
      }
    }
  }
  if (lo === Infinity) return { lo: 0, hi: 1 };
  return pad({ lo, hi });
}

// ---------- 分级 ----------

function makeScale(e: Extent, ax: Axis, target: number): Scale {
  const auto = niceScale(e.lo, e.hi, target);
  let min = ax.min !== null && Number.isFinite(ax.min) ? ax.min : auto.min;
  let max = ax.max !== null && Number.isFinite(ax.max) ? ax.max : auto.max;
  if (max < min) [min, max] = [max, min];
  let step = ax.majorUnit !== null && Number.isFinite(ax.majorUnit) ? ax.majorUnit : auto.step;
  if (max === min) max = min + Math.abs(step) || min + 1;
  if (!(step > 0)) step = (max - min) / Math.max(1, target);
  if (!(step > 0)) step = 1;
  while ((max - min) / step > 100) step *= 2;
  return { min, max, step };
}

/** 依据可用长度估算合适的刻度数 */
export const tickTarget = (len: number, size: number): number =>
  Math.round(clamp(len / Math.max(size * 3.2, 1), 2, 12));

export function makeValueView(
  ax: Axis,
  side: Side,
  e: Extent,
  target: number,
  fallbackFmt: string | null,
  m: ChartModel,
): AxisView {
  const scale = makeScale(e, ax, target);
  const ticks = tickValues(scale);
  const fmt = ax.fmt ?? fallbackFmt;
  return {
    axis: ax,
    side,
    scale,
    ticks,
    labels: ticks.map((t) => formatNumber(t, fmt)),
    between: false,
    catCount: ticks.length,
    size: ax.lblSize ?? m.textSize,
    color: ax.lblColor ?? m.textColor,
  };
}

export function makeCatView(ax: Axis, side: Side, cats: string[], between: boolean, m: ChartModel): AxisView {
  return {
    axis: ax,
    side,
    scale: null,
    ticks: cats.map((_, i) => i),
    labels: cats.slice(),
    between,
    catCount: cats.length,
    size: ax.lblSize ?? m.textSize,
    color: ax.lblColor ?? m.textColor,
  };
}

// ---------- 映射 ----------

export function makeCartesian(
  rect: Rect,
  horizontal: boolean,
  catView: AxisView,
  valView: AxisView,
): Cartesian {
  const catLen = horizontal ? rect.h : rect.w;
  const n = Math.max(catView.catCount, 1);
  const band = catView.between ? catLen / n : n > 1 ? catLen / (n - 1) : catLen;
  const rev = catView.axis.reversed;
  const along = (off: number): number => {
    const o = rev ? catLen - off : off;
    // 条形图第一类目在下方；柱状图第一类目在左侧
    return horizontal ? rect.y + rect.h - o : rect.x + o;
  };
  const cat = (i: number): number => along(catView.between ? (i + 0.5) * band : i * band);
  const edge = (i: number): number => along(i * band);

  const s = valView.scale ?? { min: 0, max: 1, step: 1 };
  const span = s.max - s.min || 1;
  const valRev = valView.axis.reversed;
  const val = (v: number): number => {
    let t = (v - s.min) / span;
    if (!Number.isFinite(t)) t = 0;
    if (valRev) t = 1 - t;
    return horizontal ? rect.x + t * rect.w : rect.y + rect.h - t * rect.h;
  };
  const clampVal = (v: number): number => (Number.isFinite(v) ? clamp(v, s.min, s.max) : s.min);
  const pt = (c: number, v: number): Pt => (horizontal ? [v, c] : [c, v]);
  return { rect, horizontal, catView, valView, band, cat, edge, val, clampVal, zero: val(clampVal(0)), pt };
}

export function makeXY(rect: Rect, xView: AxisView, yView: AxisView): XYPlot {
  const sx = xView.scale ?? { min: 0, max: 1, step: 1 };
  const sy = yView.scale ?? { min: 0, max: 1, step: 1 };
  const spanX = sx.max - sx.min || 1;
  const spanY = sy.max - sy.min || 1;
  return {
    rect,
    x: (v) => {
      let t = (v - sx.min) / spanX;
      if (!Number.isFinite(t)) t = 0;
      if (xView.axis.reversed) t = 1 - t;
      return rect.x + t * rect.w;
    },
    y: (v) => {
      let t = (v - sy.min) / spanY;
      if (!Number.isFinite(t)) t = 0;
      if (yView.axis.reversed) t = 1 - t;
      return rect.y + rect.h - t * rect.h;
    },
    clampX: (v) => (Number.isFinite(v) ? clamp(v, sx.min, sx.max) : sx.min),
    clampY: (v) => (Number.isFinite(v) ? clamp(v, sy.min, sy.max) : sy.min),
  };
}

// ---------- 留白 ----------

/** 绘图区四周为轴标签 / 轴标题预留的空间；extra 为次值轴 */
export function axisInsets(
  m: ChartModel,
  hAxis: AxisView,
  vAxis: AxisView,
  hWrap: boolean,
  extra: AxisView | null = null,
): Insets {
  const gap = m.textSize * 0.45;
  const titleH = lineH(m.textSize * 1.05) + gap * 0.6;
  const ins: Insets = { l: m.textSize * 0.4, r: m.textSize * 0.8, t: m.textSize * 0.8, b: m.textSize * 0.3 };

  if (showTicks(vAxis)) {
    const w = maxLabelW(vAxis) + gap;
    if (vAxis.side === 'r') ins.r += w;
    else ins.l += w;
  }
  if (vAxis.axis.title) {
    if (vAxis.side === 'r') ins.r += titleH;
    else ins.l += titleH;
  }
  if (extra) {
    const along: 'l' | 'r' | 't' | 'b' = extra.side;
    if (showTicks(extra)) {
      const room = along === 't' || along === 'b' ? lineH(extra.size) + gap : maxLabelW(extra) + gap;
      ins[along] += room;
    }
    if (extra.axis.title) ins[along] += titleH;
  }
  if (showTicks(hAxis)) {
    const h = (hWrap ? wrapH(hAxis.size) : lineH(hAxis.size)) + gap;
    if (hAxis.side === 't') ins.t += h;
    else ins.b += h;
    // 数值型横轴的首尾标签会超出绘图区，两侧各留半个标签宽
    if (hAxis.scale) {
      const half = maxLabelW(hAxis) / 2;
      ins.l += half;
      ins.r += half;
    }
  }
  if (hAxis.axis.title) {
    if (hAxis.side === 't') ins.t += titleH;
    else ins.b += titleH;
  }
  return ins;
}

export function shrink(region: Rect, ins: Insets): Rect {
  const maxW = region.w * 0.72;
  const maxH = region.h * 0.72;
  let { l, r, t, b } = ins;
  if (l + r > maxW) {
    const k = maxW / (l + r);
    l *= k;
    r *= k;
  }
  if (t + b > maxH) {
    const k = maxH / (t + b);
    t *= k;
    b *= k;
  }
  return {
    x: region.x + l,
    y: region.y + t,
    w: Math.max(region.w - l - r, 8),
    h: Math.max(region.h - t - b, 8),
  };
}

// ---------- 渲染 ----------

/** 一条网格线；有深度时画在背面平面上 */
function gridLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  d: Depth3D | null,
  stroke: ReturnType<typeof strokeFrom>,
): ShapeElement[] {
  const ox = d ? d.dx : 0;
  const oy = d ? d.dy : 0;
  const el = lineEl(x1 + ox, y1 + oy, x2 + ox, y2 + oy, stroke);
  return el ? [el] : [];
}

export function renderAxes(m: ChartModel, g: Grid, fonts: string[]): SlideElement[] {
  const out: SlideElement[] = [];
  const { rect, hAxis, vAxis } = g;
  const gridColor = mix(m.textColor, '#ffffff', 0.78);
  const axisColor = mix(m.textColor, '#ffffff', 0.45);
  const gap = m.textSize * 0.45;

  // 网格线：纵轴的网格线是水平的，横轴的是竖直的；3D 时移到背面平面并补一段侧墙/地面连接线
  const d = g.depth;
  const vGrid = vAxis.axis.majorGrid ? strokeFrom(vAxis.axis.majorGrid, gridColor, 1) : null;
  if (vGrid) {
    const at = g.vEdge ?? g.vPos;
    const n = g.vEdge ? g.vEdgeCount : vAxis.ticks.length;
    const anchorX = d && d.dx < 0 ? rect.x + rect.w : rect.x;
    for (let i = 0; i < n; i++) {
      const y = at(i);
      out.push(...gridLine(rect.x, y, rect.x + rect.w, y, d, vGrid));
      if (d) {
        const el = lineEl(anchorX, y, anchorX + d.dx, y + d.dy, vGrid);
        if (el) out.push(el);
      }
    }
  }
  const hGrid = hAxis.axis.majorGrid ? strokeFrom(hAxis.axis.majorGrid, gridColor, 1) : null;
  if (hGrid) {
    const at = g.hEdge ?? g.hPos;
    const n = g.hEdge ? g.hEdgeCount : hAxis.ticks.length;
    const anchorY = d && d.dy > 0 ? rect.y : rect.y + rect.h;
    for (let i = 0; i < n; i++) {
      const x = at(i);
      out.push(...gridLine(x, rect.y, x, rect.y + rect.h, d, hGrid));
      if (d) {
        const el = lineEl(x, anchorY, x + d.dx, anchorY + d.dy, hGrid);
        if (el) out.push(el);
      }
    }
  }

  // 轴线
  if (!hAxis.axis.del) {
    const s = strokeFrom(hAxis.axis.line, axisColor, 1);
    const el = s ? lineEl(rect.x, g.hLineAt, rect.x + rect.w, g.hLineAt, s) : null;
    if (el) out.push(el);
  }
  if (!vAxis.axis.del) {
    const s = strokeFrom(vAxis.axis.line, axisColor, 1);
    const el = s ? lineEl(g.vLineAt, rect.y, g.vLineAt, rect.y + rect.h, s) : null;
    if (el) out.push(el);
  }

  // 横轴刻度标签
  let hLblSpace = 0;
  if (showTicks(hAxis)) {
    const size = hAxis.size;
    const boxH = g.hWrap ? wrapH(size) : lineH(size);
    hLblSpace = boxH + gap;
    const top = hAxis.side === 't' ? rect.y - gap - boxH : rect.y + rect.h + gap;
    for (let i = 0; i < hAxis.labels.length; i++) {
      const label = hAxis.labels[i];
      if (!label) continue;
      const boxW = g.hWrap ? Math.max(g.hBand * 0.98, size * 2) : labelBoxW(label, size);
      const el = textEl(g.hPos(i) - boxW / 2, top, boxW, boxH, label, {
        size,
        color: hAxis.color,
        align: 'center',
        anchor: hAxis.side === 't' ? 'bottom' : 'top',
        fonts,
      });
      if (g.hWrap && el.text) el.text.wrap = true;
      out.push(el);
    }
  }

  // 纵轴刻度标签
  let vLblSpace = 0;
  if (showTicks(vAxis)) {
    const size = vAxis.size;
    const boxH = lineH(size);
    vLblSpace = maxLabelW(vAxis) + gap;
    for (let i = 0; i < vAxis.labels.length; i++) {
      const label = vAxis.labels[i];
      if (!label) continue;
      const boxW = labelBoxW(label, size);
      const x = vAxis.side === 'r' ? rect.x + rect.w + gap : rect.x - gap - boxW;
      out.push(
        textEl(x, g.vPos(i) - boxH / 2, boxW, boxH, label, {
          size,
          color: vAxis.color,
          align: vAxis.side === 'r' ? 'left' : 'right',
          anchor: 'middle',
          fonts,
        }),
      );
    }
  }

  // 轴标题
  const tSize = m.textSize * 1.05;
  const tBox = lineH(tSize);
  if (hAxis.axis.title) {
    const y = hAxis.side === 't' ? rect.y - hLblSpace - gap - tBox : rect.y + rect.h + hLblSpace + gap * 0.4;
    out.push(
      textEl(rect.x, y, rect.w, tBox, hAxis.axis.title, {
        size: tSize,
        color: m.textColor,
        align: 'center',
        anchor: 'middle',
        fonts,
      }),
    );
  }
  if (vAxis.axis.title) {
    const cx =
      vAxis.side === 'r'
        ? rect.x + rect.w + vLblSpace + gap * 0.4 + tBox / 2
        : rect.x - vLblSpace - gap * 0.4 - tBox / 2;
    const cy = rect.y + rect.h / 2;
    out.push(
      textEl(cx - rect.h / 2, cy - tBox / 2, rect.h, tBox, vAxis.axis.title, {
        size: tSize,
        color: m.textColor,
        align: 'center',
        anchor: 'middle',
        fonts,
        rot: vAxis.side === 'r' ? 90 : -90,
      }),
    );
  }
  return out;
}

/** 次坐标轴（与主轴共用绘图区，画在对侧）的绘制参数 */
export interface SideAxisSpec {
  rect: Rect;
  view: AxisView;
  /** 刻度 i 沿轴方向的坐标（l/r 给 y，t/b 给 x） */
  pos: (i: number) => number;
  /** 轴线所在的另一维坐标 */
  at: number;
  /** 是否由次轴负责画网格线 */
  grid: boolean;
  depth: Depth3D | null;
}

/** 画一条独立坐标轴：网格线 + 轴线 + 刻度标签 + 轴标题 */
export function renderSideAxis(m: ChartModel, sp: SideAxisSpec, fonts: string[]): SlideElement[] {
  const out: SlideElement[] = [];
  const { rect, view } = sp;
  const vertical = view.side === 'l' || view.side === 'r';
  const gridColor = mix(m.textColor, '#ffffff', 0.78);
  const axisColor = mix(m.textColor, '#ffffff', 0.45);
  const gap = m.textSize * 0.45;

  if (sp.grid && view.axis.majorGrid) {
    const stroke = strokeFrom(view.axis.majorGrid, gridColor, 1);
    for (let i = 0; i < view.ticks.length; i++) {
      const p = sp.pos(i);
      out.push(
        ...(vertical
          ? gridLine(rect.x, p, rect.x + rect.w, p, sp.depth, stroke)
          : gridLine(p, rect.y, p, rect.y + rect.h, sp.depth, stroke)),
      );
    }
  }

  if (!view.axis.del) {
    const s = strokeFrom(view.axis.line, axisColor, 1);
    const el = vertical
      ? lineEl(sp.at, rect.y, sp.at, rect.y + rect.h, s)
      : lineEl(rect.x, sp.at, rect.x + rect.w, sp.at, s);
    if (el) out.push(el);
  }

  const size = view.size;
  const boxH = lineH(size);
  let space = 0;
  if (showTicks(view)) {
    space = vertical ? maxLabelW(view) + gap : boxH + gap;
    for (let i = 0; i < view.labels.length; i++) {
      const label = view.labels[i];
      if (!label) continue;
      const boxW = labelBoxW(label, size);
      if (vertical) {
        const x = view.side === 'r' ? rect.x + rect.w + gap : rect.x - gap - boxW;
        out.push(
          textEl(x, sp.pos(i) - boxH / 2, boxW, boxH, label, {
            size,
            color: view.color,
            align: view.side === 'r' ? 'left' : 'right',
            anchor: 'middle',
            fonts,
          }),
        );
      } else {
        const y = view.side === 't' ? rect.y - gap - boxH : rect.y + rect.h + gap;
        out.push(
          textEl(sp.pos(i) - boxW / 2, y, boxW, boxH, label, {
            size,
            color: view.color,
            align: 'center',
            anchor: view.side === 't' ? 'bottom' : 'top',
            fonts,
          }),
        );
      }
    }
  }

  if (view.axis.title) {
    const tSize = m.textSize * 1.05;
    const tBox = lineH(tSize);
    if (vertical) {
      const cx =
        view.side === 'r'
          ? rect.x + rect.w + space + gap * 0.4 + tBox / 2
          : rect.x - space - gap * 0.4 - tBox / 2;
      out.push(
        textEl(cx - rect.h / 2, rect.y + rect.h / 2 - tBox / 2, rect.h, tBox, view.axis.title, {
          size: tSize,
          color: m.textColor,
          align: 'center',
          anchor: 'middle',
          fonts,
          rot: view.side === 'r' ? 90 : -90,
        }),
      );
    } else {
      const y = view.side === 't' ? rect.y - space - gap - tBox : rect.y + rect.h + space + gap * 0.4;
      out.push(
        textEl(rect.x, y, rect.w, tBox, view.axis.title, {
          size: tSize,
          color: m.textColor,
          align: 'center',
          anchor: 'middle',
          fonts,
        }),
      );
    }
  }
  return out;
}

/** 类目标签总宽超过带宽时启用换行 */
export function needWrap(view: AxisView, band: number): boolean {
  if (!showTicks(view) || view.scale) return false;
  return maxLabelW(view) > band * 1.02;
}
