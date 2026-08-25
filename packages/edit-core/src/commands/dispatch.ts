import type { EditDoc, ElementId } from '../types';
import { alignElementsPatches } from './align-elements';
import { editTextPatches } from './edit-text';
import { fitTextShapePatches } from './fit-text-shape';
import { pasteElementsPatches } from './paste-elements';
import { removeElementPatches } from './element-tree';
import { setZPatches } from './set-z';
import { setRunPropsPatches } from './set-run-props';
import { setParaPropsPatches } from './set-para-props';
import { SET_FLIP_COMMAND_FIELDS, setFlipPatches } from './set-flip';
import { setXfrmPatches } from './set-xfrm';
import { setBodyPropsPatches } from './set-body-props';
import { insertRowPatches } from './insert-row';
import { addShapePatches } from './add-shape';
import { addImagePatches } from './add-image';
import { addTablePatches } from './add-table';
import { addSlidePatches } from './add-slide';
import { moveSlidePatches } from './slide-order';
import { removeSlidePatches } from './remove-slide';
import { duplicateSlidePatches } from './duplicate-slide';
import { setFillPatches } from './set-fill';
import { setStrokePatches } from './set-stroke';
import { setEffectsPatches } from './set-effects';
import { setLinkPatches } from './set-link';
import { setCropPatches } from './set-crop';
import { replaceImagePatches } from './replace-image';
import { setBackgroundPatches, setHiddenPatches } from './set-slide-properties';
import type {
  AddImageCommand, AddShapeCommand, AddSlideCommand, AddTableCommand, AlignElementsCommand, Command, CommandPatches, DuplicateSlideCommand, EditTextCommand, FitTextShapeCommand, MoveSlideCommand, PasteElementsCommand, RemoveElementCommand, RemoveSlideCommand, ReplaceImageCommand, SetCropCommand, SetFlipCommand,
  InsertRowCommand, SetBackgroundCommand, SetBodyPropsCommand, SetEffectsCommand, SetFillCommand, SetHiddenCommand, SetLinkCommand, SetParaPropsCommand, SetRunPropsCommand, SetStrokeCommand, SetXfrmCommand, SetZCommand,
} from './types';
import { NUMERIC_XFRM_FIELDS } from './xfrm';

interface CommandRegistration {
  readonly keys: ReadonlySet<PropertyKey>;
  readonly target: 'id' | 'ids' | 'none';
  readonly selectInserted?: boolean;
  readonly patches: (doc: EditDoc, command: Command, origin: string) => CommandPatches;
}

function register<C extends Command>(
  fields: readonly PropertyKey[],
  handler: (doc: EditDoc, command: C, origin: string) => CommandPatches,
  options: Pick<CommandRegistration, 'target' | 'selectInserted'> = { target: 'id' },
): CommandRegistration {
  return {
    keys: new Set(['type', ...fields]),
    target: options.target,
    ...(options.selectInserted ? { selectInserted: true } : {}),
    patches: (doc, command, origin) => handler(doc, command as C, origin),
  };
}

const COMMANDS: Readonly<Record<Command['type'], CommandRegistration>> = {
  SetXfrm: register<SetXfrmCommand>(['id', ...NUMERIC_XFRM_FIELDS], setXfrmPatches),
  SetFlip: register<SetFlipCommand>(['id', ...SET_FLIP_COMMAND_FIELDS], setFlipPatches),
  RemoveElement: register<RemoveElementCommand>(['id'], removeElementPatches),
  SetZ: register<SetZCommand>(['id', 'to'], setZPatches),
  AlignElements: register<AlignElementsCommand>(['ids', 'edge'], alignElementsPatches, { target: 'ids' }),
  PasteElements: register<PasteElementsCommand>(['payload', 'at'], pasteElementsPatches, { target: 'none' }),
  AddShape: register<AddShapeCommand>(['slideId', 'preset', 'rect'], addShapePatches,
    { target: 'none', selectInserted: true }),
  AddImage: register<AddImageCommand>(['slideId', 'placeholderId', 'bytes', 'mime', 'rect'], addImagePatches,
    { target: 'none', selectInserted: true }),
  ReplaceImage: register<ReplaceImageCommand>(['id', 'bytes', 'mime'], replaceImagePatches),
  SetCrop: register<SetCropCommand>(['id', 'crop'], setCropPatches),
  AddTable: register<AddTableCommand>(['slideId', 'rows', 'cols', 'rect', 'placeholderId'], addTablePatches,
    { target: 'none', selectInserted: true }),
  AddSlide: register<AddSlideCommand>(['layoutId', 'at'], addSlidePatches, { target: 'none' }),
  MoveSlide: register<MoveSlideCommand>(['id', 'at'], moveSlidePatches, { target: 'none' }),
  RemoveSlide: register<RemoveSlideCommand>(['id'], removeSlidePatches, { target: 'none' }),
  DuplicateSlide: register<DuplicateSlideCommand>(['id'], duplicateSlidePatches, { target: 'none' }),
  SetBackground: register<SetBackgroundCommand>(['id', 'fill'], setBackgroundPatches, { target: 'none' }),
  SetHidden: register<SetHiddenCommand>(['id', 'v'], setHiddenPatches, { target: 'none' }),
  SetFill: register<SetFillCommand>(['id', 'fill'], setFillPatches),
  SetStroke: register<SetStrokeCommand>(['id', 'stroke'], setStrokePatches),
  SetEffects: register<SetEffectsCommand>(['id', 'effects'], setEffectsPatches),
  SetLink: register<SetLinkCommand>(['id', 'target'], setLinkPatches),
  EditText: register<EditTextCommand>(['id', 'cell', 'ops'], editTextPatches),
  SetRunProps: register<SetRunPropsCommand>(['id', 'cell', 'range', 'props'], setRunPropsPatches),
  SetParaProps: register<SetParaPropsCommand>(['id', 'cell', 'range', 'props'], setParaPropsPatches),
  FitTextShape: register<FitTextShapeCommand>(['id'], fitTextShapePatches),
  SetBodyProps: register<SetBodyPropsCommand>(['id', 'props'], setBodyPropsPatches),
  InsertRow: register<InsertRowCommand>(['id'], insertRowPatches),
};

function assertPureCommand(input: Command): void {
  if (!input || typeof input !== 'object') throw new Error('命令必须是纯数据对象');
  const type = (input as Partial<Command>).type as Command['type'];
  const registration = COMMANDS[type];
  const allowed = registration?.keys ?? new Set<PropertyKey>(['type', 'id']);
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!allowed.has(key) || !descriptor?.enumerable || !('value' in descriptor)) {
      throw new Error(`命令包含不可序列化或未知字段：${String(key)}`);
    }
  }
  if ((registration?.target ?? 'id') === 'id') {
    const id = (input as Partial<Command> & { id?: unknown }).id;
    if (typeof id !== 'string' || !id) throw new Error('命令 id 必须是非空字符串');
  }
}

/** 批处理冲突检测与命令注册共享目标语义；非法动态输入留给纯数据校验给出具体错误。 */
export function commandTargetIds(command: Command): readonly ElementId[] {
  const registration = COMMANDS[(command as Partial<Command>).type as Command['type']];
  if (registration?.target === 'ids') {
    const ids = (command as Partial<AlignElementsCommand>).ids;
    return Array.isArray(ids) ? ids.filter((id): id is ElementId => typeof id === 'string' && !!id) : [];
  }
  if ((registration?.target ?? 'id') === 'id') {
    const id = (command as Partial<Command> & { id?: unknown }).id;
    return typeof id === 'string' && id ? [id] : [];
  }
  return [];
}

export function commandSelectsInsertedElement(command: Command): boolean {
  return COMMANDS[(command as Partial<Command>).type as Command['type']]?.selectInserted === true;
}

export function commandPatches(doc: EditDoc, command: Command, origin: string): CommandPatches {
  assertPureCommand(command);
  const registration = COMMANDS[command.type];
  if (!registration) throw new Error(`不支持的命令：${String((command as Partial<Command>).type)}`);
  return registration.patches(doc, command, origin);
}
