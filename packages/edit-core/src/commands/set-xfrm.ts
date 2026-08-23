import type { EditDoc } from '../types';
import { elementTransformPatches } from './element-transform';
import type { CommandPatches, SetXfrmCommand } from './types';
import { NUMERIC_XFRM_FIELDS } from './xfrm';

export function setXfrmPatches(doc: EditDoc, command: SetXfrmCommand, origin: string): CommandPatches {
  if (!NUMERIC_XFRM_FIELDS.some((field) => command[field] !== undefined)) {
    throw new Error('SetXfrm 至少需要一个变换字段');
  }
  return elementTransformPatches(doc, command.id, command, NUMERIC_XFRM_FIELDS, origin, 'SetXfrm');
}
