import { elementOrder, elementParentChildren } from '../element-order';
import { fractionalIndexBetween } from '../fractional-index';
import { effectiveElement } from '../projection';
import {
  composeSpaceMatrices, elementChildrenToSlideMatrix, elementFrameToParentMatrix,
  elementParentToSlideMatrix, invertSpaceMatrix,
} from '../space';
import type { EditDoc, ElementId, ElementRecord, RemovedElementRecord } from '../types';
import type { CommandPatches, ElementHierarchyPatch, UngroupCommand, XfrmField } from './types';
import { elementHasLockedAncestor } from './element-interaction';
import { decomposeFrameMatrix } from './frame-decomposition';
import { cloneElementRecord } from './record-clone';

const FIELDS: readonly XfrmField[] = ['x', 'y', 'w', 'h', 'rot', 'flipH', 'flipV'];
const EPSILON = 1e-8;

function decomposeFrame(
  matrix: Parameters<typeof decomposeFrameMatrix>[0], width: number, height: number, label: string,
) {
  return decomposeFrameMatrix(
    matrix, width, height,
    `${label} 的组合变换会产生 PPTX 无法表达的斜切，不能无损解组`,
  );
}

function sparseTransform(
  record: ElementRecord,
  placement: ReturnType<typeof decomposeFrame>,
): ElementRecord['ovr'] {
  const effective = effectiveRecord(record);
  const target = {
    x: placement.x, y: placement.y, w: placement.w, h: placement.h, rot: placement.rot,
    flipH: placement.reflectH ? !effective.flipH : effective.flipH,
    flipV: effective.flipV,
  };
  if (record.meta.editable === 'frame' && Math.abs(target.rot - effective.rot) > EPSILON) {
    throw new Error(`框架对象 ${record.id} 不能无损写回解组后的旋转`);
  }
  const overrides = structuredClone(record.ovr);
  for (const field of FIELDS) {
    if (typeof target[field] === 'number' && typeof record.src[field] === 'number'
      && Math.abs((target[field] as number) - (record.src[field] as number)) <= EPSILON) {
      delete overrides[field];
    } else if (Object.is(target[field], record.src[field])) delete overrides[field];
    else (overrides as Record<XfrmField, number | boolean>)[field] = target[field];
  }
  return overrides;
}

function effectiveRecord(record: ElementRecord) {
  return { ...record.src, ...record.ovr };
}

function movedMeta(record: ElementRecord, targetParent: string): ElementRecord['meta'] {
  const meta = structuredClone(record.meta);
  if (meta.created) return meta;
  if (meta.sourceParent === targetParent) delete meta.sourceParent;
  else if (meta.sourceParent === undefined) meta.sourceParent = record.parent;
  return meta;
}

function groupRemoval(record: ElementRecord): RemovedElementRecord | null {
  if (record.meta.created) return null;
  return {
    id: record.id, parent: record.parent, meta: structuredClone(record.meta),
    ...(record.meta.origin ? { sourceSpids: [record.meta.origin.spid] } : {}),
  };
}

/** 解组把每个孩子的 frame 分解到外部父空间，并以一个层级 Patch 原子替换组。 */
export function ungroupPatches(doc: EditDoc, command: UngroupCommand, origin: string): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能解组元素');
  const group = doc.elements[command.id];
  if (!group) throw new Error(`找不到待解组元素：${command.id}`);
  if (group.src.kind !== 'group' || group.meta.editable !== 'full' || !group.children?.length) {
    throw new Error(`元素不是可解组的非空组合：${command.id}`);
  }
  if (group.meta.moveLocked || elementHasLockedAncestor(doc, group.id)) {
    throw new Error(`组合已锁定：${command.id}`);
  }
  const effectiveGroup = effectiveElement(doc, group.id);
  if (effectiveGroup.kind !== 'group') throw new Error(`组合投影类型无效：${group.id}`);
  if (Math.abs(effectiveGroup.rot) > EPSILON
    && Math.abs(Math.abs(effectiveGroup.scaleX) - Math.abs(effectiveGroup.scaleY)) > EPSILON) {
    throw new Error('组合同时包含旋转与非等比缩放，不能无损解组');
  }
  const parent = group.parent;
  const siblings = elementParentChildren(doc, parent);
  const groupIndex = siblings.indexOf(group.id);
  if (groupIndex < 0) throw new Error(`组合 ${group.id} 不在父级 children 中`);
  const children = [...group.children];
  const groupToParent = composeSpaceMatrices(
    invertSpaceMatrix(elementParentToSlideMatrix(doc, group.id)),
    elementChildrenToSlideMatrix(doc, group.id),
  );
  const beforeOrder = groupIndex > 0 ? elementOrder(doc.elements[siblings[groupIndex - 1]]) : null;
  const afterOrder = groupIndex + 1 < siblings.length
    ? elementOrder(doc.elements[siblings[groupIndex + 1]]) : null;
  let previous = beforeOrder;
  const moved: Record<ElementId, ElementRecord> = Object.create(null);
  for (const childId of children) {
    const before = doc.elements[childId];
    if (!before) throw new Error(`组合 ${group.id} 引用了不存在的孩子：${childId}`);
    const child = effectiveElement(doc, childId);
    const placement = decomposeFrame(
      composeSpaceMatrices(groupToParent, elementFrameToParentMatrix(child)),
      child.w, child.h, `元素 ${childId}`,
    );
    const order = fractionalIndexBetween(previous, afterOrder, childId);
    previous = order;
    moved[childId] = {
      ...cloneElementRecord(before), parent, z: order, order,
      ovr: sparseTransform(before, placement), meta: movedMeta(before, parent),
    };
  }
  const nextSiblings = [...siblings];
  nextSiblings.splice(groupIndex, 1, ...children);
  const removed = groupRemoval(group);
  const forward: ElementHierarchyPatch = {
    op: 'set', path: ['elements', group.id, 'hierarchy'], origin,
    value: {
      parent, affected: [group.id, ...children],
      records: { [group.id]: null, ...moved }, children: { [parent]: nextSiblings },
      removed: { [group.id]: removed },
    },
  };
  const inverse: ElementHierarchyPatch = {
    op: 'set', path: ['elements', group.id, 'hierarchy'], origin,
    value: {
      parent, affected: [group.id, ...children],
      records: {
        [group.id]: cloneElementRecord(group),
        ...Object.fromEntries(children.map((id) => [id, cloneElementRecord(doc.elements[id])])),
      },
      children: { [parent]: [...siblings], [group.id]: children },
      removed: { [group.id]: null },
    },
  };
  return {
    forward: [forward], inverse: [inverse],
    selection: { kind: 'elements', ids: children, enteredGroup: doc.slides[parent] ? null : parent },
  };
}
