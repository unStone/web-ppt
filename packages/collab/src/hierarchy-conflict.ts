import type {
  EditDoc, ElementHierarchyPatch, ElementRecord, ElementTreePatch, Patch, RemovedElementRecord,
} from '@web-ppt/edit-core';

const XFRM_FIELDS = ['x', 'y', 'w', 'h', 'rot', 'flipH', 'flipV'] as const;
type HierarchyField = 'order' | typeof XFRM_FIELDS[number];

export const hierarchyRecords = (patch: Patch): Readonly<Record<string, ElementRecord | null>> | null =>
  patch.op === 'set' && patch.path.length === 3 && patch.path[0] === 'elements'
    && patch.path[2] === 'hierarchy'
    ? (patch as ElementHierarchyPatch).value.records : null;

/** 删除成员不应被并发组合/解组复活；其 tombstone 同步迁到层级意图的目标父链。 */
export function hierarchyWithoutRemovedMembers(
  doc: EditDoc,
  patch: ElementHierarchyPatch,
  removedIds: ReadonlySet<string>,
): ElementHierarchyPatch | null {
  const root = patch.path[1];
  if (removedIds.has(patch.value.parent)) return null;
  if (removedIds.has(root) && patch.value.records[root] !== null) return null;
  const omitted = Object.keys(patch.value.records).filter((id) =>
    id !== root && removedIds.has(id) && patch.value.records[id] !== null);
  if (!omitted.length) return patch;
  const result = structuredClone(patch) as ElementHierarchyPatch;
  const state = result.value as unknown as {
    affected: string[];
    records: Record<string, ElementRecord | null>;
    children: Record<string, string[]>;
    removed: Record<string, RemovedElementRecord | null>;
  };
  const omittedSet = new Set(omitted);
  for (const id of omitted) {
    const target = state.records[id]!;
    const previous = doc.removedElements[id];
    state.removed[id] = previous ? structuredClone(previous) : {
      id, parent: target.parent, meta: structuredClone(target.meta),
      ...(target.meta.origin ? { sourceSpids: [target.meta.origin.spid] } : {}),
    };
    delete state.records[id];
    delete state.children[id];
  }
  state.affected = state.affected.filter((id) => !omittedSet.has(id));
  for (const [parent, children] of Object.entries(state.children)) {
    state.children[parent] = children.filter((id) => !omittedSet.has(id));
  }
  for (const record of Object.values(state.records)) {
    if (record?.children) record.children = record.children.filter((id) => !omittedSet.has(id));
  }
  return result;
}

/** 重叠结构意图只裁掉已被更新 stamp 接管的成员；不相交成员仍可交换合并。 */
export function hierarchyWithoutNewerMembers(
  patch: ElementHierarchyPatch,
  newerIds: ReadonlySet<string>,
): ElementHierarchyPatch | null {
  if (!newerIds.size) return patch;
  const root = patch.path[1];
  const rootRecord = patch.value.records[root];
  // Ungroup 删除外层容器；它必须压过容器内部的并发结构编辑，不能只拆一半。
  if (rootRecord === null) return patch;
  if (newerIds.has(root)) return null;
  const result = structuredClone(patch) as ElementHierarchyPatch;
  const state = result.value as unknown as {
    affected: string[];
    records: Record<string, ElementRecord | null>;
    children: Record<string, string[]>;
  };
  const members = (state.children[root] ?? []).filter((id) => !newerIds.has(id));
  if (!members.length) return null;
  for (const id of newerIds) {
    if (id === root) continue;
    delete state.records[id];
    delete state.children[id];
  }
  state.children[root] = members;
  const retained = new Set([root, ...members]);
  state.affected = state.affected.filter((id) => retained.has(id));
  return result;
}

function parentChildren(doc: EditDoc, parent: string): readonly string[] {
  return doc.slides[parent]?.children ?? doc.elements[parent]?.children ?? [];
}

function recordOrder(record: ElementRecord): string {
  return record.order ?? record.z;
}

function sortedChildren(
  ids: Iterable<string>, records: Readonly<Record<string, ElementRecord | null>>, doc: EditDoc,
): string[] {
  return [...new Set(ids)].filter((id) => records[id] !== null && !!(records[id] ?? doc.elements[id]))
    .sort((left, right) => {
      const leftRecord = records[left] ?? doc.elements[left];
      const rightRecord = records[right] ?? doc.elements[right];
      const leftOrder = recordOrder(leftRecord!);
      const rightOrder = recordOrder(rightRecord!);
      const order = leftOrder < rightOrder ? -1 : leftOrder === rightOrder ? 0 : 1;
      return order || (left < right ? -1 : left === right ? 0 : 1);
    });
}

function mergeMovedRecord(
  current: ElementRecord,
  target: ElementRecord,
  applyField: (id: string, field: HierarchyField) => boolean,
  ungroup: boolean,
): ElementRecord {
  const merged = structuredClone(current);
  merged.parent = target.parent;
  merged.z = target.z;
  if (applyField(target.id, 'order')) {
    if (target.order === undefined) delete merged.order;
    else merged.order = target.order;
  }
  if (target.meta.sourceParent === undefined) delete merged.meta.sourceParent;
  else merged.meta.sourceParent = target.meta.sourceParent;
  if (ungroup) for (const field of XFRM_FIELDS) {
    if (!applyField(target.id, field)) continue;
    if (Object.prototype.hasOwnProperty.call(target.ovr, field)) {
      (merged.ovr as Record<string, unknown>)[field] = target.ovr[field];
    } else delete (merged.ovr as Record<string, unknown>)[field];
  }
  return merged;
}

function currentTreeSnapshot(
  doc: EditDoc,
  root: string,
  include: ReadonlySet<string>,
): ElementTreePatch['value'] {
  const first = doc.elements[root];
  if (!first) throw new Error(`协同层级闭包找不到元素：${root}`);
  const records: Record<string, ElementRecord> = Object.create(null);
  const visit = (id: string): void => {
    if (!include.has(id)) return;
    const record = doc.elements[id];
    if (!record) throw new Error(`协同层级闭包找不到后代：${id}`);
    records[id] = {
      ...structuredClone(record),
      ...(record.children ? { children: record.children.filter((child) => include.has(child)) } : {}),
    };
    for (const child of record.children ?? []) visit(child);
  };
  visit(root);
  return { root, parent: first.parent, records };
}

function currentTreeIds(doc: EditDoc, roots: readonly string[]): Set<string> {
  const result = new Set<string>();
  const visit = (id: string): void => {
    if (result.has(id)) return;
    const record = doc.elements[id];
    if (!record) throw new Error(`协同层级闭包找不到元素：${id}`);
    result.add(id);
    for (const child of record.children ?? []) visit(child);
  };
  roots.forEach(visit);
  return result;
}

/**
 * 层级 patch 是命令时快照，不能直接覆盖并发后的整棵树：成员字段从当前模型重基，
 * 同父级的不相交组合按 order 合并；重叠组合中落败的新组只保留未被赢家接管的孩子。
 */
export function rebaseElementHierarchy(
  doc: EditDoc,
  patch: ElementHierarchyPatch,
  applyField: (id: string, field: HierarchyField) => boolean,
): ElementHierarchyPatch {
  const result = structuredClone(patch) as ElementHierarchyPatch;
  // 外部父级尚未落模时，Patch 描述的是同一因果链里的自包含结构；基线空 children 不能覆盖其兄弟。
  if (!doc.slides[patch.value.parent] && !doc.elements[patch.value.parent]) return result;
  const state = result.value as unknown as {
    parent: string;
    affected: string[];
    records: Record<string, ElementRecord | null>;
    children: Record<string, string[]>;
    removed: Record<string, RemovedElementRecord | null>;
  };
  const root = patch.path[1];
  const rootTarget = state.records[root];
  const ungroup = rootTarget === null;
  const members = Object.entries(state.records).flatMap(([id, record]) =>
    id !== root && record !== null ? [id] : []);
  const memberSet = new Set(members);
  const removedByUngroup = new Set<string>();

  if (ungroup) {
    const protectedIds = currentTreeIds(doc, members.filter((id) => !!doc.elements[id]));
    const currentRoot = doc.elements[root];
    if (currentRoot) for (const id of currentTreeIds(doc, [root])) {
      if (id !== root && !protectedIds.has(id)) removedByUngroup.add(id);
    }
    const deletionRoots = [...removedByUngroup].filter((id) =>
      !removedByUngroup.has(doc.elements[id]?.parent ?? ''));
    for (const id of removedByUngroup) {
      state.records[id] = null;
      state.affected.push(id);
      delete state.children[id];
    }
    for (const deletionRoot of deletionRoots) {
      const snapshot = currentTreeSnapshot(doc, deletionRoot, removedByUngroup);
      const deletedRoot = snapshot.records[deletionRoot];
      if (deletedRoot.meta.created) {
        state.removed[deletionRoot] = null;
        for (const record of Object.values(snapshot.records)) {
          if (!record.meta.created && record.meta.sourceParent !== undefined) {
            state.removed[record.id] = deletionTombstone(snapshot, record);
          }
        }
      } else state.removed[deletionRoot] = deletionTombstone(snapshot, deletedRoot);
    }
  }

  for (const id of members) {
    const current = doc.elements[id];
    const target = state.records[id];
    if (current && target) {
      state.records[id] = mergeMovedRecord(current, target, applyField, ungroup);
    }
  }

  const superseded = new Set<string>();
  for (const id of members) {
    const currentParent = doc.elements[id]?.parent;
    if (currentParent && currentParent !== state.parent && currentParent !== root) {
      const group = doc.elements[currentParent];
      const expectedParent = ungroup ? root : state.parent;
      if (group?.src.kind === 'group' && group.meta.created && group.parent === expectedParent) {
        superseded.add(currentParent);
      }
    }
  }
  const deletedGroups = new Set<string>();
  for (const id of superseded) {
    const group = doc.elements[id]!;
    const remaining = (group.children ?? []).filter((child) =>
      !memberSet.has(child) && !removedByUngroup.has(child));
    state.affected.push(id);
    if (remaining.length) {
      state.records[id] = { ...structuredClone(group), children: remaining };
      state.children[id] = remaining;
    } else {
      state.records[id] = null;
      state.removed[id] = null;
      delete state.children[id];
      deletedGroups.add(id);
    }
  }

  if (ungroup) {
    const currentRootParent = doc.elements[root]?.parent;
    const outer = currentRootParent ? doc.elements[currentRootParent] : undefined;
    if (outer?.src.kind === 'group' && currentRootParent !== state.parent) {
      const remaining = (outer.children ?? []).filter((child) => child !== root);
      state.affected.push(outer.id);
      if (remaining.length || !outer.meta.created) {
        state.records[outer.id] = { ...structuredClone(outer), children: remaining };
        state.children[outer.id] = remaining;
      } else {
        state.records[outer.id] = null;
        state.removed[outer.id] = null;
        delete state.children[outer.id];
        deletedGroups.add(outer.id);
        if (outer.parent !== state.parent) {
          state.children[outer.parent] = parentChildren(doc, outer.parent)
            .filter((child) => child !== outer.id);
        }
      }
    }
  }

  const currentParent = parentChildren(doc, state.parent);
  const candidates = currentParent.filter((id) =>
    !memberSet.has(id) && id !== root && !deletedGroups.has(id));
  if (ungroup) candidates.push(...members);
  else candidates.push(root);
  state.children[state.parent] = sortedChildren(candidates, state.records, doc);
  if (!ungroup) state.children[root] = sortedChildren(members, state.records, doc);
  state.affected = [...new Set(state.affected)];
  return result;
}

function sourceSpids(snapshot: ElementTreePatch['value'], root: ElementRecord): number[] {
  const part = root.meta.origin?.part;
  const result: number[] = [];
  const visit = (id: string): void => {
    const record = snapshot.records[id];
    if (!record) return;
    const origin = record.meta.origin;
    if (origin && origin.part === part) result.push(origin.spid);
    for (const child of record.children ?? []) visit(child);
  };
  visit(root.id);
  return [...new Set(result)].sort((left, right) => left - right);
}

function deletionTombstone(
  snapshot: ElementTreePatch['value'], record: ElementRecord,
): RemovedElementRecord {
  const spids = sourceSpids(snapshot, record);
  return {
    id: record.id, parent: record.parent, meta: structuredClone(record.meta),
    ...(spids.length ? { sourceSpids: spids } : {}),
  };
}

function slideParent(doc: EditDoc, id: string): string {
  let parent = id;
  const visited = new Set<string>();
  while (!doc.slides[parent]) {
    if (visited.has(parent)) throw new Error(`协同删除父链成环：${id}`);
    visited.add(parent);
    const record = doc.elements[parent];
    if (!record) throw new Error(`协同删除找不到所属页：${id}`);
    parent = record.parent;
  }
  return parent;
}

/** 层级并发已拆散原树时，转换成可删除多个现存分支的自包含层级 patch。 */
export function rebaseElementRemoval(
  doc: EditDoc,
  patch: ElementTreePatch,
): ElementTreePatch | ElementHierarchyPatch | null {
  if (patch.op !== 'remove') return patch;
  const root = doc.elements[patch.path[1]];
  const intact = !!root && root.parent === patch.value.parent
    && Object.entries(patch.value.records).every(([id, record]) =>
      doc.elements[id]?.parent === record.parent);
  if (intact) return patch;
  const deletion = new Set(Object.keys(patch.value.records).filter((id) => !!doc.elements[id]));
  if (root) {
    const visit = (id: string): void => {
      if (deletion.has(id)) {
        for (const child of doc.elements[id]?.children ?? []) visit(child);
        return;
      }
      const record = doc.elements[id];
      if (!record) return;
      deletion.add(id);
      for (const child of record.children ?? []) visit(child);
    };
    visit(root.id);
  }
  const survivors = [...deletion];
  if (!survivors.length) return null;
  const records = Object.fromEntries(survivors.map((id) => [id, null])) as Record<string, null>;
  const removed: Record<string, RemovedElementRecord | null> = Object.create(null);
  const sourceRoot = patch.value.records[patch.value.root];
  if (sourceRoot.meta.created) {
    removed[sourceRoot.id] = null;
    for (const record of Object.values(patch.value.records)) {
      if (!record.meta.created && record.meta.sourceParent !== undefined) {
        removed[record.id] = deletionTombstone(patch.value, record);
      }
    }
  } else removed[sourceRoot.id] = deletionTombstone(patch.value, sourceRoot);
  for (const id of survivors) {
    if (!Object.prototype.hasOwnProperty.call(patch.value.records, id)) removed[id] = null;
  }
  const survivorSet = new Set(survivors);
  const children: Record<string, string[]> = Object.create(null);
  for (const id of survivors) {
    const parent = doc.elements[id]!.parent;
    if (!survivorSet.has(parent) && children[parent] === undefined) {
      children[parent] = parentChildren(doc, parent).filter((child) => !survivorSet.has(child));
    }
  }
  const parent = slideParent(doc, survivors[0]);
  return {
    op: 'set', path: ['elements', patch.path[1], 'hierarchy'], origin: patch.origin,
    value: { parent, affected: survivors, records, children, removed },
  };
}
