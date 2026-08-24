import { effectiveElement, slideOfElement } from '@web-ppt/edit-core';
import type { EditDoc, ElementId, Selection, SlideId } from '@web-ppt/edit-core';
import { RESIZE_HANDLES, resizeHandleAfterFlip } from './resize-geometry';
import { elementFrameToSlidePoint } from './space';
import type { SpacePoint } from './space';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

function resizeCursor(point: SpacePoint, center: SpacePoint): string {
  const degrees = Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI;
  const direction = Math.round(((degrees % 180) + 180) % 180 / 45) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][direction];
}

function svgElement<K extends keyof SVGElementTagNameMap>(document: Document, name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function positionRect(rect: SVGRectElement, point: SpacePoint, size: number): void {
  rect.setAttribute('x', String(point.x - size / 2));
  rect.setAttribute('y', String(point.y - size / 2));
  rect.setAttribute('width', String(size));
  rect.setAttribute('height', String(size));
}

/** 手势帧只改已有属性，避免每次缩放都重建交互 DOM。 */
export function updateSelectionOverlayFrame(
  layer: SVGSVGElement,
  corners: SelectionFrame['corners'],
  zoom: number,
  handleFlip: { horizontal: boolean; vertical: boolean } = { horizontal: false, vertical: false },
): void {
  const group = layer.querySelector<SVGGElement>('[data-edit-selection-ids]');
  const outline = group?.querySelector<SVGPolygonElement>('[data-edit-selection-frame]');
  if (!group || !outline) return;
  const strokeWidth = 1.5 / zoom;
  const handleSize = 8 / zoom;
  const handleHitSize = 16 / zoom;
  outline.setAttribute('points', corners.map((point) => `${point.x},${point.y}`).join(' '));
  outline.setAttribute('stroke-width', String(strokeWidth));

  const points = scaleHandlePoints(corners);
  const center = midpoint(corners[0], corners[2]);
  RESIZE_HANDLES.forEach((name) => {
    const pointName = resizeHandleAfterFlip(name, handleFlip.horizontal, handleFlip.vertical);
    const point = points[RESIZE_HANDLES.indexOf(pointName)];
    const visual = group.querySelector<SVGRectElement>(`[data-edit-handle="${name}"]`);
    const hit = group.querySelector<SVGRectElement>(`[data-edit-resize-handle="${name}"]`);
    if (visual) {
      positionRect(visual, point, handleSize);
      visual.setAttribute('rx', String(1 / zoom));
      visual.setAttribute('stroke-width', String(strokeWidth));
    }
    if (hit) {
      positionRect(hit, point, handleHitSize);
      hit.style.cursor = resizeCursor(point, center);
    }
  });

  const top = midpoint(corners[0], corners[1]);
  const rotation = rotationHandlePoint(corners, 24 / zoom);
  const stem = group.querySelector<SVGLineElement>('[data-edit-rotation-stem]');
  if (stem) {
    stem.setAttribute('x1', String(top.x));
    stem.setAttribute('y1', String(top.y));
    stem.setAttribute('x2', String(rotation.x));
    stem.setAttribute('y2', String(rotation.y));
    stem.setAttribute('stroke-width', String(strokeWidth));
  }
  const rotate = group.querySelector<SVGCircleElement>('[data-edit-handle="rotate"]');
  if (rotate) {
    rotate.setAttribute('cx', String(rotation.x));
    rotate.setAttribute('cy', String(rotation.y));
    rotate.setAttribute('r', String(handleSize / 2));
    rotate.setAttribute('stroke-width', String(strokeWidth));
  }
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

  const outline = svgElement(document, 'polygon');
  outline.dataset.editSelectionFrame = '';
  outline.setAttribute('fill', 'none');
  outline.setAttribute('stroke', '#2563eb');
  group.append(outline);

  RESIZE_HANDLES.forEach((name) => {
    const hit = svgElement(document, 'rect');
    hit.dataset.editResizeHandle = name;
    hit.setAttribute('fill', 'transparent');
    // 根 SVG 不参与命中；只有显式放大的手柄区域接管编辑指针。
    hit.style.pointerEvents = 'all';
    group.append(hit);

    const handle = svgElement(document, 'rect');
    handle.dataset.editHandle = name;
    handle.setAttribute('fill', '#fff');
    handle.setAttribute('stroke', '#2563eb');
    group.append(handle);
  });

  const stem = svgElement(document, 'line');
  stem.dataset.editRotationStem = '';
  stem.setAttribute('stroke', '#2563eb');
  group.append(stem);

  const rotateHandle = svgElement(document, 'circle');
  rotateHandle.dataset.editHandle = 'rotate';
  rotateHandle.setAttribute('fill', '#fff');
  rotateHandle.setAttribute('stroke', '#2563eb');
  group.append(rotateHandle);
  layer.append(group);
  updateSelectionOverlayFrame(layer, frame.corners, zoom);
}
