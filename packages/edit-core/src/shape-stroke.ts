import type { LineEnd, Stroke } from '@web-ppt/core';
import { assertDataObject, own } from './data-validation';
import { effectiveElement } from './projection';
import { assertDrawingColor, normalizeDrawingColor } from './shape-fill';
import type { EditDoc, ElementId, ElementStrokeState } from './types';

export type StrokeCommandValue = Stroke | { readonly type: 'none' } | null;

const DASHES: readonly (readonly [string, readonly number[]])[] = [
  ['dash', [4, 3]], ['dashDot', [4, 3, 1, 3]], ['dot', [1, 3]], ['lgDash', [8, 3]],
  ['lgDashDot', [8, 3, 1, 3]], ['lgDashDotDot', [8, 3, 1, 3, 1, 3]],
  ['sysDash', [3, 3]], ['sysDashDot', [3, 3, 1, 3]],
  ['sysDashDotDot', [3, 3, 1, 3, 1, 3]], ['sysDot', [1, 1]],
];
const LINE_END_TYPES = new Set(['none', 'triangle', 'stealth', 'diamond', 'oval', 'arrow']);
const LINE_END_SIZES = new Set([2, 3, 5]);
const COMPOUNDS = new Set(['sng', 'dbl', 'thickThin', 'thinThick', 'tri']);
const MAX_LINE_WIDTH = 20116800 / 9525;

function assertLineEnd(value: unknown, label: string): asserts value is LineEnd {
  assertDataObject(value, ['type', 'w', 'h'], label);
  const end = value as { type?: unknown; w?: unknown; h?: unknown };
  if (typeof end.type !== 'string' || !LINE_END_TYPES.has(end.type)
    || typeof end.w !== 'number' || !LINE_END_SIZES.has(end.w)
    || typeof end.h !== 'number' || !LINE_END_SIZES.has(end.h)) {
    throw new Error(`${label} 必须使用可往返的端点类型与 sm/med/lg 尺寸`);
  }
}

export function assertStroke(value: unknown, label: string): asserts value is Stroke {
  assertDataObject(value, ['color', 'width', 'dash', 'cap', 'join', 'head', 'tail', 'compound'], label);
  const stroke = value as Partial<Record<keyof Stroke, unknown>>;
  assertDrawingColor(stroke.color, `${label}.color`);
  if (typeof stroke.width !== 'number' || !Number.isFinite(stroke.width) || stroke.width < 0
    || stroke.width > MAX_LINE_WIDTH
    || !Number.isSafeInteger(Math.round(stroke.width * 9525))) {
    throw new Error(`${label}.width 必须是 DrawingML 范围内可写回的非负有限值`);
  }
  if (stroke.dash !== null) {
    if (!Array.isArray(stroke.dash) || !stroke.dash.length
      || stroke.dash.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
      throw new Error(`${label}.dash 必须是 null 或正有限数数组`);
    }
    const unit = Math.max(stroke.width, 1);
    const normalized = stroke.dash.map((value) => value / unit);
    if (!DASHES.some(([, dash]) => dash.length === normalized.length
      && dash.every((value, index) => Math.abs(value - normalized[index]) < 1e-6))) {
      throw new Error(`${label}.dash 不能映射到 DrawingML 预设虚线`);
    }
  }
  if (stroke.cap !== undefined && !['butt', 'round', 'square'].includes(String(stroke.cap))) {
    throw new Error(`${label}.cap 无效`);
  }
  if (stroke.join !== undefined && !['miter', 'round', 'bevel'].includes(String(stroke.join))) {
    throw new Error(`${label}.join 无效`);
  }
  if (stroke.compound !== undefined
    && (typeof stroke.compound !== 'string' || !COMPOUNDS.has(stroke.compound))) {
    throw new Error(`${label}.compound 无效`);
  }
  if (stroke.head !== undefined) assertLineEnd(stroke.head, `${label}.head`);
  if (stroke.tail !== undefined) assertLineEnd(stroke.tail, `${label}.tail`);
}

export function strokeDashName(stroke: Stroke): string | null {
  if (stroke.dash === null) return null;
  const unit = Math.max(stroke.width, 1);
  const normalized = stroke.dash.map((value) => value / unit);
  return DASHES.find(([, dash]) => dash.length === normalized.length
    && dash.every((value, index) => Math.abs(value - normalized[index]) < 1e-6))?.[0] ?? null;
}

export function normalizeStroke(stroke: Stroke): Stroke {
  const width = Math.round(stroke.width * 9525) / 9525;
  const dashName = strokeDashName(stroke);
  const ratios = dashName === null ? null
    : DASHES.find(([name]) => name === dashName)![1];
  const unit = Math.max(width, 1);
  const normalizeEnd = (end: LineEnd | undefined): LineEnd => ({
    type: end?.type ?? 'none', w: end?.w ?? 3, h: end?.h ?? 3,
  });
  return {
    color: normalizeDrawingColor(stroke.color), width,
    dash: ratios ? ratios.map((ratio) => ratio * unit) : null,
    cap: stroke.cap ?? 'butt', join: stroke.join ?? 'miter',
    head: normalizeEnd(stroke.head), tail: normalizeEnd(stroke.tail),
    compound: stroke.compound ?? 'sng',
  };
}

export function queryElementStroke(doc: EditDoc, ids: readonly ElementId[]): ElementStrokeState {
  if (!ids.length) throw new Error('描边查询至少需要一个元素');
  const values = ids.map((id) => {
    const element = effectiveElement(doc, id);
    if (element.kind !== 'shape' && element.kind !== 'image') {
      throw new Error(`元素不支持描边：${id}`);
    }
    return element.stroke ? normalizeStroke(element.stroke) : null;
  });
  const signature = JSON.stringify(values[0]);
  return {
    value: structuredClone(values[0] ?? null),
    mixed: values.some((value) => JSON.stringify(value) !== signature),
    direct: ids.some((id) => own(doc.elements[id].ovr, 'stroke')),
  };
}
