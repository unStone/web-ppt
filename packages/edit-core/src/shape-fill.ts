import type { Fill } from '@web-ppt/core';
import { assertDataObject, own } from './data-validation';
import { effectiveElement } from './projection';
import type { EditDoc, ElementFillState, ElementId } from './types';

export type VectorFill = Exclude<Fill, { type: 'image' }>;

export const SHAPE_PATTERN_PRESETS = [
  'pct5', 'pct10', 'pct20', 'pct25', 'pct30', 'pct40', 'pct50', 'pct60', 'pct70', 'pct75',
  'pct80', 'pct90', 'ltHorz', 'horz', 'dkHorz', 'ltVert', 'vert', 'dkVert', 'ltUpDiag',
  'upDiag', 'ltDnDiag', 'dnDiag', 'smGrid', 'lgGrid', 'cross', 'diagCross', 'trellis', 'wave',
] as const;
const patternPresets = new Set<string>(SHAPE_PATTERN_PRESETS);

export function assertDrawingColor(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${label} 必须是颜色字符串`);
  if (/^#[0-9a-f]{6}$/i.test(value)) return;
  const match = /^(rgb|rgba)\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?\)$/i.exec(value);
  if (!match) throw new Error(`${label} 必须是 #RRGGBB、rgb() 或 rgba()`);
  const alphaText = match[5];
  if ((match[1].toLowerCase() === 'rgb') !== (alphaText === undefined)) {
    throw new Error(`${label} 的 rgb/rgba 参数数量不匹配`);
  }
  const channels = match.slice(2, 5).map(Number);
  const alpha = alphaText === undefined ? 1 : Number(alphaText);
  if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)
    || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`${label} 的通道超出范围`);
  }
}

/** 命令提交时就收敛到 core 解析器的颜色表示，保存/重开不应改变统一 Schema。 */
export function normalizeDrawingColor(value: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) {
    const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    return `rgb(${channels.join(',')})`;
  }
  const match = /^(rgb|rgba)\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?\)$/i.exec(value)!;
  const channels = match.slice(2, 5).map(Number);
  const alpha = match[1].toLowerCase() === 'rgba'
    ? Math.round(Number(match[5]) * 1000) / 1000 : 1;
  return alpha >= 1 ? `rgb(${channels.join(',')})`
    : `rgba(${channels.join(',')},${alpha})`;
}

export function normalizeVectorFill(fill: VectorFill): VectorFill {
  if (fill.type === 'none') return { type: 'none' };
  if (fill.type === 'solid') return { type: 'solid', color: normalizeDrawingColor(fill.color) };
  if (fill.type === 'gradient') {
    const angle = fill.radial === true ? 0 : Math.round(fill.angle * 60000) / 60000;
    return {
      type: 'gradient', angle,
      stops: fill.stops.map((stop) => ({
        pos: Math.round(stop.pos * 100000) / 100000,
        color: normalizeDrawingColor(stop.color),
      })),
      ...(fill.radial === true ? { radial: true } : {}),
    };
  }
  return {
    type: 'pattern', fg: normalizeDrawingColor(fill.fg), bg: normalizeDrawingColor(fill.bg),
    preset: fill.preset,
  };
}

export function assertVectorFill(value: unknown, label: string): asserts value is VectorFill {
  if (!value || typeof value !== 'object') throw new Error(`${label} 必须是填充对象`);
  const type = (value as { type?: unknown }).type;
  if (type === 'none') {
    assertDataObject(value, ['type'], label);
    return;
  }
  if (type === 'solid') {
    assertDataObject(value, ['type', 'color'], label);
    assertDrawingColor((value as { color?: unknown }).color, `${label}.color`);
    return;
  }
  if (type === 'gradient') {
    assertDataObject(value, ['type', 'angle', 'stops', 'radial'], label);
    const gradient = value as { angle?: unknown; stops?: unknown; radial?: unknown };
    const angleUnits = typeof gradient.angle === 'number'
      ? Math.round(gradient.angle * 60000) : Number.NaN;
    if (typeof gradient.angle !== 'number' || !Number.isFinite(gradient.angle)
      || !Number.isSafeInteger(angleUnits) || angleUnits < 0 || angleUnits >= 21600000) {
      throw new Error(`${label}.angle 必须是 0–360° 内可写回的有限角度`);
    }
    if (gradient.radial !== undefined && typeof gradient.radial !== 'boolean') {
      throw new Error(`${label}.radial 必须是布尔值`);
    }
    if (!Array.isArray(gradient.stops) || gradient.stops.length < 2 || gradient.stops.length > 10) {
      throw new Error(`${label}.stops 必须包含 2–10 个 stop`);
    }
    let previous = -1;
    gradient.stops.forEach((stop, index) => {
      assertDataObject(stop, ['pos', 'color'], `${label}.stops[${index}]`);
      const pos = (stop as { pos?: unknown }).pos;
      const normalized = typeof pos === 'number' ? Math.round(pos * 100000) / 100000 : Number.NaN;
      if (typeof pos !== 'number' || !Number.isFinite(pos) || pos < 0 || pos > 1
        || normalized <= previous) {
        throw new Error(`${label}.stops 必须按 0–1 严格递增`);
      }
      previous = normalized;
      assertDrawingColor((stop as { color?: unknown }).color, `${label}.stops[${index}].color`);
    });
    return;
  }
  if (type === 'pattern') {
    assertDataObject(value, ['type', 'preset', 'fg', 'bg'], label);
    const pattern = value as { preset?: unknown; fg?: unknown; bg?: unknown };
    if (typeof pattern.preset !== 'string' || !patternPresets.has(pattern.preset)) {
      throw new Error(`${label}.preset 不受渲染器支持`);
    }
    assertDrawingColor(pattern.fg, `${label}.fg`);
    assertDrawingColor(pattern.bg, `${label}.bg`);
    return;
  }
  throw new Error(`${label}.type 不受支持：${String(type)}`);
}

export function queryElementFill(doc: EditDoc, ids: readonly ElementId[]): ElementFillState {
  if (!ids.length) throw new Error('填充查询至少需要一个元素');
  const values = ids.map((id) => {
    const element = effectiveElement(doc, id);
    if (element.kind !== 'shape') throw new Error(`元素不支持填充：${id}`);
    return element.fill;
  });
  const signature = JSON.stringify(values[0]);
  return {
    value: structuredClone(values[0] ?? null),
    mixed: values.some((value) => JSON.stringify(value) !== signature),
    direct: ids.some((id) => own(doc.elements[id].ovr, 'fill')),
  };
}
