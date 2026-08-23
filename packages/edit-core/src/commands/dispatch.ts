import type { EditDoc } from '../types';
import { setXfrmPatches } from './set-xfrm';
import type { Command, CommandPatches } from './types';
import { XFRM_FIELDS } from './xfrm';

const SET_XFRM_KEYS = new Set<PropertyKey>(['type', 'id', ...XFRM_FIELDS]);

function assertPureCommand(input: Command): void {
  if (!input || typeof input !== 'object') throw new Error('命令必须是纯数据对象');
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!SET_XFRM_KEYS.has(key) || !descriptor?.enumerable || !('value' in descriptor)) {
      throw new Error(`命令包含不可序列化或未知字段：${String(key)}`);
    }
  }
  if (typeof input.id !== 'string' || !input.id) throw new Error('命令 id 必须是非空字符串');
}

export function commandPatches(doc: EditDoc, command: Command, origin: string): CommandPatches {
  assertPureCommand(command);
  switch ((command as Partial<Command> | null)?.type) {
    case 'SetXfrm': return setXfrmPatches(doc, command, origin);
    default: throw new Error(`不支持的命令：${String((command as Partial<Command> | null)?.type)}`);
  }
}
