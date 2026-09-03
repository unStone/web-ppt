import { canvasTargetOfElement, sameCanvas } from '../design-target';
import { effectiveElement } from '../projection';
import { outermostSelectedElementIds } from '../selection';
import {
  elementFrameToSlideMatrix, elementParentToSlideMatrix, inverseTransformSpaceVector,
  transformSpacePoint,
} from '../space';
import type { SpacePoint } from '../space';
import type { EditDoc, ElementId } from '../types';
import { elementTransformPatches } from './element-transform';
import type { CommandPatches } from './types';

export interface ElementWorldBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface ArrangementTarget {
  readonly id: ElementId;
  readonly bounds: ElementWorldBounds;
}

const cleanDelta = (value: number): number => Math.abs(value) < 1e-9 ? 0 : value;

export function elementWorldBounds(doc: EditDoc, id: ElementId): ElementWorldBounds {
  const element = effectiveElement(doc, id);
  const matrix = elementFrameToSlideMatrix(doc, id);
  const points = [
    { x: 0, y: 0 }, { x: element.w, y: 0 },
    { x: element.w, y: element.h }, { x: 0, y: element.h },
  ].map((point) => transformSpacePoint(matrix, point));
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

/** 排列命令共享“同页、可移动、最外层”边界，避免对齐与分布逐渐产生两套语义。 */
export function arrangementTargets(
  doc: EditDoc,
  ids: readonly ElementId[],
  minimum: number,
  label: string,
): ArrangementTarget[] {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能执行命令');
  if (!Array.isArray(ids) || ids.length < minimum
    || ids.some((id) => typeof id !== 'string' || !id)) {
    throw new Error(`${label}.ids 必须是至少 ${minimum} 项的元素 id 数组`);
  }
  if (new Set(ids).size !== ids.length) throw new Error(`${label}.ids 不能包含重复 id`);
  const records = ids.map((id) => {
    const record = doc.elements[id];
    if (!record) throw new Error(`找不到元素：${id}`);
    if (record.meta.editable === 'none') throw new Error(`元素不可编辑：${id}`);
    if (record.meta.locked || record.meta.moveLocked) throw new Error(`元素已锁定：${id}`);
    return record;
  });
  const canvas = canvasTargetOfElement(doc, records[0].id);
  if (records.some((record) => !sameCanvas(canvasTargetOfElement(doc, record.id), canvas))) {
    throw new Error(`${label} 不能跨画布`);
  }
  const outermost = outermostSelectedElementIds(doc, ids);
  if (outermost.length < minimum) {
    throw new Error(`${label} 至少需要 ${minimum} 个最外层对象`);
  }
  return outermost.map((id) => ({ id, bounds: elementWorldBounds(doc, id) }));
}

export function translateElementInSlide(
  doc: EditDoc,
  id: ElementId,
  worldDelta: SpacePoint,
  origin: string,
  label: string,
): CommandPatches {
  const delta = inverseTransformSpaceVector(elementParentToSlideMatrix(doc, id), worldDelta);
  const element = effectiveElement(doc, id);
  const x = cleanDelta(delta.x) ? element.x + delta.x : undefined;
  const y = cleanDelta(delta.y) ? element.y + delta.y : undefined;
  return x === undefined && y === undefined
    ? { forward: [], inverse: [] }
    : elementTransformPatches(doc, id, { x, y }, ['x', 'y'], origin, label);
}
