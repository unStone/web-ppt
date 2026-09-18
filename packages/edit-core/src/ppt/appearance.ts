import type { Fill, Stroke } from '@web-ppt/core';
import { rgba, type Property } from './binary';

/**
 * 与 core/ppt/escher.ts 的 DASH_MAP 一一对应。
 * 读取侧把 lineDashing 乘以线宽还原数组；写入必须先除回单位再匹配，否则 4pt 的 dash 会被当成「自定义」。
 */
const DASH_PRESETS: ReadonlyArray<{ id: number; pattern: readonly number[] }> = [
  { id: 1, pattern: [4, 3] }, { id: 2, pattern: [1, 3] }, { id: 3, pattern: [4, 3, 1, 3] },
  { id: 4, pattern: [4, 3, 1, 3, 1, 3] }, { id: 5, pattern: [8, 3] }, { id: 6, pattern: [8, 3, 1, 3] },
  { id: 7, pattern: [8, 3, 1, 3, 1, 3] }, { id: 8, pattern: [1, 1] }, { id: 9, pattern: [3, 3] },
  { id: 10, pattern: [3, 3, 1, 3] },
];

/**
 * DrawingML 图案名 → 本仓库约定的索引（写入 pid 388）。
 * MS-ODRAW 对 fillType=1 没有预设枚举（388 官方名是 fillBackOpacity）；
 * 用该槽位存索引只为读写对称，勿与 Pictures/fillBlip 混淆。
 * 与 core/ppt/escher.ts 的 PATTERN_BY_INDEX 必须同步。
 */
export const PATTERN_PRESETS: Readonly<Record<string, number>> = {
  pct5: 1, pct10: 2, pct20: 3, pct25: 4, pct30: 5, pct40: 6, pct50: 7, pct60: 8, pct70: 9,
  pct75: 10, pct80: 11, pct90: 12,
  horz: 13, vert: 14, ltHorz: 15, ltVert: 16, dkHorz: 17, dkVert: 18,
  ltUpDiag: 19, upDiag: 20, ltDnDiag: 21, dnDiag: 22,
  cross: 23, diagCross: 24, smGrid: 25, lgGrid: 26, trellis: 27, wave: 28,
};

function dashPresetId(dash: readonly number[], width: number): number {
  const scale = Math.max(width, 1);
  for (const { id, pattern } of DASH_PRESETS) {
    const expected = pattern.map((m) => m * scale);
    if (expected.length === dash.length && expected.every((v, i) => Math.abs(v - dash[i]) < 0.51)) return id;
  }
  throw new Error('PPT 写入暂不支持自定义虚线');
}

/**
 * Schema / DrawingML：0° = 左→右。Escher fillAngle：0° = 下→上。
 * LibreOffice 实测对应关系为 escherDeg = normalize(-270 - schemaDeg)。
 */
function toEscherAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) throw new Error('PPT 渐变角度无效');
  let e = -270 - ((degrees % 360) + 360) % 360;
  while (e <= -360) e += 360;
  while (e > 0) e -= 360;
  return Math.round(e * 65536) >>> 0;
}

export function fillProperties(fill: Fill | null): Property[] {
  if (!fill || fill.type === 'none') return [{ id: 447, value: 0x100000 }];
  if (fill.type === 'solid') {
    const c = rgba(fill.color);
    return [
      { id: 384, value: 0 }, { id: 385, value: c.rgb },
      { id: 386, value: Math.round(c.alpha * 65536) }, { id: 447, value: 0x100010 },
    ];
  }
  if (fill.type === 'gradient') {
    // 旧格式只有双色 shade（fillType 4–7）；多色标 / 径向没有稳定 FOPT，继续原子拒绝。
    if (fill.radial) throw new Error('PPT 写入暂不支持多色标或径向渐变');
    if (fill.stops.length !== 2) throw new Error('PPT 写入暂不支持多色标或径向渐变');
    const a = rgba(fill.stops[0].color), b = rgba(fill.stops[1].color);
    const opacity = Math.round(((a.alpha + b.alpha) / 2) * 65536);
    return [
      // 7 = msofillShadeScale，与 LibreOffice 线性渐变导出一致
      { id: 384, value: 7 }, { id: 385, value: a.rgb }, { id: 387, value: b.rgb },
      { id: 386, value: opacity }, { id: 395, value: toEscherAngle(fill.angle) },
      { id: 447, value: 0x100010 },
    ];
  }
  if (fill.type === 'pattern') {
    const index = PATTERN_PRESETS[fill.preset];
    if (index === undefined) throw new Error('PPT 写入暂不支持该图案填充');
    const fg = rgba(fill.fg), bg = rgba(fill.bg);
    return [
      { id: 384, value: 1 }, { id: 385, value: fg.rgb }, { id: 387, value: bg.rgb },
      { id: 386, value: Math.round(fg.alpha * 65536) },
      // pid 388：约定为图案预设索引（官方语义是 fillBackOpacity）
      { id: 388, value: index }, { id: 447, value: 0x100010 },
    ];
  }
  throw new Error('PPT 写入暂不支持渐变、图案或图片形状填充');
}

export function strokeProperties(stroke: Stroke | null | undefined): Property[] {
  if (!stroke) return [{ id: 511, value: 0x80000 }];
  if (stroke.compound && stroke.compound !== 'sng') throw new Error('PPT 写入暂不支持复合线型');
  if (!Number.isFinite(stroke.width) || stroke.width < 0) throw new Error('PPT 线宽无效');
  const c = rgba(stroke.color);
  const p: Property[] = [
    { id: 448, value: c.rgb }, { id: 449, value: Math.round(c.alpha * 65536) },
    { id: 459, value: Math.round(stroke.width * 9525) }, { id: 511, value: 0x80008 },
  ];
  if (stroke.dash?.length) p.push({ id: 462, value: dashPresetId(stroke.dash, stroke.width) });
  if (stroke.cap) p.push({ id: 471, value: { round: 0, square: 1, butt: 2 }[stroke.cap] });
  if (stroke.join) p.push({ id: 470, value: { round: 1, bevel: 0, miter: 2 }[stroke.join] });
  for (const [end, id] of [[stroke.head, 464], [stroke.tail, 465]] as const) {
    if (end && end.type !== 'none') {
      // Escher 箭头宽高枚举只有默认档；非 3 无法无损表达
      if (end.w !== 3 || end.h !== 3) throw new Error('PPT 写入暂不支持自定义箭头尺寸');
      p.push({ id, value: { triangle: 1, stealth: 2, diamond: 3, oval: 4, arrow: 5 }[end.type] });
    }
  }
  return p;
}

/** crop 分数 → 16.16；属性顺序 Top/Bottom/Left/Right，与 MS-ODRAW / 读取侧一致。 */
export function cropProperties(crop: { l: number; t: number; r: number; b: number }): Property[] {
  for (const v of [crop.l, crop.t, crop.r, crop.b]) {
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error('PPT 图片裁剪无效');
  }
  if (crop.l + crop.r >= 1 || crop.t + crop.b >= 1) throw new Error('PPT 图片裁剪无效');
  return [
    { id: 256, value: Math.round(crop.t * 65536) },
    { id: 257, value: Math.round(crop.b * 65536) },
    { id: 258, value: Math.round(crop.l * 65536) },
    { id: 259, value: Math.round(crop.r * 65536) },
  ];
}
