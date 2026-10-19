import {
  composeSpaceMatrices, editFrameToModelFrame, elementEditParentToSlideMatrix, elementFrameToParentMatrix,
  invertSpaceMatrix, transformSpacePoint,
} from '@web-ppt/edit-core';
import type {
  AffineMatrix, EditDoc, Editor, ElementEditFrame, ElementId, SpacePoint,
} from '@web-ppt/edit-core';

export const MIN_FRAME_SIZE = 1 / 9525;

/** 手势中的外框一律是编辑外框：父组渲染坐标里的刚体外框（见 edit-core elementEditFrame）。 */
export type TransformFrame = ElementEditFrame;

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

/** 预览 wrapper 位于父组渲染坐标；矩阵把旧编辑外框直接映射到新外框，不触碰静态 markup。 */
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

type XfrmField = 'x' | 'y' | 'w' | 'h' | 'rot';
const XFRM_FIELDS: readonly XfrmField[] = ['x', 'y', 'w', 'h', 'rot'];

/**
 * 编辑外框换算回模型后要写入的 SetXfrm 字段：always 里的字段照写，其余字段只在与模型原值
 * 相差至少 1e-9 时写入。渲染外框往返模型会带入舍入误差，不能因此产生无意义的补丁。
 */
export function modelXfrmFields(
  editor: Pick<Editor, 'doc' | 'effectiveElement'>, id: ElementId, frame: TransformFrame,
  always: readonly XfrmField[],
): Partial<Record<XfrmField, number>> {
  const model = editFrameToModelFrame(editor.doc, id, frame);
  const source = editor.effectiveElement(id);
  const fields: Partial<Record<XfrmField, number>> = {};
  for (const field of XFRM_FIELDS) {
    if (always.includes(field) || Math.abs(model[field] - source[field]) >= 1e-9) fields[field] = model[field];
  }
  return fields;
}

export function transformFrameCorners(doc: EditDoc, id: ElementId, frame: TransformFrame): [
  SpacePoint, SpacePoint, SpacePoint, SpacePoint,
] {
  const matrix = composeSpaceMatrices(
    elementEditParentToSlideMatrix(doc, id),
    elementFrameToParentMatrix(frame),
  );
  return [
    transformSpacePoint(matrix, { x: 0, y: 0 }),
    transformSpacePoint(matrix, { x: frame.w, y: 0 }),
    transformSpacePoint(matrix, { x: frame.w, y: frame.h }),
    transformSpacePoint(matrix, { x: 0, y: frame.h }),
  ];
}
