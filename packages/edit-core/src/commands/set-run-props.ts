import { applyRunProps, flattenTextBody, queryTextRunProps, textBodyFromOverride } from '../text-model';
import { textPositionToIndex } from '../text-position';
import { assertTextRange, own } from '../data-validation';
import { assertRunPropertyOverrides } from '../run-property-schema';
import type { EditDoc, TextOverride } from '../types';
import type { CommandPatches, SetRunPropsCommand } from './types';

function validate(command: SetRunPropsCommand): void {
  assertTextRange(command.range, 'SetRunProps.range');
  assertRunPropertyOverrides(command.props, 'SetRunProps.props');
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
