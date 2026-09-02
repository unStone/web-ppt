import type { TextBody } from '@web-ppt/core';
import type { TextRange } from './commands/types';
import type { TextFragment } from './types';
import { flattenTextBody, sourceParagraphBullet } from './text-flatten';
import { assertTextAtomBoundary, textPositionOffset } from './text-selection';
import { NO_HIGHLIGHT } from './run-style';

/** 把有效文字选区降成可跨实例传输的格式白名单，不泄漏 OOXML 来源身份。 */
export function textFragmentFromRange(body: TextBody, range: TextRange): TextFragment {
  const paragraphs = flattenTextBody(body).paragraphs;
  if (range.from.p < 0 || range.to.p < range.from.p || range.to.p >= paragraphs.length) {
    throw new Error('文字片段选区段落范围无效');
  }
  const from = textPositionOffset(paragraphs[range.from.p], range.from);
  const to = textPositionOffset(paragraphs[range.to.p], range.to);
  if (range.from.p === range.to.p && to < from) throw new Error('文字片段选区起点不能晚于终点');
  return {
    paragraphs: paragraphs.slice(range.from.p, range.to.p + 1).map((paragraph, relativeIndex) => {
      const index = range.from.p + relativeIndex;
      const start = index === range.from.p ? from : 0;
      const end = index === range.to.p ? to : paragraph.text.length;
      assertTextAtomBoundary(paragraph, start);
      assertTextAtomBoundary(paragraph, end);
      let text = '';
      const marks: TextFragment['paragraphs'][number]['marks'][number][] = [];
      for (const mark of paragraph.marks) {
        const selectedFrom = Math.max(start, mark.from);
        const selectedTo = Math.min(end, mark.to);
        if (selectedTo <= selectedFrom) continue;
        const value = mark.atomText ?? paragraph.text.slice(selectedFrom, selectedTo);
        const markFrom = text.length;
        text += value;
        const font = mark.props.fonts[0];
        marks.push({
          from: markFrom, to: text.length,
          props: {
            ...(font ? { font } : {}), size: mark.props.size, color: mark.props.color,
            b: mark.props.b, i: mark.props.i,
            underline: mark.props.underline ?? (mark.props.u ? 'sng' : 'none'),
            strikeType: mark.props.strikeType ?? (mark.props.strike ? 'sngStrike' : 'noStrike'),
            highlight: mark.props.highlight ?? NO_HIGHLIGHT, spacing: mark.props.spacing ?? 0,
            caps: mark.props.caps ?? 'none', baseline: mark.props.baseline ?? 0,
          },
        });
      }
      const bullet = start === 0 && end === paragraph.text.length
        ? sourceParagraphBullet(body.paragraphs[index].editInfo?.bullet) : undefined;
      return { text, marks, ...(bullet ? { bullet } : {}) };
    }),
  };
}
