import { slideOfElement } from '../projection';
import { elementOrder, elementParentChildren } from '../element-order';
import type { EditDoc, ElementId, ElementRecord } from '../types';
import type {
  CommandPatches, ElementTreePatch, ElementTreeSnapshot, Patch, RemoveElementCommand,
} from './types';
import { clearElementTextPatches } from './element-text';

export function willRemoveElementStructure(record: ElementRecord | undefined): boolean {
  return !(record?.meta.ph && record.src.kind === 'shape' && record.src.text
    && record.ovr.text?.kind !== 'empty');
}

export function isElementTreePatch(patch: Patch): patch is ElementTreePatch {
  return patch.path.length === 2;
}

function cloneRecord(record: ElementRecord): ElementRecord {
  return structuredClone(record);
}

function snapshotTree(doc: EditDoc, root: ElementId): ElementTreeSnapshot {
  const record = doc.elements[root];
  if (!record) throw new Error(`找不到元素：${root}`);
  const siblings = elementParentChildren(doc, record.parent);
  if (!siblings.includes(root)) throw new Error(`元素 ${root} 不在父节点 children 中`);
  const records: Record<ElementId, ElementRecord> = Object.create(null);
  const visit = (id: ElementId): void => {
    const current = doc.elements[id];
    if (!current) throw new Error(`删除树引用不存在的元素：${id}`);
    records[id] = cloneRecord(current);
    for (const child of current.children ?? []) visit(child);
  };
  visit(root);
  return { root, parent: record.parent, records };
}

export function removeElementPatches(
  doc: EditDoc,
  command: RemoveElementCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能执行命令');
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if (record.meta.editable === 'none') throw new Error(`元素不可编辑：${command.id}`);
  if (record.meta.locked) throw new Error(`元素已锁定：${command.id}`);
  if (!willRemoveElementStructure(record)) {
    return clearElementTextPatches(doc, command.id, origin);
  }
  const value = snapshotTree(doc, command.id);
  const path = ['elements', command.id] as const;
  return {
    forward: [{ op: 'remove', path, value, origin }],
    inverse: [{ op: 'insert', path, value, origin }],
  };
}

function assertSnapshot(snapshot: ElementTreeSnapshot, id: ElementId, label: string): void {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.root !== id
    || typeof snapshot.parent !== 'string' || !snapshot.parent
    || !snapshot.records || typeof snapshot.records !== 'object') {
    throw new Error(`${label} 的元素树快照无效`);
  }
  const ids = Object.keys(snapshot.records);
  if (!ids.length || !snapshot.records[id]) throw new Error(`${label} 的元素树缺少根记录`);
  const reached = new Set<ElementId>();
  const visit = (currentId: ElementId, parent: string): void => {
    if (reached.has(currentId)) throw new Error(`${label} 的元素树成环或重复引用：${currentId}`);
    const record = snapshot.records[currentId];
    if (!record || record.id !== currentId || record.parent !== parent) {
      throw new Error(`${label} 的元素树父链无效：${currentId}`);
    }
    reached.add(currentId);
    for (const child of record.children ?? []) visit(child, currentId);
  };
  visit(id, snapshot.parent);
  if (reached.size !== ids.length) throw new Error(`${label} 的元素树包含孤儿记录`);
}

export function validateElementTreePatch(doc: EditDoc, patch: ElementTreePatch, index: number): void {
  const id = patch.path[1];
  assertSnapshot(patch.value, id, `Patch ${index}`);
  const siblings = elementParentChildren(doc, patch.value.parent);
  if (patch.op === 'remove') {
    if (!doc.elements[id] || !siblings.includes(id)) {
      throw new Error(`Patch ${index} 的删除元素与当前模型不一致`);
    }
    for (const treeId of Object.keys(patch.value.records)) {
      if (!doc.elements[treeId]) throw new Error(`Patch ${index} 指向不存在的树元素：${treeId}`);
    }
  } else {
    for (const treeId of Object.keys(patch.value.records)) {
      if (doc.elements[treeId]) throw new Error(`Patch ${index} 插入的元素已存在：${treeId}`);
    }
  }
}

export function applyElementTreePatch(doc: EditDoc, patch: ElementTreePatch): void {
  const snapshot = patch.value;
  const siblings = elementParentChildren(doc, snapshot.parent);
  if (patch.op === 'remove') {
    const index = siblings[siblings.length - 1] === snapshot.root
      ? siblings.length - 1 : siblings.indexOf(snapshot.root);
    if (index < 0) throw new Error(`删除元素不在父节点 children 中：${snapshot.root}`);
    siblings.splice(index, 1);
    for (const id of Object.keys(snapshot.records)) delete doc.elements[id];
    const root = snapshot.records[snapshot.root];
    if (root.meta.created) delete doc.removedElements[snapshot.root];
    else {
      doc.removedElements[snapshot.root] = {
        id: root.id,
        parent: root.parent,
        meta: structuredClone(root.meta),
      };
    }
    return;
  }
  for (const [id, record] of Object.entries(snapshot.records)) {
    doc.elements[id] = cloneRecord(record);
    const anchor = record.meta.origin;
    const next = anchor && doc.identity.nextSpid[anchor.part];
    // 远端结构 patch 不经过本地分配器；已初始化的 part 计数仍必须越过它的 spid。
    if (anchor && next !== undefined && next <= anchor.spid) {
      doc.identity.nextSpid[anchor.part] = anchor.spid + 1;
    }
  }
  delete doc.removedElements[snapshot.root];
  // 多根删除时，快照下标取自不断收缩的数组，不能作为跨进程回放的位置依据；z 才是稳定顺序。
  const rootZ = elementOrder(snapshot.records[snapshot.root]);
  const last = siblings[siblings.length - 1];
  const lastRecord = last ? doc.elements[last] : null;
  if (last && !lastRecord) throw new Error(`父节点 children 引用了不存在的元素：${last}`);
  if (!lastRecord || elementOrder(lastRecord) < rootZ) {
    siblings.push(snapshot.root);
    return;
  }
  let low = 0;
  let high = siblings.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const sibling = doc.elements[siblings[middle]];
    if (!sibling) throw new Error(`父节点 children 引用了不存在的元素：${siblings[middle]}`);
    if (elementOrder(sibling) > rootZ) high = middle;
    else low = middle + 1;
  }
  siblings.splice(low, 0, snapshot.root);
}

export function elementTreeSlide(doc: EditDoc, snapshot: ElementTreeSnapshot): string {
  return doc.slides[snapshot.parent]
    ? snapshot.parent
    : slideOfElement(doc, snapshot.parent as ElementId);
}
