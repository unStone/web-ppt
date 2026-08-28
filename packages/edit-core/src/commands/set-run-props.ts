import { applyRunProps, flattenTextBody, queryTextRunProps, textBodyFromOverride } from '../text-model';
import { textPositionToIndex } from '../text-position';
import { assertTextRange } from '../data-validation';
import { assertRunPropertyOverrides } from '../run-property-schema';
import { normalizeLinkTarget } from '../hyperlink';
import { own } from '../data-validation';
import { normalizeDrawingColor } from '../shape-fill';
import type { EditDoc, RunPropertyOverrides, TextOverride } from '../types';
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
  const props: RunPropertyOverrides = {
    ...command.props,
    ...(own(command.props, 'color') && command.props.color !== null
      ? { color: normalizeDrawingColor(command.props.color!) } : {}),
    ...(own(command.props, 'link') && command.props.link !== null
      ? { link: normalizeLinkTarget(doc, command.props.link!, 'SetRunProps.props.link') } : {}),
  };
  const body = before?.kind === 'flat'
    ? textBodyFromOverride(before)
    : source;
  queryTextRunProps(body, command.range, before?.kind === 'flat' ? before : undefined);
  if (textPositionToIndex(body, command.range.from) === textPositionToIndex(body, command.range.to)) {
    return { forward: [], inverse: [] };
  }
  const value: TextOverride = applyRunProps(
    body, command.range, props, before?.kind === 'flat' ? before : undefined,
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
