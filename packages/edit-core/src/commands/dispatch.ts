import type { EditDoc } from '../types';
import { alignElementsPatches } from './align-elements';
import { editTextPatches } from './edit-text';
import { pasteElementsPatches } from './paste-elements';
import { removeElementPatches } from './element-tree';
import { setZPatches } from './set-z';
import { setRunPropsPatches } from './set-run-props';
import { setParaPropsPatches } from './set-para-props';
import { SET_FLIP_COMMAND_FIELDS, setFlipPatches } from './set-flip';
import { setXfrmPatches } from './set-xfrm';
import type {
  AlignElementsCommand, Command, CommandPatches, EditTextCommand, PasteElementsCommand, RemoveElementCommand, SetFlipCommand,
  SetParaPropsCommand, SetRunPropsCommand, SetXfrmCommand, SetZCommand,
} from './types';
import { NUMERIC_XFRM_FIELDS } from './xfrm';

interface CommandRegistration {
  readonly keys: ReadonlySet<PropertyKey>;
  readonly patches: (doc: EditDoc, command: Command, origin: string) => CommandPatches;
}

function register<C extends Command>(
  fields: readonly PropertyKey[],
  handler: (doc: EditDoc, command: C, origin: string) => CommandPatches,
): CommandRegistration {
  return {
    keys: new Set(['type', ...fields]),
    patches: (doc, command, origin) => handler(doc, command as C, origin),
  };
}

const COMMANDS: Readonly<Record<Command['type'], CommandRegistration>> = {
  SetXfrm: register<SetXfrmCommand>(['id', ...NUMERIC_XFRM_FIELDS], setXfrmPatches),
  SetFlip: register<SetFlipCommand>(['id', ...SET_FLIP_COMMAND_FIELDS], setFlipPatches),
  RemoveElement: register<RemoveElementCommand>(['id'], removeElementPatches),
  SetZ: register<SetZCommand>(['id', 'to'], setZPatches),
  AlignElements: register<AlignElementsCommand>(['ids', 'edge'], alignElementsPatches),
  PasteElements: register<PasteElementsCommand>(['payload', 'at'], pasteElementsPatches),
  EditText: register<EditTextCommand>(['id', 'ops'], editTextPatches),
  SetRunProps: register<SetRunPropsCommand>(['id', 'range', 'props'], setRunPropsPatches),
  SetParaProps: register<SetParaPropsCommand>(['id', 'range', 'props'], setParaPropsPatches),
};

function assertPureCommand(input: Command): void {
  if (!input || typeof input !== 'object') throw new Error('命令必须是纯数据对象');
  const type = (input as Partial<Command>).type as Command['type'];
  const allowed = COMMANDS[type]?.keys ?? new Set<PropertyKey>(['type', 'id']);
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!allowed.has(key) || !descriptor?.enumerable || !('value' in descriptor)) {
      throw new Error(`命令包含不可序列化或未知字段：${String(key)}`);
    }
  }
  if (input.type !== 'AlignElements' && input.type !== 'PasteElements') {
    if (typeof input.id !== 'string' || !input.id) throw new Error('命令 id 必须是非空字符串');
  }
}

export function commandPatches(doc: EditDoc, command: Command, origin: string): CommandPatches {
  assertPureCommand(command);
  const registration = COMMANDS[command.type];
  if (!registration) throw new Error(`不支持的命令：${String((command as Partial<Command>).type)}`);
  return registration.patches(doc, command, origin);
}
