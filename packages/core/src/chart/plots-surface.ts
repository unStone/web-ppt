/**
 * 曲面图：退化为俯视等高线着色。
 */
import type { SlideElement, Stroke } from '../types';
import type { PlotGroup } from './model';
import { lineH } from './frame';
import { Rect, clamp, formatNumber, measure, mix, rectEl, solid, textEl } from './util';
import { PlotEnv, num } from './plot-marks';

// ---------- 曲面图（俯视等高线着色） ----------

/** 由蓝到红的等高线色带（无 bandFmts 时的默认配色） */
const BAND_RAMP = [
  'rgb(49,84,163)',
  'rgb(84,148,200)',
  'rgb(160,208,224)',
  'rgb(224,238,196)',
  'rgb(253,224,144)',
  'rgb(244,146,74)',
  'rgb(200,60,44)',
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
    out.push(
      textEl(f.rect.x, y + ch / 2 - labelH / 2, Math.max(labelW - env.size * 0.4, 8), labelH, s.name, {
        size: env.size,
        color: env.color,
        align: 'right',
        anchor: 'middle',
        fonts: env.fonts,
      }),
    );
  });

  // 类目标签
  for (let ci = 0; ci < cols && ci < env.cats.length; ci++) {
    out.push(
      textEl(gridX + ci * cw, gridY + gridH, cw, labelH, env.cats[ci], {
        size: env.size,
        color: env.color,
        align: 'center',
        anchor: 'middle',
        fonts: env.fonts,
      }),
    );
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
      textEl(
        barX + barW + env.size * 0.3,
        barY + barH - (b + 1) * step - lineH(env.size * 0.85) / 2,
        legendW,
        lineH(env.size * 0.85),
        formatNumber(f.min + ((b + 1) * span) / f.bands, f.fmt),
        {
          size: env.size * 0.85,
          color: env.color,
          align: 'left',
          anchor: 'middle',
          fonts: env.fonts,
        },
      ),
    );
  }
  return out;
}

const longest = (list: string[]): string => list.reduce((a, b) => (b.length > a.length ? b : a), '');
