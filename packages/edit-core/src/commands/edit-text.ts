import { applyTextEditOps, textBodyFromOverride } from '../text-model';
import type { EditDoc, TextOverride } from '../types';
import type { CommandPatches, EditTextCommand } from './types';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

function assertDataObject(value: unknown, fields: readonly string[], label: string): asserts value is object {
  if (!value || typeof value !== 'object'
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${label} 必须是纯数据对象`);
  }
  const allowed = new Set(fields);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.has(key) || !descriptor?.enumerable || !('value' in descriptor)) {
      throw new Error(`${label} 包含未知或不可序列化字段：${String(key)}`);
    }
  }
}

function assertPosition(value: unknown, label: string): void {
  assertDataObject(value, ['p', 'r', 'off'], label);
  for (const field of ['p', 'r', 'off'] as const) {
    if (!Number.isInteger((value as Record<string, unknown>)[field])
      || Number((value as Record<string, unknown>)[field]) < 0) {
      throw new Error(`${label}.${field} 必须是非负整数`);
    }
  }
}

function assertOps(command: EditTextCommand): void {
  if (!Array.isArray(command.ops) || !command.ops.length) throw new Error('EditText 至少需要一个操作');
  command.ops.forEach((input, index) => {
    const op = input as unknown as Record<string, unknown>;
    if (op?.type === 'replace') {
      assertDataObject(op, ['type', 'from', 'to', 'text'], `EditText.ops[${index}]`);
      assertPosition(op.from, `EditText.ops[${index}].from`);
      assertPosition(op.to, `EditText.ops[${index}].to`);
      if (typeof op.text !== 'string') throw new Error(`EditText.ops[${index}].text 必须是字符串`);
      return;
    }
    if (op?.type === 'splitParagraph' || op?.type === 'insertLineBreak') {
      assertDataObject(op, ['type', 'at'], `EditText.ops[${index}]`);
      assertPosition(op.at, `EditText.ops[${index}].at`);
      return;
    }
    throw new Error(`EditText.ops[${index}] 的类型无效`);
  });
}

function sourceBody(doc: EditDoc, command: EditTextCommand) {
  const record = doc.elements[command.id];
  if (!record || record.src.kind !== 'shape' || (!record.src.text && !record.meta.textTemplate)) {
    throw new Error(`找不到可编辑文字的形状：${command.id}`);
  }
  if (record.meta.editable !== 'full') throw new Error(`元素 ${command.id} 的文字不可编辑`);
  assertOps(command);
  return { record, body: record.ovr.text?.kind === 'flat'
    ? textBodyFromOverride(record.ovr.text)
    : (record.src.text ?? record.meta.textTemplate!) };
}

export function editTextPatches(
  doc: EditDoc,
  command: EditTextCommand,
  origin: string,
): CommandPatches {
  const { record, body } = sourceBody(doc, command);
  const before = record.ovr.text;
  const value: TextOverride = applyTextEditOps(
    body, command.ops, before?.kind === 'flat' ? before : undefined,
  );
  const path = ['elements', command.id, 'ovr', 'text'] as const;
  return {
    forward: [{ op: 'set', path, value, origin }],
    inverse: [own(record.ovr, 'text') && before
      ? { op: 'set', path, value: before, origin }
      : { op: 'del', path, origin }],
  };
}
