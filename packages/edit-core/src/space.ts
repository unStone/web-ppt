import { placeGroupChild, placeGroupFrame, unplaceGroupFrame } from '@web-ppt/core';
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

/**
 * 渲染器把组变换折算进子元素外框（描边、字号不随组缩放）。所有屏幕几何都沿这条渲染链求，
 * 否则非等比组合里的旋转子元素会被当成斜切的平行四边形，选择框、命中与手势和画面对不上。
 */
interface RenderedChain {
  elements: SlideElement[];
  /** 末元素自身局部坐标各轴承接的组缩放；顶层元素为 1。 */
  kx: number;
  ky: number;
}

function renderedChain(doc: EditDoc, id: ElementId): RenderedChain {
  const elements: SlideElement[] = [];
  let kx = 1;
  let ky = 1;
  for (const elementId of elementChain(doc, id)) {
    const own = effectiveElement(doc, elementId);
    const parent = elements[elements.length - 1];
    if (parent && parent.kind !== 'group') throw new Error(`非组元素不能拥有子元素：${elementId}`);
    if (parent) {
      ({ kx, ky } = placeGroupFrame(parent, own));
      elements.push(placeGroupChild(parent, own));
    } else {
      kx = 1;
      ky = 1;
      elements.push(own);
    }
  }
  return { elements, kx, ky };
}

/** 父组渲染坐标 → 幻灯片：沿祖先组只叠加外框平移、旋转与翻转。 */
function editParentToSlide(chain: RenderedChain): AffineMatrix {
  let matrix = IDENTITY;
  for (let index = 0; index < chain.elements.length - 1; index++) {
    const element = chain.elements[index];
    matrix = composeSpaceMatrices(
      matrix, composeSpaceMatrices(elementFrameToParentMatrix(element), flipInFrame(element)),
    );
  }
  return matrix;
}

function renderedParent(chain: RenderedChain, id: ElementId): GroupElement | null {
  const parent = chain.elements[chain.elements.length - 2];
  if (!parent) return null;
  if (parent.kind !== 'group') throw new Error(`非组元素不能拥有子元素：${id}`);
  return parent;
}

/** 模型局部坐标（0..w, 0..h）→ 幻灯片：渲染外框再乘上各轴组缩放，保持刚体。 */
export function elementFrameToSlideMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  const chain = renderedChain(doc, id);
  return composeSpaceMatrices(
    composeSpaceMatrices(
      editParentToSlide(chain), elementFrameToParentMatrix(chain.elements[chain.elements.length - 1]),
    ),
    scaling(chain.kx, chain.ky),
  );
}

/** 元素内容坐标还要经过自身翻转；frame 几何本身不含这一步。 */
export function elementContentToSlideMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  const element = effectiveElement(doc, id);
  return composeSpaceMatrices(elementFrameToSlideMatrix(doc, id), flipInFrame(element));
}

/**
 * 模型父空间（父组子坐标）→ 幻灯片。子元素中心按直接父组渲染后的缩放映射，
 * 所以平移类命令在这里换算的位移与画面一致；外框尺寸与旋转改用编辑父空间计算。
 */
export function elementParentToSlideMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  const chain = renderedChain(doc, id);
  const parent = renderedParent(chain, id);
  return parent
    ? composeSpaceMatrices(editParentToSlide(chain), childrenToGroupFrame(parent))
    : IDENTITY;
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

/** 元素在其父容器渲染坐标中的投影：组内子元素已折算组缩放。 */
export function renderedElement(doc: EditDoc, id: ElementId): SlideElement {
  const chain = renderedChain(doc, id);
  return chain.elements[chain.elements.length - 1];
}

/** 渲染外框到幻灯片坐标：沿祖先组只叠加外框平移、旋转与翻转，缩放已进入外框尺寸。 */
export function renderedFrameToSlideMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  const chain = renderedChain(doc, id);
  return composeSpaceMatrices(
    editParentToSlide(chain), elementFrameToParentMatrix(chain.elements[chain.elements.length - 1]),
  );
}

export function renderedContentToSlideMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  return composeSpaceMatrices(renderedFrameToSlideMatrix(doc, id), flipInFrame(renderedElement(doc, id)));
}

/**
 * 父组子坐标 → 父组渲染坐标；顶层元素的两套坐标相同。
 * 平移预览在模型父空间求得，挂到组内 DOM 前用它换算位移。
 */
export function elementParentToRenderedParentMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  const parent = renderedParent(renderedChain(doc, id), id);
  return parent ? childrenToGroupFrame(parent) : IDENTITY;
}

/**
 * 编辑外框：元素在父组渲染坐标里的刚体外框。缩放与旋转手势在这里计算，
 * 提交前经 editFrameToModelFrame 写回模型，画面与提交结果因此一致。
 */
export interface ElementEditFrame extends ElementFrameTransform {
  flipH: boolean;
  flipV: boolean;
}

export function elementEditFrame(doc: EditDoc, id: ElementId): ElementEditFrame {
  const element = renderedElement(doc, id);
  return {
    x: element.x, y: element.y, w: element.w, h: element.h, rot: element.rot,
    flipH: element.flipH, flipV: element.flipV,
  };
}

/** 父组渲染坐标（编辑父空间）→ 幻灯片。 */
export function elementEditParentToSlideMatrix(doc: EditDoc, id: ElementId): AffineMatrix {
  return editParentToSlide(renderedChain(doc, id));
}

export function slideToElementEditParentPoint(doc: EditDoc, id: ElementId, point: SpacePoint): SpacePoint {
  return transformSpacePoint(invertSpaceMatrix(elementEditParentToSlideMatrix(doc, id)), point);
}

/**
 * 编辑外框 → 模型外框（父组子坐标）。旋转只改角度，宽高按目标角度所在象限承接的组缩放除回去：
 * 跨过 45° 等边界时画面尺寸保持不变，由模型宽高吸收轴向互换。
 */
export function editFrameToModelFrame(
  doc: EditDoc, id: ElementId, frame: ElementFrameTransform,
): ElementFrameTransform {
  const parent = renderedParent(renderedChain(doc, id), id);
  if (!parent) return { x: frame.x, y: frame.y, w: frame.w, h: frame.h, rot: frame.rot };
  return { ...unplaceGroupFrame(parent, frame), rot: frame.rot };
}

/** 组合子元素的编辑父空间 → 幻灯片；粘贴进组合时用它把幻灯片外框换算成刚体的组内外框。 */
export function groupEditChildrenToSlideMatrix(doc: EditDoc, groupId: ElementId): AffineMatrix {
  const chain = renderedChain(doc, groupId);
  const group = chain.elements[chain.elements.length - 1];
  if (group.kind !== 'group') throw new Error(`非组元素没有子坐标系：${groupId}`);
  return composeSpaceMatrices(
    editParentToSlide(chain),
    composeSpaceMatrices(elementFrameToParentMatrix(group), flipInFrame(group)),
  );
}

/** 组合内的编辑外框 → 该组合子坐标里的模型外框。 */
export function groupEditFrameToModelFrame(
  doc: EditDoc, groupId: ElementId, frame: ElementFrameTransform,
): ElementFrameTransform {
  const group = renderedElement(doc, groupId);
  if (group.kind !== 'group') throw new Error(`非组元素没有子坐标系：${groupId}`);
  return { ...unplaceGroupFrame(group, frame), rot: frame.rot };
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
