import { isElementDescendantOf } from '@web-ppt/edit-core';
import type { EditDoc, ElementId, Selection, SlideId, TableCellAddress } from '@web-ppt/edit-core';

const TOUCH_HIT_RADIUS = 12;

function elementsFromPath(path: EventTarget[], root: Element): Element[] {
  return path.filter((target): target is Element =>
    !!target && typeof target === 'object'
      && (target as Node).nodeType === 1 && root.contains(target as Node));
}

export function tableCellAddressFromPath(path: EventTarget[], root: Element): TableCellAddress | null {
  const value = elementsFromPath(path, root)
    .map((element) => (element as SVGElement).dataset.tableCell)
    .find((candidate) => candidate !== undefined);
  const match = value && /^(\d+):(\d+)$/.exec(value);
  return match ? { r: Number(match[1]), c: Number(match[2]) } : null;
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

function hitFromElement(doc: EditDoc, element: Element, root: Element, group: ElementId | null) {
  return outermostHitCandidate(doc, selectableElementIdsFromPath(doc, pathWithinRoot(element, root), root), group);
}

/** 触摸才按离落点由近到远采样；鼠标/笔仍完全服从浏览器的原生 SVG 命中。 */
export function touchHitCandidate(
  doc: EditDoc,
  document: Document,
  screen: { x: number; y: number },
  root: Element,
  enteredGroup: ElementId | null,
): ElementId | undefined {
  if (document.elementsFromPoint) {
    for (const element of document.elementsFromPoint(screen.x, screen.y)) {
      const id = hitFromElement(doc, element, root, enteredGroup);
      if (id) return id;
    }
  }
  let nearestId: ElementId | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestOrder = -1;
  const geometries = root.querySelectorAll<SVGGeometryElement>(
    'path, rect, circle, ellipse, line, polyline, polygon',
  );
  geometries.forEach((geometry, order) => {
    const rect = geometry.getBoundingClientRect();
    if (screen.x < rect.left - TOUCH_HIT_RADIUS || screen.x > rect.right + TOUCH_HIT_RADIUS
      || screen.y < rect.top - TOUCH_HIT_RADIUS || screen.y > rect.bottom + TOUCH_HIT_RADIUS) return;
    const id = hitFromElement(doc, geometry, root, enteredGroup);
    if (!id) return;
    const distance = geometryScreenDistance(geometry, screen, rect);
    if (distance > TOUCH_HIT_RADIUS) return;
    if (distance < nearestDistance - 1e-6
      || Math.abs(distance - nearestDistance) <= 1e-6 && order > nearestOrder) {
      nearestId = id;
      nearestDistance = distance;
      nearestOrder = order;
    }
  });
  return nearestId;
}

export function pathWithinRoot(element: Element | null | undefined, root: Element): EventTarget[] {
  const path: EventTarget[] = [];
  if (!element || !root.contains(element)) return path;
  for (let current: Element | null = element; current && current !== root; current = current.parentElement) {
    path.push(current);
  }
  return path;
}

function pointSegmentDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

function geometryScreenDistance(
  geometry: SVGGeometryElement,
  screen: { x: number; y: number },
  rect: DOMRect,
): number {
  try {
    const matrix = geometry.getScreenCTM();
    const length = geometry.getTotalLength();
    if (!matrix || !Number.isFinite(length) || length <= 0) return Number.POSITIVE_INFINITY;
    const sampleCount = Math.max(8, Math.min(256, Math.ceil((rect.width + rect.height) * 2 / 4)));
    const project = (offset: number) => {
      const local = geometry.getPointAtLength(offset);
      return {
        x: matrix.a * local.x + matrix.c * local.y + matrix.e,
        y: matrix.b * local.x + matrix.d * local.y + matrix.f,
      };
    };
    let previous = project(0);
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 1; index <= sampleCount; index++) {
      const next = project(length * index / sampleCount);
      nearest = Math.min(nearest, pointSegmentDistance(screen, previous, next));
      previous = next;
    }
    return nearest;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
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
    const id = hitFromElement(doc, element, root, enteredGroup);
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
