import { elementOrder, elementParentChildren, writableLayerSiblingIds } from '../element-order';
import { fractionalIndexBetween } from '../fractional-index';
import type { EditDoc, ElementId, FractionalIndex } from '../types';
import type { CommandPatches, ElementOrderPatch, SetZCommand } from './types';
import { assertElementUnlocked } from './element-interaction';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);
const TARGETS = new Set<SetZCommand['to']>(['front', 'back', 'forward', 'backward']);

export function assertSetZCommand(doc: EditDoc, command: SetZCommand) {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能执行命令');
  if (!TARGETS.has(command.to)) throw new Error(`未知层级目标：${String(command.to)}`);
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if (record.meta.editable === 'none') throw new Error(`元素不可编辑：${command.id}`);
  assertElementUnlocked(doc, command.id);
  if (!record.meta.origin?.part) throw new Error(`元素缺少可写 OOXML 来源 part：${command.id}`);
  return record;
}

interface LayerNode {
  id: ElementId;
  before: LayerNode | null;
  after: LayerNode | null;
}

function planLayerOrder(initial: readonly ElementId[], commands: readonly SetZCommand[]): ElementId[] {
  const nodes = new Map<ElementId, LayerNode>();
  let head: LayerNode | null = null;
  let tail: LayerNode | null = null;
  for (const id of initial) {
    const node: LayerNode = { id, before: tail, after: null };
    if (tail) tail.after = node;
    else head = node;
    tail = node;
    nodes.set(id, node);
  }
  const detach = (node: LayerNode): void => {
    if (node.before) node.before.after = node.after;
    else head = node.after;
    if (node.after) node.after.before = node.before;
    else tail = node.before;
  };
  const after = (anchor: LayerNode, node: LayerNode): void => {
    node.before = anchor;
    node.after = anchor.after;
    if (anchor.after) anchor.after.before = node;
    else tail = node;
    anchor.after = node;
  };
  const before = (anchor: LayerNode, node: LayerNode): void => {
    node.after = anchor;
    node.before = anchor.before;
    if (anchor.before) anchor.before.after = node;
    else head = node;
    anchor.before = node;
  };
  for (const command of commands) {
    const node = nodes.get(command.id);
    if (!node) throw new Error(`元素 ${command.id} 不在可写层级中`);
    if (command.to === 'front') {
      if (node === tail) continue;
      detach(node);
      after(tail!, node);
    } else if (command.to === 'back') {
      if (node === head) continue;
      detach(node);
      before(head!, node);
    } else if (command.to === 'forward') {
      if (!node.after) continue;
      const anchor = node.after;
      detach(node);
      after(anchor, node);
    } else {
      if (!node.before) continue;
      const anchor = node.before;
      detach(node);
      before(anchor, node);
    }
  }
  const result: ElementId[] = [];
  for (let node = head; node; node = node.after) result.push(node.id);
  return result;
}

function sourceAnchors(
  doc: EditDoc,
  ids: readonly ElementId[],
  lower: FractionalIndex | null,
  upper: FractionalIndex | null,
  targets: ReadonlySet<ElementId>,
): Set<ElementId> {
  const candidates = ids.map((id) => doc.elements[id]).filter((record) =>
    !!record && (lower === null || lower < record.z) && (upper === null || record.z < upper));
  interface State { index: number; length: number; score: number }
  const better = (left: State | null, right: State | null): State | null => {
    if (!left) return right;
    if (!right) return left;
    if (left.length !== right.length) return left.length > right.length ? left : right;
    if (left.score !== right.score) return left.score > right.score ? left : right;
    return left.index < right.index ? left : right;
  };
  const ranks = [...candidates].sort((left, right) => left.z < right.z ? -1 : 1);
  const rank = new Map(ranks.map((record, index) => [record.id, index]));
  const tree: Array<State | null> = Array(ranks.length + 1).fill(null);
  const previous = candidates.map(() => -1);
  for (let index = 0; index < candidates.length; index++) {
    let before: State | null = null;
    for (let position = rank.get(candidates[index].id)!; position > 0; position -= position & -position) {
      before = better(before, tree[position]);
    }
    const state = {
      index,
      length: (before?.length ?? 0) + 1,
      score: (before?.score ?? 0)
        + (own(candidates[index], 'order') ? 0 : 2) + (targets.has(candidates[index].id) ? 0 : 1),
    };
    previous[index] = before?.index ?? -1;
    for (let position = rank.get(candidates[index].id)! + 1;
      position < tree.length; position += position & -position) {
      tree[position] = better(tree[position], state);
    }
  }
  let best: State | null = null;
  for (let position = ranks.length; position > 0; position -= position & -position) {
    best = better(best, tree[position]);
  }
  const anchors = new Set<ElementId>();
  for (let index = best?.index ?? -1; index >= 0; index = previous[index]) {
    anchors.add(candidates[index].id);
  }
  return anchors;
}

function plannedOverrides(
  doc: EditDoc,
  desired: readonly ElementId[],
  layer: ReadonlySet<ElementId>,
  targets: ReadonlySet<ElementId>,
): Map<ElementId, FractionalIndex | null> {
  const result = new Map<ElementId, FractionalIndex | null>();
  let start = 0;
  while (start < desired.length) {
    if (!layer.has(desired[start])) {
      start++;
      continue;
    }
    let end = start;
    while (end < desired.length && layer.has(desired[end])) end++;
    const lower = start > 0 ? elementOrder(doc.elements[desired[start - 1]]) : null;
    const upper = end < desired.length ? elementOrder(doc.elements[desired[end]]) : null;
    const ids = desired.slice(start, end);
    const anchors = sourceAnchors(doc, ids, lower, upper, targets);
    const nextAnchor = ids.map(() => upper);
    let next = upper;
    for (let index = ids.length - 1; index >= 0; index--) {
      nextAnchor[index] = next;
      if (anchors.has(ids[index])) next = doc.elements[ids[index]].z;
    }
    let previous = lower;
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      if (anchors.has(id)) {
        result.set(id, null);
        previous = doc.elements[id].z;
      } else {
        const value = fractionalIndexBetween(previous, nextAnchor[index], id);
        result.set(id, value);
        previous = value;
      }
    }
    start = end;
  }
  return result;
}

function orderPatches(
  doc: EditDoc,
  desired: readonly ElementId[],
  layer: ReadonlySet<ElementId>,
  targets: ReadonlySet<ElementId>,
  origin: string,
): CommandPatches {
  const overrides = plannedOverrides(doc, desired, layer, targets);
  const forward: ElementOrderPatch[] = [];
  const inverse: ElementOrderPatch[] = [];
  for (const id of desired) {
    if (!layer.has(id)) continue;
    const record = doc.elements[id];
    const value = overrides.get(id) ?? null;
    const hadOrder = own(record, 'order');
    if (value === null ? !hadOrder : hadOrder && record.order === value) continue;
    const path = ['elements', id, 'order'] as const;
    forward.push(value === null
      ? { op: 'del', path, origin }
      : { op: 'set', path, value, origin });
    inverse.push(hadOrder
      ? { op: 'set', path, value: record.order!, origin }
      : { op: 'del', path, origin });
  }
  return { forward, inverse };
}

export function setZBatchPatches(
  doc: EditDoc,
  commands: readonly SetZCommand[],
  origin: string,
): CommandPatches {
  if (!commands.length) return { forward: [], inverse: [] };
  const records = commands.map((command) => assertSetZCommand(doc, command));
  const parent = records[0].parent;
  const part = records[0].meta.origin?.part ?? null;
  if (records.some((record) => record.parent !== parent || (record.meta.origin?.part ?? null) !== part)) {
    throw new Error('同一层级事务只能调整同一父级、同一来源 part 的元素');
  }
  const source = elementParentChildren(doc, parent);
  const layerOrder = writableLayerSiblingIds(doc, records[0]);
  const planned = planLayerOrder(layerOrder, commands);
  const layer = new Set(layerOrder);
  let plannedIndex = 0;
  const desired = source.map((id) => layer.has(id) ? planned[plannedIndex++] : id);
  if (desired.every((id, index) => id === source[index])) return { forward: [], inverse: [] };
  return orderPatches(doc, desired, layer, new Set(commands.map((command) => command.id)), origin);
}

export function setZPatches(doc: EditDoc, command: SetZCommand, origin: string): CommandPatches {
  return setZBatchPatches(doc, [command], origin);
}
