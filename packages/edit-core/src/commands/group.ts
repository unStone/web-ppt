import type { GroupElement } from '@web-ppt/core';
import { allocateElementId } from '../document';
import { elementOrder, elementParentChildren } from '../element-order';
import { initialFractionalIndex } from '../fractional-index';
import { effectiveElement } from '../projection';
import { elementFrameToParentMatrix, transformSpacePoint } from '../space';
import type { EditDoc, ElementId, ElementInsertionSource, ElementRecord } from '../types';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { assertDataArray } from '../data-validation';
import { assertFrameRect, pxToEmu } from './insertion-rect';
import { allocateElementSpid } from './spid';
import { elementHasLockedAncestor } from './element-interaction';
import type { CommandPatches, ElementHierarchyPatch, GroupCommand } from './types';
import { cloneElementRecord } from './record-clone';

interface GroupFrame { x: number; y: number; w: number; h: number }

function assertIds(ids: unknown): asserts ids is readonly ElementId[] {
  assertDataArray(ids, 'Group.ids');
  if (ids.length < 2 || ids.some((id) => typeof id !== 'string' || !id)
    || new Set(ids).size !== ids.length) {
    throw new Error('Group.ids 必须包含至少两个不重复元素身份');
  }
}

function groupFrame(doc: EditDoc, ids: readonly ElementId[]): GroupFrame {
  const points = ids.flatMap((id) => {
    const element = effectiveElement(doc, id);
    const matrix = elementFrameToParentMatrix(element);
    return [
      { x: 0, y: 0 }, { x: element.w, y: 0 },
      { x: element.w, y: element.h }, { x: 0, y: element.h },
    ].map((point) => transformSpacePoint(matrix, point));
  });
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const frame = {
    x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
  };
  assertFrameRect(frame, '组合边界');
  return frame;
}

function groupMarkup(spid: number, name: string, frame: GroupFrame): string {
  return `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="${spid}" name="${name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${pxToEmu(frame.x)}" y="${pxToEmu(frame.y)}"/>
<a:ext cx="${pxToEmu(frame.w)}" cy="${pxToEmu(frame.h)}"/>
<a:chOff x="${pxToEmu(frame.x)}" y="${pxToEmu(frame.y)}"/>
<a:chExt cx="${pxToEmu(frame.w)}" cy="${pxToEmu(frame.h)}"/></a:xfrm></p:grpSpPr>
</p:grpSp>`;
}

function insertionSource(spid: number, name: string, frame: GroupFrame): ElementInsertionSource {
  return {
    markup: groupMarkup(spid, name, frame),
    namespaces: { 'xmlns:a': DRAWINGML_NS, 'xmlns:p': PRESENTATIONML_NS },
    spids: { [String(spid)]: spid },
    containsDescendants: false,
  };
}

function sourceGroup(spid: number | undefined, name: string, frame: GroupFrame): GroupElement {
  return {
    kind: 'group', ...(spid === undefined ? {} : { id: spid }), name,
    ...frame, rot: 0, flipH: false, flipV: false,
    childX: frame.x, childY: frame.y, scaleX: 1, scaleY: 1, children: [],
  };
}

/** 新组是空 OOXML 容器；孩子保留原身份与变换，只改变直属父链。 */
export function groupPatches(doc: EditDoc, command: GroupCommand, origin: string): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能组合元素');
  assertIds(command.ids);
  const records = command.ids.map((id) => {
    const record = doc.elements[id];
    if (!record) throw new Error(`找不到组合元素：${id}`);
    if (record.meta.editable === 'none' || record.meta.inherited) throw new Error(`元素不可组合：${id}`);
    if (record.meta.moveLocked || elementHasLockedAncestor(doc, id)) throw new Error(`元素已锁定：${id}`);
    return record;
  });
  const parent = records[0].parent;
  if (records.some((record) => record.parent !== parent)) throw new Error('只能组合同一父级的直属元素');
  const siblings = elementParentChildren(doc, parent);
  if (records.some((record) => !siblings.includes(record.id))) throw new Error('组合元素不在父级 children 中');
  const ordered = siblings.filter((id) => command.ids.includes(id));
  const part = records[0].meta.origin?.part;
  if (doc.package && (!part || records.some((record) => record.meta.origin?.part !== part))) {
    throw new Error('组合元素缺少统一的 OOXML 写回 part');
  }
  const frame = groupFrame(doc, ordered);
  const id = allocateElementId(doc);
  const spid = part ? allocateElementSpid(doc, part) : undefined;
  const name = spid === undefined ? '组合' : `组合 ${spid}`;
  const top = ordered.reduce((candidate, current) =>
    elementOrder(doc.elements[current]) > elementOrder(doc.elements[candidate]) ? current : candidate);
  const group: ElementRecord = {
    id, parent, z: elementOrder(doc.elements[top]),
    src: sourceGroup(spid, name, frame), ovr: {},
    meta: {
      editable: 'full', created: true,
      ...(part && spid !== undefined ? {
        origin: { part, spid }, insertion: insertionSource(spid, name, frame),
      } : {}),
    },
    children: ordered,
  };
  const moved = Object.fromEntries(ordered.map((childId, index) => {
    const before = doc.elements[childId];
    const { order: _order, ...withoutOrder } = cloneElementRecord(before);
    const z = initialFractionalIndex(index);
    return [childId, {
      ...withoutOrder, parent: id, z, order: z,
      meta: {
        ...structuredClone(before.meta),
        ...(!before.meta.created && before.meta.sourceParent === undefined
          ? { sourceParent: before.parent } : {}),
      },
    } satisfies ElementRecord];
  }));
  const nextSiblings = siblings.filter((childId) => !command.ids.includes(childId));
  const insertionIndex = nextSiblings.findIndex((childId) =>
    elementOrder(doc.elements[childId]) > group.z);
  nextSiblings.splice(insertionIndex < 0 ? nextSiblings.length : insertionIndex, 0, id);
  const forward: ElementHierarchyPatch = {
    op: 'set', path: ['elements', id, 'hierarchy'], origin,
    value: {
      parent, affected: [id, ...ordered],
      records: { [id]: group, ...moved },
      children: { [parent]: nextSiblings, [id]: ordered },
      removed: { [id]: null },
    },
  };
  const inverse: ElementHierarchyPatch = {
    op: 'set', path: ['elements', id, 'hierarchy'], origin,
    value: {
      parent, affected: [id, ...ordered],
      records: {
        [id]: null,
        ...Object.fromEntries(ordered.map((childId) => [
          childId, cloneElementRecord(doc.elements[childId]),
        ])),
      },
      children: { [parent]: [...siblings] },
      removed: { [id]: null },
    },
  };
  return {
    forward: [forward], inverse: [inverse],
    selection: { kind: 'elements', ids: [id], enteredGroup: doc.slides[parent] ? null : parent },
  };
}
