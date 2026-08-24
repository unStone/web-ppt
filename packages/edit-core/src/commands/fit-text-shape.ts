import { fitTextShapeHeight } from '@web-ppt/core';
import { effectiveElement } from '../projection';
import { elementFrameToParentMatrix, transformSpacePoint } from '../space';
import type { EditDoc } from '../types';
import { elementTransformPatches } from './element-transform';
import type { CommandPatches, FitTextShapeCommand } from './types';

const EMU_PER_PX = 9525;

function physicalAnchorFraction(anchor: 'top' | 'middle' | 'bottom', flipV: boolean): number {
  const logical = anchor === 'middle' ? 0.5 : anchor === 'bottom' ? 1 : 0;
  return flipV ? 1 - logical : logical;
}

/** 高度必须落在 OOXML 可写回的 EMU 网格上，否则保存重开会产生几何漂移。 */
function quantizeHeight(height: number): number {
  return Math.ceil(height * EMU_PER_PX - 1e-7) / EMU_PER_PX;
}

const quantizePosition = (position: number): number => Math.round(position * EMU_PER_PX) / EMU_PER_PX;

export function fitTextShapePatches(
  doc: EditDoc,
  command: FitTextShapeCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能执行命令');
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if (record.meta.editable !== 'full') throw new Error(`元素不支持文字形状改高：${command.id}`);
  if (record.meta.locked) throw new Error(`元素已锁定：${command.id}`);
  const element = effectiveElement(doc, command.id);
  if (element.kind !== 'shape' || !element.text?.autoFitShape) {
    throw new Error(`元素没有 spAutoFit 文字形状：${command.id}`);
  }

  const height = quantizeHeight(fitTextShapeHeight(element.text, element.w));
  if (Object.is(height, element.h)) return { forward: [], inverse: [] };
  const fraction = physicalAnchorFraction(element.text.anchor, element.flipV);
  const anchor = transformSpacePoint(
    elementFrameToParentMatrix(element),
    { x: element.w / 2, y: element.h * fraction },
  );
  const candidate = { ...element, h: height };
  const movedAnchor = transformSpacePoint(
    elementFrameToParentMatrix(candidate),
    { x: candidate.w / 2, y: candidate.h * fraction },
  );
  return elementTransformPatches(doc, command.id, {
    x: quantizePosition(element.x + anchor.x - movedAnchor.x),
    y: quantizePosition(element.y + anchor.y - movedAnchor.y),
    h: height,
  }, ['x', 'y', 'h'], origin, 'FitTextShape');
}
