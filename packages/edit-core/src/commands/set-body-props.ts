import { applyBodyProps } from '../body-properties';
import { assertTextBodyPropertyOverrides } from '../body-property-schema';
import { flattenTextBody } from '../text-model';
import type { EditDoc } from '../types';
import type { CommandPatches, SetBodyPropsCommand } from './types';
import { inverseTextPatch, setTextPatch, textTargetContext } from './text-target';

export function setBodyPropsPatches(
  doc: EditDoc,
  command: SetBodyPropsCommand,
  origin: string,
): CommandPatches {
  assertTextBodyPropertyOverrides(command.props, 'SetBodyProps.props');
  const target = { id: command.id };
  const { record, body: source, before } = textTargetContext(doc, target);
  const sourceBaseline = flattenTextBody(source);
  const baseline = before?.kind === 'flat' ? before : before?.body
    ? { ...sourceBaseline, body: before.body, ...(before.bodyOverrides ? { bodyOverrides: before.bodyOverrides } : {}) }
    : sourceBaseline;
  const applied = applyBodyProps(baseline, command.props, source.editInfo);
  const staysEmpty = before?.kind === 'empty'
    || (!before && record.src.kind === 'shape' && record.src.text === null);
  const value = staysEmpty
    ? {
      kind: 'empty' as const,
      body: applied.body,
      ...(applied.bodyOverrides ? { bodyOverrides: applied.bodyOverrides } : {}),
    }
    : applied;
  if (JSON.stringify(value) === JSON.stringify(before ?? baseline)) return { forward: [], inverse: [] };
  return {
    forward: [setTextPatch(target, value, origin)],
    inverse: [inverseTextPatch(target, before, origin)],
  };
}
