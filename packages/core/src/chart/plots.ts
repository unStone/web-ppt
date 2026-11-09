/**
 * 直角坐标系图组的几何生成：柱/条、折线、面积、散点、气泡与股价图。
 * 饼 / 环见 plots-pie.ts，曲面与雷达见 plots-surface.ts、plots-radar.ts，共用绘制件见 plot-marks.ts。
 */
import type { Fill, SlideElement, Stroke } from '../types';
import type { PlotGroup, Series } from './model';
import { isStacked, labelVisible } from './model';
import type { Cartesian, XYPlot } from './frame';
import { lineH } from './frame';
import { Depth3D, Pt, Rect, clamp, darken, lineEl, mix, nf, px, shapeEl, solid, strokeFrom } from './util';
import {
  PlotEnv, box3D, circlePath, labelEl, labelString, markerEl, markerSymbol, num, pathEl, pointFill, pointStroke,
} from './plot-marks';

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
      const el2 = labelEl(q[0], q[1] - lineH(size) * 0.85,
        labelString(s, i, num(s.vals[i]) ?? 0, null, env, null, s.cats[i] ?? String(i + 1)), s.dLbls, env);
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
        label: labelVisible(s.dLbls) ? labelString(s, i, yv, null, env, s.sizes ? num(s.sizes[i]) : null, s.cats[i] ?? String(i + 1)) : '',
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
