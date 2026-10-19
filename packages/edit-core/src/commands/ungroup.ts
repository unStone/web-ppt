import { placeGroupChild, placeGroupFrame, scalePathData } from '@web-ppt/core';
import type { GroupElement, SlideElement } from '@web-ppt/core';
import { elementOrder, elementParentChildren } from '../element-order';
import { fractionalIndexBetween } from '../fractional-index';
import { effectiveElement } from '../projection';
import { customGeometryFromSvgPath } from '../custom-geometry-path';
import {
  composeSpaceMatrices, elementEditParentToSlideMatrix, groupEditFrameToModelFrame,
  invertSpaceMatrix, renderedElement, renderedFrameToSlideMatrix,
} from '../space';
import type { EditDoc, ElementId, ElementRecord, RemovedElementRecord } from '../types';
import type { CommandPatches, ElementHierarchyPatch, UngroupCommand, XfrmField } from './types';
import { elementHasLockedAncestor } from './element-interaction';
import { decomposeFrameMatrix } from './frame-decomposition';
import { cloneHierarchyRecord } from './hierarchy-record';
import { isCanvasRoot } from '../design-target';
import { ungroupInsertionSources } from './ungroup-source';

const FIELDS: readonly XfrmField[] = ['x', 'y', 'w', 'h', 'rot', 'flipH', 'flipV'];
const EPSILON = 1e-8;

function decomposeFrame(
  matrix: Parameters<typeof decomposeFrameMatrix>[0], width: number, height: number, label: string,
) {
  return decomposeFrameMatrix(
    matrix, width, height,
    `${label} 的渲染外框退化或不是刚体，无法写回 PPTX frame，不能无损解组`,
  );
}

function sparseTransform(
  record: ElementRecord,
  placement: ReturnType<typeof decomposeFrame>,
  overrides: ElementRecord['ovr'] = structuredClone(record.ovr),
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

/**
 * 非等比组缩放会把预设几何的路径按轴拉伸；解组后若让投影按新外框重算预设，
 * 箭头、圆角等依赖宽高比例的几何会变形。把渲染路径固化成自由形状覆盖，保存时写回 custGeom。
 */
function bakeScaledShapePath(
  group: GroupElement,
  parent: GroupElement | null,
  child: SlideElement,
  placement: ReturnType<typeof decomposeFrame>,
  record: ElementRecord,
  overrides: ElementRecord['ovr'],
): void {
  if (record.meta.editable !== 'full' || child.kind !== 'shape' || !child.path) return;
  const own = placeGroupFrame(group, child);
  // 父组先按组的转角缩放整组，解组后改按孩子的最终转角缩放；象限不同时两轴的顺序会互换。
  const before = parent ? placeGroupFrame(parent, group) : null;
  const after = parent ? placeGroupFrame(parent, { ...child, ...placement }) : null;
  const ratioX = before && after ? before.kx / after.kx : 1;
  const ratioY = before && after ? before.ky / after.ky : 1;
  const remap = Math.abs(ratioX - 1) > EPSILON || Math.abs(ratioY - 1) > EPSILON;
  if (Math.abs(own.kx - own.ky) <= EPSILON && !remap) return;
  const placed = placeGroupChild(group, child);
  if (placed.kind !== 'shape' || !placed.path) return;
  const width = placed.w * ratioX;
  const height = placed.h * ratioY;
  if (width <= 0 || height <= 0) return;
  const path = remap ? scalePathData(placed.path, ratioX, ratioY) : placed.path;
  overrides.geometry = customGeometryFromSvgPath(path, width, height, child.openGeom === true);
  delete overrides.presetGeometry;
}

function movedMeta(
  record: ElementRecord,
  targetParent: string,
  meta: ElementRecord['meta'] = structuredClone(record.meta),
): ElementRecord['meta'] {
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
  const parent = group.parent;
  const parentRecord = doc.elements[parent];
  if (parentRecord && parentRecord.src.kind !== 'group') {
    throw new Error(`组合 ${group.id} 的父级不是画布或组合：${parent}`);
  }
  const siblings = elementParentChildren(doc, parent);
  const groupIndex = siblings.indexOf(group.id);
  if (groupIndex < 0) throw new Error(`组合 ${group.id} 不在父级 children 中`);
  const children = [...group.children];
  const sources = ungroupInsertionSources(doc, group);
  // 渲染器把组 chOff/chExt 折算进孩子外框，不再对子树整体缩放；因此按渲染外框求孩子
  // 在父级编辑坐标里的刚体矩阵，而不是组合仿射矩阵（后者会把非等比缩放与旋转合成斜切）。
  const parentToEdit = invertSpaceMatrix(elementEditParentToSlideMatrix(doc, group.id));
  const parentPlaced = parentRecord ? renderedElement(doc, parent) : null;
  if (parentPlaced && parentPlaced.kind !== 'group') {
    throw new Error(`组合 ${group.id} 的父级投影不是组合：${parent}`);
  }
  const beforeOrder = groupIndex > 0 ? elementOrder(doc.elements[siblings[groupIndex - 1]]) : null;
  const afterOrder = groupIndex + 1 < siblings.length
    ? elementOrder(doc.elements[siblings[groupIndex + 1]]) : null;
  let previous = beforeOrder;
  const moved: Record<ElementId, ElementRecord> = Object.create(null);
  for (const childId of children) {
    const before = doc.elements[childId];
    if (!before) throw new Error(`组合 ${group.id} 引用了不存在的孩子：${childId}`);
    const child = renderedElement(doc, childId);
    const editFrame = decomposeFrame(
      composeSpaceMatrices(parentToEdit, renderedFrameToSlideMatrix(doc, childId)),
      child.w, child.h, `元素 ${childId}`,
    );
    // 父级是组合时，模型坐标还要去掉父组的 chOff/chExt 缩放；画布根直接使用编辑坐标。
    const placement = parentRecord
      ? { ...groupEditFrameToModelFrame(doc, parent, editFrame), reflectH: editFrame.reflectH }
      : editFrame;
    const order = fractionalIndexBetween(previous, afterOrder, childId);
    previous = order;
    const cloned = cloneHierarchyRecord(before);
    const overrides = sparseTransform(before, placement, cloned.ovr);
    bakeScaledShapePath(effectiveGroup, parentPlaced, effectiveElement(doc, childId),
      placement, before, overrides);
    moved[childId] = {
      ...cloned, parent, z: order, order,
      ovr: overrides,
      meta: { ...movedMeta(before, parent, cloned.meta),
        ...(sources.has(childId) ? { insertion: sources.get(childId)! } : {}),
      },
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
        [group.id]: cloneHierarchyRecord(group),
        ...Object.fromEntries(children.map((id) => [id, cloneHierarchyRecord(doc.elements[id])])),
      },
      children: { [parent]: [...siblings], [group.id]: children },
      removed: { [group.id]: null },
    },
  };
  return {
    forward: [forward], inverse: [inverse],
    selection: { kind: 'elements', ids: children, enteredGroup: isCanvasRoot(doc, parent) ? null : parent },
  };
}
