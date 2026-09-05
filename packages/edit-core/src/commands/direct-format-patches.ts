import type { Effects, Fill, Stroke } from '@web-ppt/core';
import { own } from '../data-validation';
import type { EditDoc } from '../types';
import type {
  CommandPatches, ElementEffectsPatch, ElementFillPatch, ElementStrokePatch,
} from './types';

type DirectFormatPatch = ElementFillPatch | ElementStrokePatch | ElementEffectsPatch;
type FormatField = 'fill' | 'stroke' | 'effects';
type FormatValue = { fill: Exclude<Fill, { type: 'image' }>; stroke: Stroke | null; effects: Effects };

/** 三种直设格式共用覆盖/继承语义；字段的值域仍由各命令入口校验。 */
export function directFormatPatches<F extends FormatField>(
  doc: EditDoc,
  id: string,
  field: F,
  value: FormatValue[F],
  origin: string,
): CommandPatches {
  const path = ['elements', id, 'ovr', field] as const;
  const before = doc.elements[id].ovr[field];
  const direct = own(doc.elements[id].ovr, field);
  if (direct) {
    if (before === undefined) throw new Error(`元素 ${id} 的 ${field} 覆盖无效`);
    if (JSON.stringify(before) === JSON.stringify(value)) return { forward: [], inverse: [] };
  }
  const forward = {
    op: 'set', path, value: structuredClone(value), origin,
  } as DirectFormatPatch;
  const inverse = (direct
    ? { op: 'set', path, value: structuredClone(before), origin }
    : { op: 'del', path, origin }) as DirectFormatPatch;
  return { forward: [forward], inverse: [inverse] };
}
