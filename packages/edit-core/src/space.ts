import { placeGroupChild } from '@web-ppt/core';
import type { ElementBase, GroupElement, SlideElement } from '@web-ppt/core';
import { effectiveElement } from './projection';
import type { EditDoc, ElementId } from './types';

export interface SpacePoint { x: number; y: number }

/** SVG 同口径仿射矩阵：x' = ax + cy + e，y' = bx + dy + f。 */
export interface AffineMatrix { a: number; b: number; c: number; d: number; e: number; f: number }
export interface SlideViewport { left: number; top: number; zoom: number }
export interface ElementFrameTransform { x: number; y: number; w: number; h: number; rot: number }

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
  return composeSpaceMatrices(
    rotationAround(element.rot, element.x + element.w / 2, element.y + element.h / 2),
    translation(element.x, element.y),
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

export function transformSpaceVector(matrix: AffineMatrix, vector: SpacePoint): SpacePoint {
  return {
    x: matrix.a * vector.x + matrix.c * vector.y,
    y: matrix.b * vector.x + matrix.d * vector.y,
  };
}

/** 方向没有平移分量，单独求逆可避免误把父空间原点带进角度计算。 */
export function inverseTransformSpaceVector(matrix: AffineMatrix, vector: SpacePoint): SpacePoint {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new Error('元素方向变换不可逆');
  }
  return {
    x: (matrix.d * vector.x - matrix.c * vector.y) / determinant,
    y: (-matrix.b * vector.x + matrix.a * vector.y) / determinant,
  };
}

/** 反射会让父空间里的正角方向与幻灯片空间相反；旋转连续性必须沿同一手性展开。 */
export function spaceOrientationParity(matrix: AffineMatrix): 1 | -1 {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new Error('元素方向变换不可逆');
  }
  return determinant > 0 ? 1 : -1;
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

/** 元素内容坐标还要经过自身翻转；frame 几何本身不含这一步。 */
export function elementContentToSlideMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  const element = effectiveElement(doc, id);
  return composeSpaceMatrices(elementFrameToSlideMatrix(doc, id), flipInFrame(element));
}

export function elementParentToSlideMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  return parentToSlideMatrix(doc, elementChain(doc, id));
}

/** 组的子坐标系包含自身 frame、翻转及 chOff/chExt 缩放，不能等同于组所在父坐标系。 */
export function elementChildrenToSlideMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  const element = effectiveElement(doc, id);
  if (element.kind !== 'group') throw new Error(`非组元素没有子坐标系：${id}`);
  return composeSpaceMatrices(
    elementFrameToSlideMatrix(doc, id),
    composeSpaceMatrices(flipInFrame(element), childrenToGroupFrame(element)),
  );
}

/**
 * 渲染器把组变换折算进子元素外框（描边、字号不随组缩放）；DOM 补丁与文字覆盖层
 * 必须用同一份外框，否则组内元素重绘或编辑时会按子坐标尺寸错位、字号被组缩放放大。
 */
function renderedChain(doc: EditDoc, id: ElementId): SlideElement[] {
  const out: SlideElement[] = [];
  for (const elementId of elementChain(doc, id)) {
    const own = effectiveElement(doc, elementId);
    const parent = out[out.length - 1];
    if (parent && parent.kind !== 'group') throw new Error(`非组元素不能拥有子元素：${elementId}`);
    out.push(parent ? placeGroupChild(parent, own) : own);
  }
  return out;
}

/** 元素在其父容器渲染坐标中的投影：组内子元素已折算组缩放。 */
export function renderedElement(doc: EditDoc, id: ElementId): SlideElement {
  const chain = renderedChain(doc, id);
  return chain[chain.length - 1];
}

/** 渲染外框到幻灯片坐标：沿祖先组只叠加外框平移、旋转与翻转，缩放已进入外框尺寸。 */
export function renderedFrameToSlideMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  const chain = renderedChain(doc, id);
  let matrix = IDENTITY;
  for (let index = 0; index < chain.length - 1; index++) {
    matrix = composeSpaceMatrices(
      matrix,
      composeSpaceMatrices(elementFrameToParentMatrix(chain[index]), flipInFrame(chain[index])),
    );
  }
  return composeSpaceMatrices(matrix, elementFrameToParentMatrix(chain[chain.length - 1]));
}

export function renderedContentToSlideMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  return composeSpaceMatrices(renderedFrameToSlideMatrix(doc, id), flipInFrame(renderedElement(doc, id)));
}

/**
 * 父组子坐标 → 父组渲染坐标。手势预览矩阵在模型父空间里求得，挂到组内 DOM 前需共轭到渲染坐标；
 * 顶层元素的两套坐标相同。
 */
export function elementParentToRenderedParentMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  const chain = renderedChain(doc, id);
  const parent = chain[chain.length - 2];
  if (!parent) return IDENTITY;
  if (parent.kind !== 'group') throw new Error(`非组元素不能拥有子元素：${id}`);
  return childrenToGroupFrame(parent);
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
