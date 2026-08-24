import {
  composeSpaceMatrices, elementFrameToParentMatrix, elementParentToSlideMatrix,
  invertSpaceMatrix, transformSpacePoint,
} from '@web-ppt/edit-core';
import type {
  AffineMatrix, EditDoc, ElementFrameTransform, ElementId, SpacePoint,
} from '@web-ppt/edit-core';

export const MIN_FRAME_SIZE = 1 / 9525;

export interface TransformFrame extends ElementFrameTransform {
  flipH: boolean;
  flipV: boolean;
}

const scaleMatrix = (x: number, y: number): AffineMatrix => ({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 });
const translationMatrix = (x: number, y: number): AffineMatrix => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });

function flipDelta(source: TransformFrame, next: TransformFrame): AffineMatrix {
  const x = source.flipH === next.flipH ? 1 : -1;
  const y = source.flipV === next.flipV ? 1 : -1;
  if (x === 1 && y === 1) return scaleMatrix(1, 1);
  return composeSpaceMatrices(
    translationMatrix(source.w / 2, source.h / 2),
    composeSpaceMatrices(scaleMatrix(x, y), translationMatrix(-source.w / 2, -source.h / 2)),
  );
}

/** 预览 wrapper 位于元素父空间；矩阵把旧渲染框直接映射到新框，不触碰静态 markup。 */
export function transformPreviewMatrix(source: TransformFrame, next: TransformFrame): AffineMatrix {
  return composeSpaceMatrices(
    elementFrameToParentMatrix(next),
    composeSpaceMatrices(
      scaleMatrix(
        next.w / Math.max(source.w, MIN_FRAME_SIZE),
        next.h / Math.max(source.h, MIN_FRAME_SIZE),
      ),
      composeSpaceMatrices(flipDelta(source, next), invertSpaceMatrix(elementFrameToParentMatrix(source))),
    ),
  );
}

export function transformFrameCorners(doc: EditDoc, id: ElementId, frame: TransformFrame): [
  SpacePoint, SpacePoint, SpacePoint, SpacePoint,
] {
  const matrix = composeSpaceMatrices(
    elementParentToSlideMatrix(doc, id),
    elementFrameToParentMatrix(frame),
  );
  return [
    transformSpacePoint(matrix, { x: 0, y: 0 }),
    transformSpacePoint(matrix, { x: frame.w, y: 0 }),
    transformSpacePoint(matrix, { x: frame.w, y: frame.h }),
    transformSpacePoint(matrix, { x: 0, y: frame.h }),
  ];
}
