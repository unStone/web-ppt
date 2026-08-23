import { effectiveElement, slideOfElement } from '@web-ppt/edit-core';
import type { EditDoc, ElementId, Selection, SlideId } from '@web-ppt/edit-core';
import { elementFrameToSlidePoint } from './space';
import type { SpacePoint } from './space';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SCALE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

interface SelectionFrame {
  ids: ElementId[];
  corners: [SpacePoint, SpacePoint, SpacePoint, SpacePoint];
}

const midpoint = (left: SpacePoint, right: SpacePoint): SpacePoint => ({
  x: (left.x + right.x) / 2,
  y: (left.y + right.y) / 2,
});

function elementCorners(doc: EditDoc, id: ElementId): SelectionFrame['corners'] {
  const element = effectiveElement(doc, id);
  return [
    elementFrameToSlidePoint(doc, id, { x: 0, y: 0 }),
    elementFrameToSlidePoint(doc, id, { x: element.w, y: 0 }),
    elementFrameToSlidePoint(doc, id, { x: element.w, y: element.h }),
    elementFrameToSlidePoint(doc, id, { x: 0, y: element.h }),
  ];
}

function selectionFrame(doc: EditDoc, selection: Selection, slideId: SlideId): SelectionFrame | null {
  if (selection.kind !== 'elements' || !selection.ids.length) return null;
  const ids = selection.ids.filter((id) => doc.elements[id] && slideOfElement(doc, id) === slideId);
  if (!ids.length) return null;
  if (ids.length === 1) return { ids, corners: elementCorners(doc, ids[0]) };

  const points = ids.flatMap((id) => elementCorners(doc, id));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { ids, corners: [
    { x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom },
  ] };
}

function scaleHandlePoints(corners: SelectionFrame['corners']): SpacePoint[] {
  const [nw, ne, se, sw] = corners;
  return [nw, midpoint(nw, ne), ne, midpoint(ne, se), se, midpoint(se, sw), sw, midpoint(sw, nw)];
}

function rotationHandlePoint(corners: SelectionFrame['corners'], distance: number): SpacePoint {
  const top = midpoint(corners[0], corners[1]);
  const center = midpoint(corners[0], corners[2]);
  const dx = top.x - center.x;
  const dy = top.y - center.y;
  const length = Math.hypot(dx, dy);
  const ux = length > 1e-9 ? dx / length : 0;
  const uy = length > 1e-9 ? dy / length : -1;
  return { x: top.x + ux * distance, y: top.y + uy * distance };
}

function svgElement<K extends keyof SVGElementTagNameMap>(document: Document, name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

export function renderSelectionOverlay(
  layer: SVGSVGElement,
  doc: EditDoc,
  selection: Selection,
  slideId: SlideId,
  zoom: number,
): void {
  layer.replaceChildren();
  const frame = selectionFrame(doc, selection, slideId);
  if (!frame) return;

  const document = layer.ownerDocument;
  const group = svgElement(document, 'g');
  group.dataset.editSelectionIds = frame.ids.join(' ');
  if (frame.ids.length === 1) group.dataset.editSelectionId = frame.ids[0];
  group.setAttribute('aria-hidden', 'true');
  group.style.pointerEvents = 'none';

  const strokeWidth = 1.5 / zoom;
  const handleSize = 8 / zoom;
  const outline = svgElement(document, 'polygon');
  outline.dataset.editSelectionFrame = '';
  outline.setAttribute('points', frame.corners.map((point) => `${point.x},${point.y}`).join(' '));
  outline.setAttribute('fill', 'none');
  outline.setAttribute('stroke', '#2563eb');
  outline.setAttribute('stroke-width', String(strokeWidth));
  group.append(outline);

  const handlePoints = scaleHandlePoints(frame.corners);
  handlePoints.forEach((point, index) => {
    const handle = svgElement(document, 'rect');
    handle.dataset.editHandle = SCALE_HANDLES[index];
    handle.setAttribute('x', String(point.x - handleSize / 2));
    handle.setAttribute('y', String(point.y - handleSize / 2));
    handle.setAttribute('width', String(handleSize));
    handle.setAttribute('height', String(handleSize));
    handle.setAttribute('rx', String(1 / zoom));
    handle.setAttribute('fill', '#fff');
    handle.setAttribute('stroke', '#2563eb');
    handle.setAttribute('stroke-width', String(strokeWidth));
    group.append(handle);
  });

  const top = midpoint(frame.corners[0], frame.corners[1]);
  const rotation = rotationHandlePoint(frame.corners, 24 / zoom);
  const stem = svgElement(document, 'line');
  stem.dataset.editRotationStem = '';
  stem.setAttribute('x1', String(top.x));
  stem.setAttribute('y1', String(top.y));
  stem.setAttribute('x2', String(rotation.x));
  stem.setAttribute('y2', String(rotation.y));
  stem.setAttribute('stroke', '#2563eb');
  stem.setAttribute('stroke-width', String(strokeWidth));
  group.append(stem);

  const rotateHandle = svgElement(document, 'circle');
  rotateHandle.dataset.editHandle = 'rotate';
  rotateHandle.setAttribute('cx', String(rotation.x));
  rotateHandle.setAttribute('cy', String(rotation.y));
  rotateHandle.setAttribute('r', String(handleSize / 2));
  rotateHandle.setAttribute('fill', '#fff');
  rotateHandle.setAttribute('stroke', '#2563eb');
  rotateHandle.setAttribute('stroke-width', String(strokeWidth));
  group.append(rotateHandle);
  layer.append(group);
}
