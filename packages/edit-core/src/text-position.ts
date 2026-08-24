import type { TextBody, TextRun } from '@web-ppt/core';
import type { TextPosition } from './commands/types';

/** 公式在编辑字符串里只占一个 UTF-16 位置，不能把光标落进公式树内部。 */
export const TEXT_ATOM = '\uFFFC';

export function textRunEditLength(run: Pick<TextRun, 'text' | 'math'>): number {
  return run.math?.length ? 1 : run.text.length;
}

export function textBodyEditText(body: TextBody): string {
  return body.paragraphs.map((paragraph) => paragraph.runs
    .map((run) => run.math?.length ? TEXT_ATOM : run.text).join('')).join('\n');
}

export function textPositionAtIndex(body: TextBody, index: number): TextPosition {
  let remaining = Math.max(0, index);
  for (let p = 0; p < body.paragraphs.length; p++) {
    const runs = body.paragraphs[p].runs;
    const paragraphLength = runs.reduce((sum, run) => sum + textRunEditLength(run), 0);
    if (remaining <= paragraphLength || p === body.paragraphs.length - 1) {
      let offset = Math.min(remaining, paragraphLength);
      if (!runs.length) return { p, r: 0, off: 0 };
      for (let r = 0; r < runs.length; r++) {
        const length = textRunEditLength(runs[r]);
        if (offset <= length || r === runs.length - 1) {
          return { p, r, off: Math.min(offset, length) };
        }
        offset -= length;
      }
    }
    remaining -= paragraphLength + 1;
  }
  return { p: 0, r: 0, off: 0 };
}

export function textPositionToIndex(body: TextBody, position: TextPosition): number {
  let index = 0;
  for (let p = 0; p < position.p; p++) {
    index += body.paragraphs[p].runs.reduce((sum, run) => sum + textRunEditLength(run), 0) + 1;
  }
  const paragraph = body.paragraphs[position.p];
  for (let r = 0; r < position.r; r++) index += textRunEditLength(paragraph.runs[r]);
  return index + position.off;
}
