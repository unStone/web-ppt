/**
 * 雷达图：网格与数据折线。
 */
import type { SlideElement, Stroke } from '../types';
import type { PlotGroup } from './model';
import { Pt, lineEl, polyEl, strokeFrom, textEl } from './util';
import { PlotEnv, markerEl, markerSymbol, pointFill } from './plot-marks';

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
