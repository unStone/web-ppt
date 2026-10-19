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

function dashPresetId(dash: readonly number[], width: number): number {
  const scale = Math.max(width, 1);
  for (const { id, pattern } of DASH_PRESETS) {
    const expected = pattern.map((m) => m * scale);
    if (expected.length === dash.length && expected.every((v, i) => Math.abs(v - dash[i]) < 0.51)) return id;
  }
  throw new Error('PPT 写入暂不支持自定义虚线');
}

/**
 * Schema 角度 → fillAngle：fillAngle = 90 − Schema。fillAngle 的符号参与决定首尾色
 * （见 core/ppt/escher.ts 的 linearShade）：负角度且焦点为 0 时 fillColor 在起点，
 * 所以统一落在 [−360, 0)，Schema 90° 写成 −360 而不是 0。
 */
function toEscherAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) throw new Error('PPT 渐变角度无效');
  let e = 90 - degrees;
  while (e >= 0) e -= 360;
  while (e < -360) e += 360;
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
    // 旧格式的线性 shade 只有首尾两色；多色标、中间色标位置或径向没有对应的 FOPT，继续原子拒绝。
    if (fill.radial || fill.stops.length !== 2
      || fill.stops[0].pos !== 0 || fill.stops[1].pos !== 1) {
      throw new Error('PPT 写入暂不支持多色标、非端点色标或径向渐变');
    }
    const a = rgba(fill.stops[0].color), b = rgba(fill.stops[1].color);
    return [
      // 7 = msofillShadeScale，与 LibreOffice 线性渐变导出一致；两端透明度分别是 fillOpacity / fillBackOpacity。
      { id: 384, value: 7 }, { id: 385, value: a.rgb }, { id: 387, value: b.rgb },
      { id: 386, value: Math.round(a.alpha * 65536) }, { id: 388, value: Math.round(b.alpha * 65536) },
      { id: 395, value: toEscherAngle(fill.angle) }, { id: 447, value: 0x100010 },
    ];
  }
  // 图案填充在 OfficeArt 里是 fillType=1 + fillBlip 指向的图案位图，没有预设名可写，按原子拒绝处理。
  throw new Error('PPT 写入暂不支持图案或图片形状填充');
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
