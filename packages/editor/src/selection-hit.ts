import { isElementDescendantOf } from '@web-ppt/edit-core';
import type { EditDoc, ElementId, Selection, SlideId } from '@web-ppt/edit-core';

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

export function alternateSelectableElementId(
  doc: EditDoc,
  elements: readonly Element[],
  root: Element,
  enteredGroup: ElementId | null,
  selection: Selection,
  preferUnselected: boolean,
): ElementId | undefined {
  const candidates: ElementId[] = [];
  for (const element of elements) {
    if (!root.contains(element)) continue;
    const path: EventTarget[] = [];
    for (let current: Element | null = element; current && current !== root; current = current.parentElement) {
      path.push(current);
    }
    const id = outermostHitCandidate(
      doc, selectableElementIdsFromPath(doc, path, root), enteredGroup,
    );
    if (id && !candidates.includes(id)) candidates.push(id);
  }
  const currentId = selection.kind === 'elements' && selection.ids.length === 1 ? selection.ids[0] : null;
  const currentIndex = currentId ? candidates.indexOf(currentId) : -1;
  if (currentIndex >= 0) return candidates[(currentIndex + 1) % candidates.length];
  if (preferUnselected && selection.kind === 'elements') {
    const selected = new Set(selection.ids);
    const unselected = candidates.find((id) => !selected.has(id));
    if (unselected) return unselected;
  }
  return candidates[0];
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
