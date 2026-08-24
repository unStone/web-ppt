import { effectiveElement } from '@web-ppt/edit-core';
import type { EditDoc, ElementId } from '@web-ppt/edit-core';
import type { ElementBase, GroupElement } from '@web-ppt/core';

export interface SpacePoint {
  x: number;
  y: number;
}

/** SVG 同口径仿射矩阵：x' = ax + cy + e，y' = bx + dy + f。 */
export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface SlideViewport {
  left: number;
  top: number;
  zoom: number;
}

export interface ElementFrameTransform {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
}

const IDENTITY: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function composeSpaceMatrices(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

const translation = (x: number, y: number): AffineMatrix => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
const scaling = (x: number, y: number): AffineMatrix => ({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 });

function rotationAround(degrees: number, cx: number, cy: number): AffineMatrix {
  if (!degrees) return IDENTITY;
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotation = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  return composeSpaceMatrices(translation(cx, cy), composeSpaceMatrices(rotation, translation(-cx, -cy)));
}

export function elementFrameToParentMatrix(element: ElementFrameTransform): AffineMatrix {
  const position = translation(element.x, element.y);
  return composeSpaceMatrices(
    rotationAround(element.rot, element.x + element.w / 2, element.y + element.h / 2),
    position,
  );
}

function flipInFrame(element: ElementBase): AffineMatrix {
  if (!element.flipH && !element.flipV) return IDENTITY;
  const cx = element.w / 2;
  const cy = element.h / 2;
  return composeSpaceMatrices(translation(cx, cy), composeSpaceMatrices(
    scaling(element.flipH ? -1 : 1, element.flipV ? -1 : 1),
    translation(-cx, -cy),
  ));
}

function childrenToGroupFrame(group: GroupElement): AffineMatrix {
  return composeSpaceMatrices(
    scaling(group.scaleX || 1, group.scaleY || 1),
    translation(-group.childX, -group.childY),
  );
}

function elementChain(doc: EditDoc, id: ElementId): ElementId[] {
  const chain: ElementId[] = [];
  const seen = new Set<ElementId>();
  let record = doc.elements[id];
  if (!record) throw new Error(`找不到元素：${id}`);
  while (record) {
    if (seen.has(record.id)) throw new Error(`元素父链成环：${record.id}`);
    seen.add(record.id);
    chain.unshift(record.id);
    record = doc.elements[record.parent];
  }
  return chain;
}

export function transformSpacePoint(matrix: AffineMatrix, point: SpacePoint): SpacePoint {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function invertSpaceMatrix(matrix: AffineMatrix): AffineMatrix {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new Error('元素坐标变换不可逆');
  }
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

function parentToSlideMatrix(doc: EditDoc, chain: ElementId[]): AffineMatrix {
  let matrix = IDENTITY;
  for (let index = 0; index < chain.length - 1; index++) {
    const element = effectiveElement(doc, chain[index]);
    matrix = composeSpaceMatrices(matrix, elementFrameToParentMatrix(element));
    if (element.kind !== 'group') throw new Error(`非组元素不能拥有子元素：${chain[index]}`);
    matrix = composeSpaceMatrices(
      matrix,
      composeSpaceMatrices(flipInFrame(element), childrenToGroupFrame(element)),
    );
  }
  return matrix;
}

export function elementFrameToSlideMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  const chain = elementChain(doc, id);
  return composeSpaceMatrices(
    parentToSlideMatrix(doc, chain),
    elementFrameToParentMatrix(effectiveElement(doc, chain[chain.length - 1])),
  );
}

export function elementParentToSlideMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  return parentToSlideMatrix(doc, elementChain(doc, id));
}

export function elementFrameToSlidePoint(doc: EditDoc, id: ElementId, point: SpacePoint): SpacePoint {
  return transformSpacePoint(elementFrameToSlideMatrix(doc, id), point);
}

export function slideToElementFramePoint(doc: EditDoc, id: ElementId, point: SpacePoint): SpacePoint {
  return transformSpacePoint(invertSpaceMatrix(elementFrameToSlideMatrix(doc, id)), point);
}

export function elementParentToSlidePoint(doc: EditDoc, id: ElementId, point: SpacePoint): SpacePoint {
  return transformSpacePoint(elementParentToSlideMatrix(doc, id), point);
}

export function slideToElementParentPoint(doc: EditDoc, id: ElementId, point: SpacePoint): SpacePoint {
  return transformSpacePoint(invertSpaceMatrix(elementParentToSlideMatrix(doc, id)), point);
}

function assertViewport(viewport: SlideViewport): void {
  if (![viewport.left, viewport.top, viewport.zoom].every(Number.isFinite) || viewport.zoom <= 0) {
    throw new Error('画布视口必须是有限坐标与正缩放');
  }
}

export function slideToScreenPoint(point: SpacePoint, viewport: SlideViewport): SpacePoint {
  assertViewport(viewport);
  return { x: viewport.left + point.x * viewport.zoom, y: viewport.top + point.y * viewport.zoom };
}

export function screenToSlidePoint(point: SpacePoint, viewport: SlideViewport): SpacePoint {
  assertViewport(viewport);
  return { x: (point.x - viewport.left) / viewport.zoom, y: (point.y - viewport.top) / viewport.zoom };
}
