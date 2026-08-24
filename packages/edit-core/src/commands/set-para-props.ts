import { applyParagraphProps, flattenTextBody, textBodyFromOverride } from '../text-model';
import { assertTextRange } from '../data-validation';
import { assertParagraphPropertyOverrides } from '../paragraph-property-schema';
import type { EditDoc, TextOverride } from '../types';
import type { CommandPatches, SetParaPropsCommand } from './types';
import { inverseTextPatch, setTextPatch, textTargetContext } from './text-target';

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
  const target = { id: command.id, ...(command.cell !== undefined ? { cell: command.cell } : {}) };
  const { body: source, before } = textTargetContext(doc, target);
  const body = before?.kind === 'flat'
    ? textBodyFromOverride(before)
    : source;
  const value: TextOverride = applyParagraphProps(
    body, command.range, command.props, before?.kind === 'flat' ? before : undefined,
  );
  const baseline = before?.kind === 'flat' ? before : flattenTextBody(body);
  if (JSON.stringify(value) === JSON.stringify(baseline)) return { forward: [], inverse: [] };
  return {
    forward: [setTextPatch(target, value, origin)],
    inverse: [inverseTextPatch(target, before, origin)],
  };
}
