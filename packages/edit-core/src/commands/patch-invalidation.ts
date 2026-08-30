import {
  invalidateElement, invalidateElementStructure, invalidateSlide, invalidateSlideData,
  invalidateSlideSequence, invalidateSlideStructure,
} from '../projection';
import type { EditDoc, ElementId, SlideId } from '../types';
import { isElementHierarchyPatch } from './element-hierarchy';
import { isElementInteractionPatch } from './element-interaction';
import { isImageResourcePatch } from './element-image-content';
import { isElementTreePatch } from './element-tree';
import { isSlideLayoutPatch } from './slide-layout';
import { isSlideNotesPatch } from './slide-notes';
import { isSlideOrderPatch, slideOrderPatchStart } from './slide-order';
import { isSlidePropertyPatch } from './slide-property';
import { isSlideTreePatch } from './slide-tree';
import type { Patch } from './types';

function slideElementIds(doc: EditDoc, slideId: SlideId): ElementId[] {
  const ids: ElementId[] = [];
  const visit = (id: ElementId): void => {
    ids.push(id);
    for (const child of doc.elements[id]?.children ?? []) visit(child);
  };
  for (const id of doc.slides[slideId].children) visit(id);
  return ids;
}

export function collectPatchInvalidation(
  doc: EditDoc,
  patch: Patch,
  dirtyElements: Set<string>,
  dirtySlides: Set<string>,
): void {
  if (isImageResourcePatch(patch) || isElementInteractionPatch(patch)) return;
  if (isSlideOrderPatch(patch)) {
    const sequence = invalidateSlideSequence(doc, slideOrderPatchStart(doc, patch));
    for (const elementId of sequence.dirtyElements) dirtyElements.add(elementId);
    for (const slideId of sequence.dirtySlides) dirtySlides.add(slideId);
    return;
  }
  if (isSlideTreePatch(patch)) {
    const start = patch.op === 'insert'
      ? (patch.value.after === null ? 0 : doc.slideOrder.indexOf(patch.value.after) + 1)
      : doc.slideOrder.indexOf(patch.path[1]) + 1;
    const sequence = invalidateSlideSequence(doc, start);
    for (const elementId of sequence.dirtyElements) dirtyElements.add(elementId);
    for (const slideId of sequence.dirtySlides) dirtySlides.add(slideId);
  }
  const dirty = isSlideNotesPatch(patch)
    ? invalidateSlideData(doc, patch.path[1])
    : isSlideLayoutPatch(patch)
    ? invalidateSlideStructure(doc, patch.path[1], slideElementIds(doc, patch.path[1]))
    : isSlidePropertyPatch(patch)
    ? invalidateSlide(doc, patch.path[1])
    : isSlideTreePatch(patch)
    ? invalidateSlideStructure(doc, patch.path[1], Object.keys(patch.value.records))
    : isElementTreePatch(patch)
    ? invalidateElementStructure(doc, Object.keys(patch.value.records), patch.value.parent)
    : isElementHierarchyPatch(patch)
    ? invalidateElementStructure(doc, patch.value.affected, patch.value.parent)
    : invalidateElement(doc, patch.path[1]);
  for (const elementId of dirty.dirtyElements) dirtyElements.add(elementId);
  for (const slideId of dirty.dirtySlides) dirtySlides.add(slideId);
}

export function canInvalidateAgainst(doc: EditDoc, patch: Patch): boolean {
  if (isImageResourcePatch(patch) || isElementInteractionPatch(patch) || isSlideTreePatch(patch)) return true;
  if (isSlideOrderPatch(patch)) {
    return !!doc.slides[patch.path[1]]
      && (patch.value.after === null || !!doc.slides[patch.value.after]);
  }
  if (isSlideNotesPatch(patch) || isSlideLayoutPatch(patch) || isSlidePropertyPatch(patch)) {
    return !!doc.slides[patch.path[1]];
  }
  if (isElementTreePatch(patch)) {
    return !!doc.slides[patch.value.parent] || !!doc.elements[patch.value.parent];
  }
  if (isElementHierarchyPatch(patch)) {
    return !!doc.slides[patch.value.parent] || !!doc.elements[patch.value.parent];
  }
  return !!doc.elements[patch.path[1]];
}
