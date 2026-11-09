/**
 * 饼 / 环、3D 饼与复合饼（子母饼 / 复合条饼）的几何生成。
 */
import type { SlideElement, ShapeElement, Stroke } from '../types';
import type { PlotGroup } from './model';
import { labelVisible } from './model';
import { Pt, Rect, clamp, darken, formatNumber, lineEl, mix, nf, shapeEl, solid } from './util';
import {
  PlotEnv, TAU, circlePath, labelEl, labelString, num, pointFill, pointStroke,
} from './plot-marks';

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
