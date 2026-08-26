import type { Effects, Fill, Stroke } from '@web-ppt/core';
import { own } from '../data-validation';
import type { EditDoc } from '../types';
import type {
  CommandPatches, ElementEffectsPatch, ElementFillPatch, ElementStrokePatch,
} from './types';

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export function directFillPatches(
  doc: EditDoc,
  id: string,
  value: Exclude<Fill, { type: 'image' }>,
  origin: string,
): CommandPatches {
  const path = ['elements', id, 'ovr', 'fill'] as const;
  const before = doc.elements[id].ovr.fill;
  const direct = own(doc.elements[id].ovr, 'fill');
  const forward: ElementFillPatch = {
    op: 'set', path, value: structuredClone(value), origin,
  };
  if (!direct) {
    const inverse: ElementFillPatch = { op: 'del', path, origin };
    return { forward: [forward], inverse: [inverse] };
  }
  if (before === undefined) throw new Error(`元素填充覆盖无效：${id}`);
  if (same(before, value)) return { forward: [], inverse: [] };
  {
    const inverse: ElementFillPatch = {
      op: 'set', path, value: structuredClone(before), origin,
    };
    return { forward: [forward], inverse: [inverse] };
  }
}

export function directStrokePatches(
  doc: EditDoc,
  id: string,
  value: Stroke | null,
  origin: string,
): CommandPatches {
  const path = ['elements', id, 'ovr', 'stroke'] as const;
  const before = doc.elements[id].ovr.stroke;
  const direct = own(doc.elements[id].ovr, 'stroke');
  const forward: ElementStrokePatch = {
    op: 'set', path, value: structuredClone(value), origin,
  };
  if (!direct) {
    const inverse: ElementStrokePatch = { op: 'del', path, origin };
    return { forward: [forward], inverse: [inverse] };
  }
  if (before === undefined) throw new Error(`元素描边覆盖无效：${id}`);
  if (same(before, value)) return { forward: [], inverse: [] };
  {
    const inverse: ElementStrokePatch = {
      op: 'set', path, value: structuredClone(before), origin,
    };
    return { forward: [forward], inverse: [inverse] };
  }
}

export function directEffectsPatches(
  doc: EditDoc,
  id: string,
  value: Effects,
  origin: string,
): CommandPatches {
  const path = ['elements', id, 'ovr', 'effects'] as const;
  const before = doc.elements[id].ovr.effects;
  const direct = own(doc.elements[id].ovr, 'effects');
  const forward: ElementEffectsPatch = {
    op: 'set', path, value: structuredClone(value), origin,
  };
  if (!direct) {
    const inverse: ElementEffectsPatch = { op: 'del', path, origin };
    return { forward: [forward], inverse: [inverse] };
  }
  if (before === undefined) throw new Error(`元素效果覆盖无效：${id}`);
  if (same(before, value)) return { forward: [], inverse: [] };
  {
    const inverse: ElementEffectsPatch = {
      op: 'set', path, value: structuredClone(before), origin,
    };
    return { forward: [forward], inverse: [inverse] };
  }
}
