import { applyParagraphProps, flattenTextBody, textBodyFromOverride } from '../text-model';
import { assertTextRange, own } from '../data-validation';
import { assertParagraphPropertyOverrides } from '../paragraph-property-schema';
import type { EditDoc, TextOverride } from '../types';
import type { CommandPatches, SetParaPropsCommand } from './types';

function validate(command: SetParaPropsCommand): void {
  assertTextRange(command.range, 'SetParaProps.range');
  assertParagraphPropertyOverrides(command.props, 'SetParaProps.props');
}

export function setParaPropsPatches(
  doc: EditDoc,
  command: SetParaPropsCommand,
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
  const value: TextOverride = applyParagraphProps(
    body, command.range, command.props, before?.kind === 'flat' ? before : undefined,
  );
  const baseline = before?.kind === 'flat' ? before : flattenTextBody(body);
  if (JSON.stringify(value) === JSON.stringify(baseline)) return { forward: [], inverse: [] };
  const path = ['elements', command.id, 'ovr', 'text'] as const;
  return {
    forward: [{ op: 'set', path, value, origin }],
    inverse: [own(record.ovr, 'text') && before
      ? { op: 'set', path, value: before, origin }
      : { op: 'del', path, origin }],
  };
}
