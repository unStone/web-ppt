import { applyRunProps, flattenTextBody, queryTextRunProps, textBodyFromOverride } from '../text-model';
import { textPositionToIndex } from '../text-position';
import { assertTextRange } from '../data-validation';
import { assertRunPropertyOverrides } from '../run-property-schema';
import type { EditDoc, TextOverride } from '../types';
import type { CommandPatches, SetRunPropsCommand } from './types';
import { inverseTextPatch, setTextPatch, textTargetContext } from './text-target';

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
  const target = { id: command.id, ...(command.cell !== undefined ? { cell: command.cell } : {}) };
  const { body: source, before, patchTarget } = textTargetContext(doc, target);
  const body = before?.kind === 'flat'
    ? textBodyFromOverride(before)
    : source;
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
  return {
    forward: [setTextPatch(patchTarget, value, origin)],
    inverse: [inverseTextPatch(patchTarget, before, origin)],
  };
}
