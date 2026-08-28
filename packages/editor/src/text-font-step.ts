import {
  applyRunProps, flattenTextBody, queryRunProps, textBodyFromOverride,
  textPositionAtIndex, textPositionToIndex,
} from '@web-ppt/edit-core';
import type { Editor, RunPropertyOverrides, TextPosition } from '@web-ppt/edit-core';
import type { TextEditorContext } from './text-editor-context';
import { textTargetFields } from './text-editor-target';

const FONT_SIZE_STEPS_PT = [
  8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66,
  72, 80, 88, 96,
] as const;

function steppedFontSize(size: number, direction: -1 | 1): number {
  const points = size * 72 / 96;
  const epsilon = 1e-6;
  const next = direction > 0
    ? FONT_SIZE_STEPS_PT.find((value) => value > points + epsilon) ?? Math.min(3600, points + 8)
    : [...FONT_SIZE_STEPS_PT].reverse().find((value) => value < points - epsilon)
      ?? Math.max(1, points - 1);
  return next * 96 / 72;
}

function paragraphBaseIndex(context: TextEditorContext, paragraph: number): number {
  let index = 0;
  for (let p = 0; p < paragraph; p++) {
    index += context.text.paragraphs[p].runs.reduce((sum, run) => sum + (run.math?.length ? 1 : run.text.length), 0) + 1;
  }
  return index;
}

/** 混合字号必须逐 run 跨档，不能把整段拉平为选区首个字号。 */
export function stepMixedFontSizes(
  editor: Editor,
  context: TextEditorContext,
  direction: -1 | 1,
): boolean {
  const fromIndex = textPositionToIndex(context.text, context.positions.from);
  const toIndex = textPositionToIndex(context.text, context.positions.to);
  if (fromIndex === toIndex) return false;
  const flat = flattenTextBody(context.text);
  const segments: Array<{ from: number; to: number; size: number }> = [];
  for (let p = context.positions.from.p; p <= context.positions.to.p; p++) {
    const paragraph = flat.paragraphs[p];
    const base = paragraphBaseIndex(context, p);
    const start = Math.max(0, fromIndex - base);
    const end = Math.min(paragraph.text.length, toIndex - base);
    for (const mark of paragraph.marks) {
      const markFrom = Math.max(start, mark.from);
      const markTo = Math.min(end, mark.to);
      if (markTo <= markFrom) continue;
      segments.push({
        from: base + markFrom, to: base + markTo,
        size: steppedFontSize(mark.props.size, direction),
      });
    }
  }
  if (!segments.length) return false;
  segments.sort((left, right) => right.from - left.from);
  let predicted = flat;
  let predictedBody = context.text;
  const commands = segments.map((segment) => {
    const range = {
      from: textPositionAtIndex(predictedBody, segment.from),
      to: textPositionAtIndex(predictedBody, segment.to),
    };
    const next = applyRunProps(predictedBody, range, { size: segment.size }, predicted);
    if (next.kind !== 'flat') throw new Error('字号步进必须保持非空文字覆盖');
    predicted = next;
    predictedBody = textBodyFromOverride(next);
    return { range, size: segment.size };
  });
  const finalRange = {
    from: textPositionAtIndex(predictedBody, fromIndex),
    to: textPositionAtIndex(predictedBody, toIndex),
  };
  editor.transaction((transaction) => {
    for (const command of commands) {
      transaction.exec({
        type: 'SetRunProps', id: context.id, ...textTargetFields(context.cell),
        range: command.range, props: { size: command.size },
      });
    }
    transaction.select({
      kind: 'text', id: context.id, ...textTargetFields(context.cell),
      anchor: finalRange.from, focus: finalRange.to,
    });
  }, direction > 0 ? '增大字号' : '减小字号');
  return true;
}

export function stepSelectedFontSize(
  editor: Editor,
  context: TextEditorContext | null,
  direction: -1 | 1,
  setUniform: (props: RunPropertyOverrides) => boolean,
  restoreMixed: (from: TextPosition, to: TextPosition) => void,
): boolean {
  if (!context) return false;
  const state = queryRunProps(editor.doc, context.id, context.positions, context.cell ?? undefined).size;
  if (!state.mixed) {
    return typeof state.value === 'number'
      && setUniform({ size: steppedFontSize(state.value, direction) });
  }
  const handled = stepMixedFontSizes(editor, context, direction);
  if (handled) {
    const selection = editor.selection;
    if (selection.kind === 'text') restoreMixed(selection.anchor, selection.focus);
  }
  return handled;
}
