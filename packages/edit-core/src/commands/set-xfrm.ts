import type { EditDoc } from '../types';
import { tableBaseFrameHeight, tableRowHeightDelta } from '../table-rows';
import { elementTransformPatches } from './element-transform';
import type { CommandPatches, SetXfrmCommand } from './types';
import { assertXfrmValue, NUMERIC_XFRM_FIELDS } from './xfrm';

export function setXfrmPatches(doc: EditDoc, command: SetXfrmCommand, origin: string): CommandPatches {
  if (!NUMERIC_XFRM_FIELDS.some((field) => command[field] !== undefined)) {
    throw new Error('SetXfrm 至少需要一个变换字段');
  }
  const record = doc.elements[command.id];
  const rowDelta = record ? tableRowHeightDelta(record) : 0;
  if (command.h === undefined || rowDelta === 0) {
    return elementTransformPatches(doc, command.id, command, NUMERIC_XFRM_FIELDS, origin, 'SetXfrm');
  }
  assertXfrmValue('h', command.h, 'SetXfrm.h');
  const baseHeight = tableBaseFrameHeight(record!, command.h);
  // 追加行高度是稀疏派生量；用户设置的是可见 frame，覆盖层保存扣除派生量后的基准高度。
  return elementTransformPatches(doc, command.id, { ...command, h: baseHeight },
    NUMERIC_XFRM_FIELDS, origin, 'SetXfrm');
}
