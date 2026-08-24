import { applyRunProps, flattenTextBody, queryTextRunProps, textBodyFromOverride } from '../text-model';
import { textPositionToIndex } from '../text-position';
import { assertDataObject, assertTextRange, own } from '../data-validation';
import type { EditDoc, TextOverride } from '../types';
import type { CommandPatches, SetRunPropsCommand } from './types';

function validate(command: SetRunPropsCommand): void {
  assertTextRange(command.range, 'SetRunProps.range');
  const fields = ['font', 'size', 'b', 'i', 'u', 'strike'] as const;
  assertDataObject(command.props, fields, 'SetRunProps.props');
  if (!fields.some((field) => own(command.props, field))) throw new Error('SetRunProps.props 不能为空');
  if (own(command.props, 'font') && command.props.font !== null
    && (typeof command.props.font !== 'string' || !command.props.font.trim()
      || command.props.font !== command.props.font.trim() || /[\u0000-\u001f]/.test(command.props.font))) {
    throw new Error('SetRunProps.props.font 必须是非空字体名或 null');
  }
  if (own(command.props, 'size') && command.props.size !== null
    && (typeof command.props.size !== 'number' || !Number.isFinite(command.props.size) || command.props.size <= 0)) {
    throw new Error('SetRunProps.props.size 必须是有限正数或 null');
  }
  for (const field of ['b', 'i', 'u', 'strike'] as const) {
    if (own(command.props, field) && command.props[field] !== null
      && typeof command.props[field] !== 'boolean') {
      throw new Error(`SetRunProps.props.${field} 必须是布尔值或 null`);
    }
  }
}

export function setRunPropsPatches(
  doc: EditDoc,
  command: SetRunPropsCommand,
  origin: string,
): CommandPatches {
  validate(command);
  const record = doc.elements[command.id];
  if (!record || record.src.kind !== 'shape' || (!record.src.text && !record.meta.textTemplate)
    || record.meta.editable !== 'full') {
    throw new Error(`找不到可编辑文字的形状：${command.id}`);
  }
  const before = record.ovr.text;
  const body = before?.kind === 'flat'
    ? textBodyFromOverride(before)
    : (record.src.text ?? record.meta.textTemplate!);
  queryTextRunProps(body, command.range, before?.kind === 'flat' ? before : undefined);
  if (textPositionToIndex(body, command.range.from) === textPositionToIndex(body, command.range.to)) {
    return { forward: [], inverse: [] };
  }
  const value: TextOverride = applyRunProps(
    body, command.range, command.props, before?.kind === 'flat' ? before : undefined,
  );
  const baseline = before?.kind === 'flat' ? before : flattenTextBody(body);
  if (JSON.stringify(value) === JSON.stringify(baseline)) {
    return { forward: [], inverse: [] };
  }
  const path = ['elements', command.id, 'ovr', 'text'] as const;
  return {
    forward: [{ op: 'set', path, value, origin }],
    inverse: [own(record.ovr, 'text') && before
      ? { op: 'set', path, value: before, origin }
      : { op: 'del', path, origin }],
  };
}
