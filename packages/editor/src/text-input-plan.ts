import type { TextBody } from '@web-ppt/core';
import {
  applyTextEditOps, textBodyEditText, textBodyFromOverride, textPositionAtIndex,
  textPositionToIndex,
} from '@web-ppt/edit-core';
import type { TextEditOp, TextPosition } from '@web-ppt/edit-core';

export type TextInputPlan = {
  readonly type: 'format';
  readonly field: 'b' | 'i' | 'u';
} | {
  readonly type: 'history';
  readonly direction: 'undo' | 'redo';
} | {
  readonly type: 'edit';
  readonly ops: readonly TextEditOp[];
  readonly nextIndex: number;
  readonly insertedFrom: number | null;
  readonly label: string;
};

/** beforeinput 只描述意图；这里把浏览器事件归一成无 DOM 的模型操作计划。 */
export function planTextInput(
  text: TextBody,
  positions: { readonly from: TextPosition; readonly to: TextPosition },
  inputType: string,
  data: string | null,
): TextInputPlan | null {
  const formatField = ({
    formatBold: 'b', formatItalic: 'i', formatUnderline: 'u',
  } as const)[inputType as 'formatBold' | 'formatItalic' | 'formatUnderline'];
  if (formatField) return { type: 'format', field: formatField };
  if (inputType === 'historyUndo') return { type: 'history', direction: 'undo' };
  if (inputType === 'historyRedo') return { type: 'history', direction: 'redo' };

  let fromIndex = textPositionToIndex(text, positions.from);
  let toIndex = textPositionToIndex(text, positions.to);
  let ops: TextEditOp[] = [];
  let nextIndex = fromIndex;
  let insertedFrom: number | null = null;
  let label = '文字输入';
  if (inputType === 'insertText') {
    const inserted = data ?? '';
    ops = [{ type: 'replace', ...positions, text: inserted }];
    insertedFrom = fromIndex;
    nextIndex += inserted.length;
  } else if (inputType === 'deleteContentBackward') {
    if (fromIndex === toIndex) fromIndex = Math.max(0, fromIndex - 1);
    ops = [{ type: 'replace', from: textPositionAtIndex(text, fromIndex), to: positions.to, text: '' }];
    nextIndex = fromIndex;
  } else if (inputType === 'deleteContentForward') {
    if (fromIndex === toIndex) toIndex = Math.min(textBodyEditText(text).length, toIndex + 1);
    ops = [{ type: 'replace', from: positions.from, to: textPositionAtIndex(text, toIndex), text: '' }];
  } else if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
    label = inputType === 'insertParagraph' ? '新建段落' : '插入换行';
    let at = positions.from;
    if (fromIndex !== toIndex) {
      const remove: TextEditOp = { type: 'replace', ...positions, text: '' };
      const interim = applyTextEditOps(text, [remove]);
      if (interim.kind !== 'flat') return null;
      at = textPositionAtIndex(textBodyFromOverride(interim), fromIndex);
      ops.push(remove);
    }
    ops.push(inputType === 'insertParagraph'
      ? { type: 'splitParagraph', at }
      : { type: 'insertLineBreak', at });
    nextIndex++;
  } else return null;
  return { type: 'edit', ops, nextIndex, insertedFrom, label };
}
