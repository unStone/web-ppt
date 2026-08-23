import type { EditDoc } from '../types';
import { elementTransformPatches } from './element-transform';
import type { CommandPatches, SetFlipCommand } from './types';
import { FLIP_FIELDS } from './xfrm';

export const SET_FLIP_COMMAND_FIELDS = ['h', 'v'] as const;

export function setFlipPatches(doc: EditDoc, command: SetFlipCommand, origin: string): CommandPatches {
  if (!SET_FLIP_COMMAND_FIELDS.some((field) => command[field] !== undefined)) {
    throw new Error('SetFlip 至少需要一个翻转字段');
  }
  return elementTransformPatches(doc, command.id, {
    flipH: command.h,
    flipV: command.v,
  }, FLIP_FIELDS, origin, 'SetFlip');
}
