/**
 * 图表分析元素的绘制：趋势线（六种拟合）、误差线（五类取值）与数据表。
 * 只消费 model.ts 的规格与 frame.ts 的坐标映射，产出统一 SlideElement[]；
 * 编排（挂在哪些图组之后、占多宽表带）由 index.ts 决定。
 */
import type { SlideElement } from '../types';
import { isStacked } from './model';
import type { ChartModel, ErrBarsSpec, PlotGroup, Series, TrendlineSpec } from './model';
import type { Cartesian } from './frame';
import { lineH } from './frame';
import type { PlotEnv } from './plot-marks';
import { markerEl, markerSymbol, pointFill } from './plot-marks';
import { Pt, formatNumber, lineEl, measure, mix, polyEl, px, rectEl, strokeFrom, textEl } from './util';

export const _probeInternals = { fitTrend, sampleFit };
// ---------- 坐标适配 ----------

/**
 * 数据坐标 → 屏幕坐标：类目图 x 为 1..n（PowerPoint 口径），散点为实际 x 值。
 * 条形图（barDir=bar）的类目轴是竖直的，适配器负责把数据 x 映到屏幕 y；
 * left/right/top/bottom 始终是屏幕坐标的绘图区边界，用于把趋势线裁剪齐。
 */
export interface AnalysisMap {
  pt: (x: number, v: number) => Pt;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// ---------- 拟合 ----------

interface Fit {
  /** y = b·x + a（linear / exponential / logarithmic / power 统一的两参形态） */
  ab: { a: number; b: number } | null;
  /** poly 升幂系数 */
  coeffs: number[] | null;
  /** movingAvg 按类目下标（0 基）的滑动均值 */
  points: (number | null)[] | null;
  r2: number | null;
  /** 有效 x 数据范围（不含 forward/backward 延伸） */
  lo: number;
  hi: number;
}

/** 最小二乘 y = b·x + a */
function lstsq(xs: number[], ys: number[]): { a: number; b: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const d = n * sxx - sx * sx;
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  const b = (n * sxy - sx * sy) / d;
  const a = (sy - b * sx) / n;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { a, b };
}

/** 高斯消元（部分主元）解线性方程组 */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[piv][col])) piv = row;
    if (Math.abs(a[piv][col]) < 1e-12) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const k = a[row][col] / a[col][col];
      for (let j = col; j <= n; j++) a[row][j] -= k * a[col][j];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

/** movingAvg 没有公式与 R²（PowerPoint 同口径不提供） */
const hasEquation = (t: TrendlineSpec): boolean => t.kind !== 'movingAvg';

/** 统一求值入口；返回 null 表示该 x 处无定义（对数 / 幂的负数域等） */
function evalFit(t: TrendlineSpec, f: Fit, x: number): number | null {
  if (f.ab) {
    const { a, b } = f.ab;
    switch (t.kind) {
      case 'linear':
        return (t.intercept ?? a) + b * x;
      case 'exponential':
        return a * Math.exp(b * x);
      case 'logarithmic':
        return x > 0 ? a + b * Math.log(x) : null;
      case 'power':
        return x > 0 ? a * x ** b : null;
      default:
        return null;
    }
  }
  if (f.coeffs) return f.coeffs.reduce((s, c, k) => s + c * x ** k, 0);
  return null;
}

/** 原始域上的 R²（拟合值对原值）；退化时 null。指数 / 对数 / 幂与 PowerPoint 的线性化口径有微小差异，对照时按归因记录 */
function r2Of(pts: { x: number; y: number }[], t: TrendlineSpec, f: Fit): number | null {
  let mean = 0,
    n = 0;
  for (const p of pts) {
    mean += p.y;
    n++;
  }
  if (n < 2) return null;
  mean /= n;
  let ssRes = 0,
    ssTot = 0;
  for (const p of pts) {
    const fitted = evalFit(t, f, p.x);
    if (fitted === null || !Number.isFinite(fitted)) return null;
    ssRes += (p.y - fitted) ** 2;
    ssTot += (p.y - mean) ** 2;
  }
  if (ssTot < 1e-12) return null;
  return Math.max(0, Math.min(1, 1 - ssRes / ssTot));
}

const finitePts = (pts: { x: number; y: number }[]): { x: number; y: number }[] =>
  pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

/**
 * 按类型拟合。指数 / 对数 / 幂在正数域上线性化（与 PowerPoint 一致）；
 * 数据不满足域要求或退化（有效点不足、奇异矩阵）时返回 null，渲染层静默跳过。
 */
function fitTrend(t: TrendlineSpec, pts: { x: number; y: number }[], catCount: number, vals: (number | null)[]): Fit | null {
  if (t.kind === 'movingAvg') {
    const period = t.period;
    const points: (number | null)[] = [];
    let any = false;
    for (let i = 0; i < catCount; i++) {
      if (i < period - 1) {
        points.push(null);
        continue;
      }
      let sum = 0,
        n = 0;
      for (let k = Math.max(0, i - period + 1); k <= i; k++) {
        const v = vals[k];
        if (v !== null && Number.isFinite(v)) {
          sum += v;
          n++;
        }
      }
      points.push(n >= Math.min(period, i + 1) ? sum / n : null);
      if (n) any = true;
    }
    return any ? { ab: null, coeffs: null, points, r2: null, lo: 1, hi: catCount } : null;
  }
  const clean = finitePts(pts);
  if (t.kind === 'poly') {
    const order = Math.round(Math.min(Math.max(t.order, 2), 6));
    if (clean.length <= order) return null;
    const size = order + 1;
    const matrix: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
    const rhs = new Array(size).fill(0);
    for (const p of clean) {
      // 法方程要累加到 x^(2·order)，幂表必须给满 2·size−1 项，短了会得到 NaN 矩阵
      const pow: number[] = [1];
      for (let k = 1; k <= 2 * order; k++) pow.push(pow[k - 1] * p.x);
      for (let r = 0; r < size; r++) {
        for (let c2 = 0; c2 < size; c2++) matrix[r][c2] += pow[r + c2];
        rhs[r] += pow[r] * p.y;
      }
    }
    const coeffs = solve(matrix, rhs);
    if (!coeffs || coeffs.some((c) => !Number.isFinite(c))) return null;
    const f: Fit = { ab: null, coeffs, points: null, r2: 0, lo: clean[0].x, hi: clean[clean.length - 1].x };
    f.lo = Math.min(...clean.map((p) => p.x));
    f.hi = Math.max(...clean.map((p) => p.x));
    f.r2 = r2Of(clean, t, f);
    return f;
  }
  // 两参形态：linear 原域；exponential y=ae^(bx)；logarithmic y=a·ln x+b；power y=a·x^b
  const xs: number[] = [],
    ys: number[] = [];
  for (const p of clean) {
    const lx = t.kind === 'logarithmic' || t.kind === 'power' ? Math.log(p.x) : p.x;
    const ly = t.kind === 'exponential' || t.kind === 'power' ? Math.log(p.y) : p.y;
    if (!Number.isFinite(lx) || !Number.isFinite(ly)) continue;
    xs.push(lx);
    ys.push(ly);
  }
  const fit = lstsq(xs, ys);
  if (!fit) return null;
  const f: Fit = {
    // 指数 / 幂在 ln y 域拟合，截距要还原回 e^a；线性 / 对数直接用原值
    ab: { a: t.kind === 'exponential' || t.kind === 'power' ? Math.exp(fit.a) : fit.a, b: fit.b },
    coeffs: null,
    points: null,
    r2: 0,
    lo: Math.min(...clean.map((p) => p.x)),
    hi: Math.max(...clean.map((p) => p.x)),
  };
  f.r2 = r2Of(clean, t, f);
  return f;
}

// ---------- 标签文本 ----------

const KIND_NAMES: Record<TrendlineSpec['kind'], string> = {
  linear: '线性',
  exponential: '指数',
  logarithmic: '对数',
  movingAvg: '移动平均',
  poly: '多项式',
  power: '幂',
};

/** 图例条目名：显式 c:name 优先，缺省「类型 (系列名)」 */
export function trendlineName(t: TrendlineSpec, seriesName: string): string {
  return t.name ?? `${KIND_NAMES[t.kind]} (${seriesName})`;
}

const fmtCoef = (v: number, fmt: string | null): string => {
  const s = formatNumber(Math.abs(v), fmt);
  return s === '' ? '0' : s;
};
const sign = (v: number): string => (v < 0 ? ' − ' : ' + ');

export function trendEquation(t: TrendlineSpec, f: Fit, fmt: string | null): string | null {
  if (!hasEquation(t) || (!f.ab && !f.coeffs)) return null;
  const fmtAll = fmt ?? 'General';
  if (f.ab) {
    const { a, b } = f.ab;
    if (t.kind === 'linear') {
      const intercept = t.intercept ?? a;
      return `y = ${fmtCoef(b, fmtAll)}x${sign(intercept)}${fmtCoef(intercept, fmtAll)}`;
    }
    if (t.kind === 'exponential') return `y = ${fmtCoef(a, fmtAll)}e^${fmtCoef(b, fmtAll)}x`;
    if (t.kind === 'logarithmic') return `y = ${fmtCoef(a, fmtAll)}ln(x)${sign(b)}${fmtCoef(b, fmtAll)}`;
    return `y = ${fmtCoef(a, fmtAll)}x^${fmtCoef(b, fmtAll)}`;
  }
  const coeffs = f.coeffs ?? [];
  let out = 'y = ';
  for (let k = coeffs.length - 1; k >= 0; k--) {
    const term = fmtCoef(coeffs[k], fmtAll);
    const varPart = k === 0 ? '' : k === 1 ? 'x' : `x^${k}`;
    out += (k < coeffs.length - 1 ? sign(coeffs[k]) : coeffs[k] < 0 ? '−' : '') + term + varPart;
  }
  return out;
}

// ---------- 采样与裁剪 ----------

/** Liang-Barsky 线段裁剪 */
function clipSeg(p: Pt, q: Pt, box: { left: number; right: number; top: number; bottom: number }): [Pt, Pt] | null {
  let t0 = 0,
    t1 = 1;
  const dx = q[0] - p[0],
    dy = q[1] - p[1];
  const edges: [number, number][] = [
    [-dx, p[0] - box.left],
    [dx, box.right - p[0]],
    [-dy, p[1] - box.top],
    [dy, box.bottom - p[1]],
  ];
  for (const [den, num] of edges) {
    if (Math.abs(den) < 1e-12) {
      if (num < 0) return null;
      continue;
    }
    const t = num / den;
    if (den < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [
    [p[0] + dx * t0, p[1] + dy * t0],
    [p[0] + dx * t1, p[1] + dy * t1],
  ];
}

const SAMPLES = 48;

interface Sampled {
  pts: Pt[];
  /** 屏幕坐标中点（标签定位用） */
  mid: Pt;
}

function sampleFit(t: TrendlineSpec, f: Fit, map: AnalysisMap): Sampled | null {
  let lo: number, hi: number;
  if (t.kind === 'movingAvg') {
    lo = 1;
    hi = f.hi;
  } else {
    if (!(f.hi > f.lo)) return null;
    lo = f.lo - t.backward;
    hi = f.hi + t.forward;
  }
  const raw: Pt[] = [];
  for (let k = 0; k <= SAMPLES; k++) {
    const x = lo + ((hi - lo) * k) / SAMPLES;
    const v = t.kind === 'movingAvg' ? (f.points?.[Math.round(x) - 1] ?? null) : evalFit(t, f, x);
    if (v === null || !Number.isFinite(v)) continue;
    raw.push(map.pt(x, v));
  }
  if (raw.length < 2) return null;
  const box = { left: map.left, right: map.right, top: map.top, bottom: map.bottom };
  const pts: Pt[] = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const seg = clipSeg(raw[i], raw[i + 1], box);
    if (!seg) continue;
    if (!pts.length) pts.push(seg[0]);
    else if (Math.hypot(pts[pts.length - 1][0] - seg[0][0], pts[pts.length - 1][1] - seg[0][1]) > 0.5) pts.push(seg[0]);
    pts.push(seg[1]);
  }
  if (pts.length < 2) return null;
  return { pts, mid: pts[Math.floor(pts.length / 2)] };
}

// ---------- 趋势线渲染 ----------

/** 拟合输入点：类目图 x = 1..n（PowerPoint 口径），散点用实际 xVal；跳过空值 */
/** 各系列在图上的「视觉值」：standard 用原值；堆叠取累计顶（按正负分组，与 renderBars 同口径）；百分比堆叠取累计占比 */
function visualTops(g: PlotGroup): (number | null)[][] {
  const stacked = isStacked(g);
  const percent = g.grouping === 'percentStacked';
  const n = Math.max(0, ...g.series.map((ser) => ser.vals.length));
  const totals = new Array<number>(n).fill(0);
  if (percent) for (let i = 0; i < n; i++) for (const ser of g.series) totals[i] += Math.abs(ser.vals[i] ?? 0);
  const pos = new Array<number>(n).fill(0);
  const neg = new Array<number>(n).fill(0);
  return g.series.map((ser) => {
    const out: (number | null)[] = [];
    for (let i = 0; i < ser.vals.length; i++) {
      const v = ser.vals[i];
      if (v === null || !Number.isFinite(v)) {
        out.push(null);
        continue;
      }
      let top = v;
      if (stacked) {
        if (v >= 0) {
          top = pos[i] + v;
          pos[i] = top;
        } else {
          top = neg[i] + v;
          neg[i] = top;
        }
      }
      out.push(percent ? (totals[i] > 0 ? top / totals[i] : top) : top);
    }
    return out;
  });
}

/** 拟合输入点：类目图 x = 1..n（PowerPoint 口径），散点用实际 xVal；y 取视觉值，跳过空值 */
function dataPoints(s: Series, g: PlotGroup, visual: (number | null)[]): { x: number; y: number }[] {
  const xy = g.kind === 'scatter' || g.kind === 'bubble';
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < s.vals.length; i++) {
    const y = visual[i];
    if (y === null || !Number.isFinite(y)) continue;
    const x = xy ? (s.xs?.[i] ?? i + 1) : i + 1;
    if (!Number.isFinite(x)) continue;
    out.push({ x, y });
  }
  return out;
}

export function renderTrendlines(s: Series, g: PlotGroup, map: AnalysisMap, m: ChartModel, fonts: string[], env: PlotEnv): SlideElement[] {
  const out: SlideElement[] = [];
  if (g.is3D) return out;
  const visual = visualTops(g)[g.series.indexOf(s)] ?? [];
  const defStroke = strokeFrom(s.ln, s.color, px(2)) ?? { color: s.color, width: px(2), dash: null };
  for (const t of s.trendlines) {
    const pts = dataPoints(s, g, visual);
    const f = fitTrend(t, pts, Math.max(s.vals.length, s.cats.length), visual);
    if (!f) continue;
    const sampled = sampleFit(t, f, map);
    if (!sampled) continue;
    const stroke = strokeFrom(t.ln.present ? t.ln : null, defStroke.color, defStroke.width) ?? defStroke;
    const shape = polyEl([sampled.pts], null, stroke, false);
    if (shape) out.push(shape);
    const fmt = t.lblFmt ?? s.fmt;
    const size = t.lblSize ?? env.size * 0.92;
    const color = t.lblColor ?? env.color;
    const lines: string[] = [];
    if (t.dispEq) {
      const eq = trendEquation(t, f, fmt);
      if (eq) lines.push(eq);
    }
    if (t.dispRSqr && f.r2 !== null) lines.push(`R² = ${formatNumber(f.r2, fmt)}`);
    lines.forEach((text, li) => {
      const w = measure(text, size) + size * 0.5;
      const h = lineH(size);
      const lx = Math.min(Math.max(sampled.mid[0] - w / 2, map.left), Math.max(map.right - w, map.left));
      const ly = sampled.mid[1] - (li + 1) * (h + 2);
      out.push(textEl(lx, ly, w, h, text, { size, color, align: 'center', anchor: 'middle', fonts }));
    });
  }
  return out;
}

// ---------- 误差线渲染 ----------

const sampleStd = (vals: (number | null)[]): { std: number; n: number } => {
  const vs = vals.filter((v): v is number => v !== null && Number.isFinite(v));
  const n = vs.length;
  if (n < 2) return { std: 0, n };
  const mean = vs.reduce((s, v) => s + v, 0) / n;
  const varr = vs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return { std: Math.sqrt(varr), n };
};

/** 每个数据点的 ± 偏移；返回 null 表示该点不画。cust 允许上下不对称。 */
function errOffset(spec: ErrBarsSpec, s: Series, i: number): { plus: number; minus: number } | null {
  switch (spec.valType) {
    case 'cust':
      return { plus: Math.abs(spec.plus?.[i] ?? 0), minus: Math.abs(spec.minus?.[i] ?? 0) };
    case 'fixedVal':
      return { plus: Math.abs(spec.value ?? 0), minus: Math.abs(spec.value ?? 0) };
    case 'percentage': {
      const v = s.vals[i];
      if (v === null) return null;
      const e = (Math.abs(spec.value ?? 0) / 100) * Math.abs(v);
      return { plus: e, minus: e };
    }
    case 'stdDev': {
      const e = (spec.value ?? 1) * sampleStd(s.vals).std;
      return { plus: e, minus: e };
    }
    case 'stdErr': {
      const { std, n } = sampleStd(s.vals);
      const e = n > 0 ? std / Math.sqrt(n) : 0;
      return { plus: e, minus: e };
    }
    default:
      return null;
  }
}

/**
 * 误差线。posOf 给出每个数据点的锚点屏幕坐标（柱取柱心，线 / 面积取点，散点取 xy）；
 * along 为误差方向单位向量（屏幕坐标，y 向下为正）。无效点跳过，整体保持确定性。
 */
export function renderErrBars(s: Series, spec: ErrBarsSpec, posOf: (i: number) => Pt | null, along: Pt, m: ChartModel): SlideElement[] {
  const out: SlideElement[] = [];
  const stroke = strokeFrom(spec.ln.present ? spec.ln : null, m.textColor, 0.75);
  if (!stroke) return out;
  const cap = Math.max(stroke.width * 2.5, 3);
  const perp: Pt = [-along[1], along[0]];
  for (let i = 0; i < s.vals.length; i++) {
    const anchor = posOf(i);
    if (!anchor) continue;
    const off = errOffset(spec, s, i);
    if (!off) continue;
    const plus = spec.kind === 'minus' ? 0 : off.plus;
    const minus = spec.kind === 'plus' ? 0 : off.minus;
    if (!(plus > 0) && !(minus > 0)) continue;
    const push = (from: number, to: number): void => {
      const a: Pt = [anchor[0] + along[0] * from, anchor[1] + along[1] * from];
      const b: Pt = [anchor[0] + along[0] * to, anchor[1] + along[1] * to];
      const el = lineEl(a[0], a[1], b[0], b[1], stroke);
      if (el) out.push(el);
      if (!spec.noEndCap) {
        for (const [ex, ey] of [a, b]) {
          const c = lineEl(ex - (perp[0] * cap) / 2, ey - (perp[1] * cap) / 2, ex + (perp[0] * cap) / 2, ey + (perp[1] * cap) / 2, stroke);
          if (c) out.push(c);
        }
      }
    };
    push(-minus, plus);
  }
  return out;
}

// ---------- 数据表 ----------

/** 数据表行高与总高；表带高度供 index.ts 提前从绘图区扣除 */
export function dataTableHeight(m: ChartModel, seriesCount: number, regionH: number): number {
  const d = m.dTable;
  if (!d || seriesCount <= 0) return 0;
  const size = d.size ?? m.textSize;
  const rowH = Math.max(size * 1.7, 14);
  const total = (seriesCount + 1) * rowH + size * 0.6;
  return Math.min(total, regionH * 0.5);
}

/**
 * 数据表：首行类目名，其后每系列一行；列边界对齐类目边界，
 * showKeys 时首列为图例键（样式与图例一致）。rect 为绘图区矩形，表带画在其正下方。
 */
export function renderDataTable(
  m: ChartModel,
  groups: PlotGroup[],
  cats: string[],
  rect: { x: number; y: number; w: number; h: number },
  c: Cartesian,
  pe: PlotEnv,
  fonts: string[],
): SlideElement[] {
  const d = m.dTable;
  if (!d) return [];
  const seriesCount = groups.reduce((acc, g) => acc + g.series.length, 0);
  if (seriesCount <= 0) return [];
  const size = d.size ?? m.textSize;
  const rowH = Math.max(size * 1.7, 14);
  const color = d.color ?? m.textColor;
  const border = { color: mix(m.textColor, '#ffffff', 0.45), width: 1, dash: null };
  const keyW = d.keys ? Math.max(size * 2.6, 18) : 0;
  const tableH = (seriesCount + 1) * rowH;
  const top = rect.y + rect.h + size * 0.3;
  const left = rect.x;
  const width = rect.w;
  const out: SlideElement[] = [];

  // 列边界：between 用类目边界；midCat 用相邻类目中心的中点（两端半带宽）
  const n = Math.max(cats.length, 1);
  const bounds: number[] = [];
  if (c.catView.between) for (let i = 0; i <= n; i++) bounds.push(c.edge(i));
  else {
    bounds.push(c.cat(0) - c.band / 2);
    for (let i = 0; i < n - 1; i++) bounds.push((c.cat(i) + c.cat(i + 1)) / 2);
    bounds.push(c.cat(n - 1) + c.band / 2);
  }
  const scaleTo = (x: number): number => left + keyW + ((x - rect.x) / rect.w) * (width - keyW);
  const cols = bounds.map(scaleTo);

  if (d.outline) {
    const el = rectEl({ x: left, y: top, w: width, h: tableH }, null, border);
    if (el) out.push(el);
  }
  if (d.horz) {
    for (let r = 1; r <= seriesCount; r++) {
      const el = lineEl(left, top + r * rowH, left + width, top + r * rowH, border);
      if (el) out.push(el);
    }
  }
  if (d.vert) {
    for (const x of cols.slice(1, -1)) {
      const el = lineEl(x, top, x, top + tableH, border);
      if (el) out.push(el);
    }
  }

  const cellText = (text: string, x: number, y: number, w: number): void => {
    if (!text) return;
    out.push(textEl(x, y, w, rowH, text, { size, color, align: 'center', anchor: 'middle', fonts }));
  };

  for (let i = 0; i < n; i++) cellText(cats[i] ?? '', cols[i], top, cols[i + 1] - cols[i]);

  let row = 1;
  for (const g of groups) {
    g.series.forEach((s, si) => {
      const y = top + row * rowH;
      if (d.keys) {
        const cx = left + keyW / 2;
        const cy = y + rowH / 2;
        const line = g.kind === 'line' || g.kind === 'scatter';
        if (line) {
          const sw = keyW * 0.5;
          const el = lineEl(cx - sw / 2, cy, cx + sw / 2, cy, { color: s.color, width: px(2), dash: null });
          if (el) out.push(el);
          const sym = markerSymbol(g, s, si);
          if (sym !== 'none') {
            const mk = markerEl(cx, cy, sym, s, s.color);
            if (mk) out.push(mk);
          }
        } else {
          const { fill } = pointFill(g, s, 0, pe.ctx);
          const el = rectEl({ x: cx - size * 0.6, y: cy - size * 0.45, w: size * 1.2, h: size * 0.9 }, fill, null);
          if (el) out.push(el);
        }
      }
      for (let i = 0; i < n; i++) {
        const v = s.vals[i];
        const text = v === null || !Number.isFinite(v) ? '' : formatNumber(v, s.fmt);
        cellText(text, cols[i], y, cols[i + 1] - cols[i]);
      }
      row++;
    });
  }
  return out;
}
