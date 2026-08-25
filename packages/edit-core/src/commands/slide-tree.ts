import type { EditDoc, ElementId, ElementRecord, SlideId } from '../types';
import type { Patch, SlideChangeSets, SlideTreePatch, SlideTreeSnapshot } from './types';
import { isSlideOrderPatch } from './slide-order';

export function isSlideTreePatch(patch: Patch): patch is SlideTreePatch {
  return patch.path.length === 2 && patch.path[0] === 'slides';
}

function assertSnapshot(snapshot: SlideTreeSnapshot, id: SlideId, label: string): void {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.slide || snapshot.slide.id !== id
    || (snapshot.after !== null && (typeof snapshot.after !== 'string' || !snapshot.after))
    || (snapshot.before !== null && (typeof snapshot.before !== 'string' || !snapshot.before))
    || !snapshot.records || typeof snapshot.records !== 'object') {
    throw new Error(`${label} 的页面树快照无效`);
  }
  if (snapshot.slide.children.some((child) => !snapshot.records[child])) {
    throw new Error(`${label} 的页面树缺少直属元素记录`);
  }
  const reached = new Set<ElementId>();
  const visit = (elementId: ElementId, parent: SlideId | ElementId): void => {
    if (reached.has(elementId)) throw new Error(`${label} 的页面树成环或重复引用：${elementId}`);
    const record = snapshot.records[elementId];
    if (!record || record.id !== elementId || record.parent !== parent) {
      throw new Error(`${label} 的页面树父链无效：${elementId}`);
    }
    reached.add(elementId);
    for (const child of record.children ?? []) visit(child, elementId);
  };
  for (const child of snapshot.slide.children) visit(child, id);
  if (reached.size !== Object.keys(snapshot.records).length) throw new Error(`${label} 的页面树包含孤儿元素`);
}

export function validateSlideTreePatch(doc: EditDoc, patch: SlideTreePatch, index: number): void {
  const id = patch.path[1];
  assertSnapshot(patch.value, id, `Patch ${index}`);
  if (patch.op === 'remove') {
    if (!doc.slides[id] || !doc.slideOrder.includes(id)) throw new Error(`Patch ${index} 删除的页面不存在`);
    for (const elementId of Object.keys(patch.value.records)) {
      if (!doc.elements[elementId]) throw new Error(`Patch ${index} 删除的页面元素不存在：${elementId}`);
    }
    return;
  }
  if (doc.slides[id] || doc.slideOrder.includes(id)) throw new Error(`Patch ${index} 插入的页面已存在`);
  if (patch.value.after !== null && !doc.slides[patch.value.after]) {
    throw new Error(`Patch ${index} 插入页面的锚点不存在：${patch.value.after}`);
  }
  for (const elementId of Object.keys(patch.value.records)) {
    if (doc.elements[elementId] || doc.slides[elementId]) {
      throw new Error(`Patch ${index} 插入的页面元素已存在：${elementId}`);
    }
  }
}

const cloneRecord = (record: ElementRecord): ElementRecord => structuredClone(record);

export function applySlideTreePatch(doc: EditDoc, patch: SlideTreePatch): void {
  const { slide, after, records } = patch.value;
  if (patch.op === 'remove') {
    const index = doc.slideOrder.indexOf(slide.id);
    if (index < 0) throw new Error(`删除页面不在 slideOrder 中：${slide.id}`);
    doc.slideOrder.splice(index, 1);
    for (const id of Object.keys(records)) delete doc.elements[id];
    delete doc.slides[slide.id];
    return;
  }
  doc.slides[slide.id] = structuredClone(slide);
  for (const [id, record] of Object.entries(records)) doc.elements[id] = cloneRecord(record);
  const index = after === null ? 0 : doc.slideOrder.indexOf(after) + 1;
  if (index < 0) throw new Error(`插入页面的锚点不在 slideOrder 中：${String(after)}`);
  doc.slideOrder.splice(index, 0, slide.id);
}

export function slidePatchSets(doc: EditDoc, patches: readonly Patch[]): SlideChangeSets {
  const createdSlides = new Set<SlideId>();
  const removedSlides = new Set<SlideId>();
  const movedSlides = new Set<SlideId>();
  const notesSlides = new Set<SlideId>();
  const removals = new Map<SlideId, SlideTreeSnapshot>();
  for (const patch of patches) {
    if (patch.path[0] === 'slides' && (patch.path.length === 3 && patch.path[2] === 'notes'
      || patch.path.length === 4 && patch.path[2] === 'ovr' && patch.path[3] === 'notes')) {
      notesSlides.add(patch.path[1]);
    }
    if (isSlideOrderPatch(patch)) {
      if (!createdSlides.has(patch.path[1]) && !removedSlides.has(patch.path[1])) {
        movedSlides.add(patch.path[1]);
      }
      continue;
    }
    if (!isSlideTreePatch(patch)) continue;
    const id = patch.path[1];
    if (patch.op === 'insert') {
      if (!removedSlides.delete(id)) createdSlides.add(id);
      removals.delete(id);
      movedSlides.delete(id);
    } else {
      if (!createdSlides.delete(id)) {
        removedSlides.add(id);
        removals.set(id, patch.value);
      }
      movedSlides.delete(id);
    }
  }
  const removedSlideFallbacks = new Map<SlideId, SlideId>();
  for (const [id, snapshot] of removals) {
    const seen = new Set<SlideId>([id]);
    let candidate = snapshot.before;
    while (candidate && removals.has(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      candidate = removals.get(candidate)!.before;
    }
    if (!candidate || !doc.slides[candidate]) {
      candidate = snapshot.after;
      while (candidate && removals.has(candidate) && !seen.has(candidate)) {
        seen.add(candidate);
        candidate = removals.get(candidate)!.after;
      }
    }
    const fallback = candidate && doc.slides[candidate] ? candidate : doc.slideOrder[0];
    if (fallback) removedSlideFallbacks.set(id, fallback);
  }
  return { createdSlides, removedSlides, movedSlides, notesSlides, removedSlideFallbacks };
}
