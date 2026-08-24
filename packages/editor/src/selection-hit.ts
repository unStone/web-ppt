import { isElementDescendantOf } from '@web-ppt/edit-core';
import type { EditDoc, ElementId, SlideId } from '@web-ppt/edit-core';

function elementsFromPath(path: EventTarget[], root: Element): Element[] {
  return path.filter((target): target is Element =>
    !!target && typeof target === 'object'
      && (target as Node).nodeType === 1 && root.contains(target as Node));
}

export function isSelectable(doc: EditDoc, id: ElementId): boolean {
  let record = doc.elements[id];
  if (!record) return false;
  while (record) {
    if (record.meta.locked || record.meta.hiddenByUser || record.meta.editable === 'none') return false;
    record = doc.elements[record.parent];
  }
  return true;
}

export function selectableElementIdsFromPath(
  doc: EditDoc,
  path: EventTarget[],
  root: Element,
): ElementId[] {
  return elementsFromPath(path, root)
    .map((element) => (element as SVGElement).dataset.editId)
    .filter((id): id is ElementId => !!id && isSelectable(doc, id));
}

export function directSelectableChildIds(
  doc: EditDoc,
  slideId: SlideId,
  enteredGroup: ElementId | null,
): ElementId[] {
  const children = enteredGroup ? doc.elements[enteredGroup]?.children ?? [] : doc.slides[slideId].children;
  return children.filter((id) => isSelectable(doc, id));
}

export function enteredGroupOnSlide(
  doc: EditDoc,
  enteredGroup: ElementId | null,
  slideId: SlideId,
): ElementId | null {
  if (!enteredGroup) return null;
  let ancestor: ElementId | SlideId = enteredGroup;
  while (doc.elements[ancestor]) ancestor = doc.elements[ancestor].parent;
  return ancestor === slideId ? enteredGroup : null;
}

export function outermostHitCandidate(
  doc: EditDoc,
  candidates: ElementId[],
  enteredGroup: ElementId | null,
): ElementId | undefined {
  if (!enteredGroup) return candidates[candidates.length - 1];
  const descendants = candidates.filter((id) => id !== enteredGroup
    && isElementDescendantOf(doc, id, enteredGroup));
  return descendants[descendants.length - 1];
}
