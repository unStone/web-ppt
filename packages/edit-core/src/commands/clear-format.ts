import { assertTextRange } from '../data-validation';
import { clearRunFormat, flattenTextBody, queryTextRunProps, textBodyFromOverride } from '../text-model';
import { textPositionToIndex } from '../text-position';
import type { EditDoc, TextOverride } from '../types';
import type { ClearFormatCommand, CommandPatches } from './types';
import { inverseTextPatch, setTextPatch, textTargetContext } from './text-target';

/** 清除格式只动视觉直设；超链接、字段、公式和段落身份都由原 mark 原样保留。 */
export function clearFormatPatches(
  doc: EditDoc,
  command: ClearFormatCommand,
  origin: string,
): CommandPatches {
  assertTextRange(command.range, 'ClearFormat.range');
  const target = { id: command.id, ...(command.cell !== undefined ? { cell: command.cell } : {}) };
  const { body: source, before, patchTarget } = textTargetContext(doc, target);
  const body = before?.kind === 'flat' ? textBodyFromOverride(before) : source;
  queryTextRunProps(body, command.range, before?.kind === 'flat' ? before : undefined);
  if (textPositionToIndex(body, command.range.from) === textPositionToIndex(body, command.range.to)) {
    return { forward: [], inverse: [] };
  }
  const value: TextOverride = clearRunFormat(
    body, command.range, before?.kind === 'flat' ? before : undefined,
  );
  const baseline = before?.kind === 'flat' ? before : flattenTextBody(body);
  if (JSON.stringify(value) === JSON.stringify(baseline)) return { forward: [], inverse: [] };
  return {
    forward: [setTextPatch(patchTarget, value, origin)],
    inverse: [inverseTextPatch(patchTarget, before, origin)],
  };
}
