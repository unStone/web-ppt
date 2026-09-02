import {
  applyRunProps, applyTextEditOps, clearRunFormat, tableCellOverrideKey,
  textBodyFromOverride, textPositionAtIndex,
} from '@web-ppt/edit-core';
import type {
  Editor, RunPropertyOverrides, Selection, TextEditOp, TextPosition,
} from '@web-ppt/edit-core';
import type { ActiveText } from './text-editor-types';
import { textTargetFields } from './text-editor-target';

export interface PendingTextFormat {
  readonly props: RunPropertyOverrides;
  readonly clearSource: boolean;
}

/** 先按 flat mark 身份预测插入范围，再把输入、清除与待输入格式合成一个历史事务。 */
export function commitTextInput(
  editor: Editor,
  active: ActiveText,
  ops: readonly TextEditOp[],
  nextIndex: number,
  label: string,
  insertedFrom: number | null,
  pending: PendingTextFormat,
): TextPosition | null {
  const { id, cell, text } = active;
  const record = editor.doc.elements[id];
  const currentOverride = cell
    ? record.ovr.tableCells?.[tableCellOverrideKey(record, cell)]?.text
    : record.ovr.text;
  const predicted = applyTextEditOps(
    text, ops, currentOverride?.kind === 'flat' ? currentOverride : undefined,
  );
  if (predicted.kind !== 'flat') return null;
  const predictedBody = textBodyFromOverride(predicted);
  const formatRange = insertedFrom !== null && nextIndex > insertedFrom
    && (pending.clearSource || Object.keys(pending.props).length)
    ? {
      from: textPositionAtIndex(predictedBody, insertedFrom),
      to: textPositionAtIndex(predictedBody, nextIndex),
    } : null;
  const cleared = formatRange && pending.clearSource
    ? clearRunFormat(predictedBody, formatRange, predicted) : predicted;
  if (cleared.kind !== 'flat') return null;
  const formatted = formatRange && Object.keys(pending.props).length
    ? applyRunProps(predictedBody, formatRange, pending.props, cleared) : cleared;
  if (formatted.kind !== 'flat') return null;
  const caret = textPositionAtIndex(textBodyFromOverride(formatted), nextIndex);
  const selection: Selection = {
    kind: 'text', id, ...textTargetFields(cell ?? null), anchor: caret, focus: caret,
  };
  editor.transaction((transaction) => {
    transaction.exec({ type: 'EditText', id, ...textTargetFields(cell ?? null), ops });
    if (formatRange && pending.clearSource) {
      transaction.exec({
        type: 'ClearFormat', id, ...textTargetFields(cell ?? null), range: formatRange,
      });
    }
    if (formatRange && Object.keys(pending.props).length) {
      transaction.exec({
        type: 'SetRunProps', id, ...textTargetFields(cell ?? null),
        range: formatRange, props: pending.props,
      });
    }
    transaction.select(selection);
  }, label, label === '文字输入'
    ? { mergeKey: `text:${id}${cell ? `:${cell.r}:${cell.c}` : ''}` }
    : {});
  return caret;
}
