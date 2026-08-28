import type { Editor, Selection } from '@web-ppt/edit-core';
import type { TextEditorContext } from './text-editor-context';

/** 多段选区逐段保留相对级别，并合并为一次历史事务。 */
export function changeTextListLevel(
  editor: Editor,
  context: TextEditorContext | null,
  delta: -1 | 1,
): boolean {
  if (!context || context.cell) return false;
  const changes: Array<{ readonly p: number; readonly level: number }> = [];
  for (let p = context.positions.from.p; p <= context.positions.to.p; p++) {
    const level = context.text.paragraphs[p]?.lvl;
    if (level === undefined) continue;
    const next = level + delta;
    if (next >= 0 && next <= 8) changes.push({ p, level: next });
  }
  if (!changes.length) return false;
  const selection: Selection = {
    kind: 'text', id: context.id,
    anchor: context.positions.from, focus: context.positions.to,
  };
  editor.transaction((transaction) => {
    for (const change of changes) {
      const caret = { p: change.p, r: 0, off: 0 };
      transaction.exec({
        type: 'SetParaProps', id: context.id,
        range: { from: caret, to: caret }, props: { level: change.level },
      });
    }
    transaction.select(selection);
  }, delta > 0 ? '提升列表级别' : '降低列表级别');
  return true;
}
