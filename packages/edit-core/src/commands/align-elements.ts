import { effectiveElement, slideOfElement } from '../projection';
import { outermostSelectedElementIds } from '../selection';
import {
  elementFrameToSlideMatrix, elementParentToSlideMatrix, inverseTransformSpaceVector, transformSpacePoint,
} from '../space';
import type { SpacePoint } from '../space';
import type { EditDoc, ElementId } from '../types';
import { elementTransformPatches } from './element-transform';
import type { AlignEdge, AlignElementsCommand, CommandPatches, Patch } from './types';

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const EDGES = new Set<AlignEdge>(['left', 'center', 'right', 'top', 'middle', 'bottom']);
const HORIZONTAL = new Set<AlignEdge>(['left', 'center', 'right']);
const cleanDelta = (value: number): number => Math.abs(value) < 1e-9 ? 0 : value;

function elementBounds(doc: EditDoc, id: ElementId): Bounds {
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

function unionBounds(bounds: readonly Bounds[]): Bounds {
  return {
    left: Math.min(...bounds.map((value) => value.left)),
    top: Math.min(...bounds.map((value) => value.top)),
    right: Math.max(...bounds.map((value) => value.right)),
    bottom: Math.max(...bounds.map((value) => value.bottom)),
  };
}

function edgeValue(bounds: Bounds, edge: AlignEdge): number {
  if (edge === 'left') return bounds.left;
  if (edge === 'center') return (bounds.left + bounds.right) / 2;
  if (edge === 'right') return bounds.right;
  if (edge === 'top') return bounds.top;
  if (edge === 'middle') return (bounds.top + bounds.bottom) / 2;
  return bounds.bottom;
}

function assertCommand(doc: EditDoc, command: AlignElementsCommand): ElementId[] {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能执行命令');
  if (!Array.isArray(command.ids) || !command.ids.length
    || command.ids.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('AlignElements.ids 必须是非空元素 id 数组');
  }
  if (new Set(command.ids).size !== command.ids.length) {
    throw new Error('AlignElements.ids 不能包含重复 id');
  }
  if (!EDGES.has(command.edge)) throw new Error(`未知对齐边：${String(command.edge)}`);
  const records = command.ids.map((id) => {
    const record = doc.elements[id];
    if (!record) throw new Error(`找不到元素：${id}`);
    if (record.meta.editable === 'none') throw new Error(`元素不可编辑：${id}`);
    if (record.meta.locked || record.meta.moveLocked) throw new Error(`元素已锁定：${id}`);
    return record;
  });
  const slide = slideOfElement(doc, records[0].id);
  if (records.some((record) => slideOfElement(doc, record.id) !== slide)) {
    throw new Error('同一对齐命令不能跨幻灯片');
  }
  return outermostSelectedElementIds(doc, command.ids);
}

function worldDelta(item: Bounds, target: Bounds, edge: AlignEdge): SpacePoint {
  const value = edgeValue(target, edge) - edgeValue(item, edge);
  return HORIZONTAL.has(edge) ? { x: value, y: 0 } : { x: 0, y: value };
}

/** 一个命令直接产出全部位置 patch，避免宿主把六按钮能力错误拆成多段历史。 */
export function alignElementsPatches(
  doc: EditDoc,
  command: AlignElementsCommand,
  origin: string,
): CommandPatches {
  const ids = assertCommand(doc, command);
  const items = ids.map((id) => ({ id, bounds: elementBounds(doc, id) }));
  const slideBounds = { left: 0, top: 0, right: doc.meta.width, bottom: doc.meta.height };
  const target = items.length === 1 ? slideBounds : unionBounds(items.map((item) => item.bounds));
  const forward: Patch[] = [];
  const inverse: Patch[] = [];
  for (const item of items) {
    const delta = inverseTransformSpaceVector(
      elementParentToSlideMatrix(doc, item.id),
      worldDelta(item.bounds, target, command.edge),
    );
    const element = effectiveElement(doc, item.id);
    const x = cleanDelta(delta.x) ? element.x + delta.x : undefined;
    const y = cleanDelta(delta.y) ? element.y + delta.y : undefined;
    if (x === undefined && y === undefined) continue;
    const patches = elementTransformPatches(doc, item.id, { x, y }, ['x', 'y'], origin, 'AlignElements');
    forward.push(...patches.forward);
    inverse.unshift(...patches.inverse);
  }
  return { forward, inverse };
}
