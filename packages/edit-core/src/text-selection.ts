import type { TextPosition } from './commands/types';
import type { FlatTextParagraph, TextMark } from './types';
import { textRunEditLength } from './text-position';

function displayLength(mark: TextMark): number {
  return mark.atomText === undefined
    ? mark.to - mark.from : textRunEditLength({ text: '', math: mark.props.math });
}

export function textPositionOffset(
  paragraph: FlatTextParagraph,
  position: TextPosition,
): number {
  if (!Number.isInteger(position.r) || !Number.isInteger(position.off)
    || position.r < 0 || position.off < 0) {
    throw new Error('文字位置必须是非负整数');
  }
  if (!paragraph.marks.length && position.r === 0 && position.off === 0) return 0;
  const mark = paragraph.marks[position.r];
  if (!mark || position.off > displayLength(mark)) throw new Error('文字位置超出段落范围');
  return mark.from + position.off;
}

export function assertTextAtomBoundary(paragraph: FlatTextParagraph, offset: number): void {
  const inside = paragraph.marks.some((mark) => mark.atomText !== undefined
    && offset > mark.from && offset < mark.to);
  if (inside) throw new Error('公式只能作为整体选择');
}
