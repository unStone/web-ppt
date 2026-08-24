import type { Paragraph, TextBody, TextRun } from '@web-ppt/core';
import type { TextEditOp, TextPosition } from './commands/types';
import type { FlatTextParagraph, TextMark, TextOverride } from './types';
import { TEXT_ATOM, textRunEditLength } from './text-position';

const DEFAULT_RUN: Omit<TextRun, 'text'> = {
  b: false, i: false, u: false, strike: false, size: 18, color: '#000000', fonts: [],
};

function runProps(run: TextRun): Omit<TextRun, 'text'> {
  const { text: _text, ...props } = run;
  return props;
}

function paragraphProps(paragraph: Paragraph): Omit<Paragraph, 'runs'> {
  const { runs: _runs, ...props } = paragraph;
  return props;
}

export function flattenTextBody(body: TextBody): Extract<TextOverride, { kind: 'flat' }> {
  const { paragraphs: _paragraphs, ...bodyProps } = body;
  return {
    kind: 'flat',
    body: bodyProps,
    paragraphs: body.paragraphs.map((paragraph, paragraphIndex) => {
      let offset = 0;
      const marks = paragraph.runs.map((run, runIndex): TextMark => {
        const text = run.math?.length ? TEXT_ATOM : run.text;
        const from = offset;
        offset += text.length;
        return {
          from, to: offset, props: runProps(run),
          ...(run.math?.length ? { atomText: run.text } : {}),
          source: { paragraph: paragraphIndex, run: runIndex },
          preserveSource: true,
        };
      });
      return {
        text: paragraph.runs.map((run) => run.math?.length ? TEXT_ATOM : run.text).join(''),
        props: paragraphProps(paragraph), marks, sourceParagraph: paragraphIndex,
      };
    }),
  };
}

function textRun(mark: TextMark, text: string): TextRun {
  return { text: mark.atomText ?? text, ...mark.props };
}

export function textBodyFromOverride(override: Extract<TextOverride, { kind: 'flat' }>): TextBody {
  return {
    ...override.body,
    // mark 与 data-r / TextPosition 必须一一对应；同来源切片已在 normalizedParagraph 合并。
    paragraphs: override.paragraphs.map((paragraph): Paragraph => ({
      ...paragraph.props,
      runs: paragraph.marks.map((mark) => textRun(mark, paragraph.text.slice(mark.from, mark.to))),
    })),
  };
}

function sameStyle(left: TextMark, right: TextMark): boolean {
  return left.atomText === right.atomText
    && JSON.stringify(left.props) === JSON.stringify(right.props)
    && left.preserveSource === right.preserveSource
    // flat 层保留来源边界给 OOXML 保存；公开投影再合并相邻同格式普通 run。
    && JSON.stringify(left.source) === JSON.stringify(right.source);
}

interface Segment {
  text: string;
  template: TextMark;
}

function normalizedParagraph(
  source: FlatTextParagraph,
  segments: readonly Segment[],
): FlatTextParagraph {
  let text = '';
  const marks: TextMark[] = [];
  for (const segment of segments) {
    if (!segment.text && segments.length > 1) continue;
    const from = text.length;
    text += segment.text;
    const next: TextMark = { ...segment.template, from, to: text.length };
    const previous = marks[marks.length - 1];
    if (previous && previous.to === next.from && sameStyle(previous, next)
      && !previous.atomText && !next.atomText) {
      marks[marks.length - 1] = { ...previous, to: next.to };
    } else if (next.to > next.from || segments.length === 1) marks.push(next);
  }
  return { ...source, text, marks };
}

function displayLength(mark: TextMark): number {
  return mark.atomText === undefined ? mark.to - mark.from : textRunEditLength({ text: '', math: mark.props.math });
}

function positionOffset(paragraph: FlatTextParagraph, position: TextPosition): number {
  if (!Number.isInteger(position.r) || !Number.isInteger(position.off) || position.r < 0 || position.off < 0) {
    throw new Error('文字位置必须是非负整数');
  }
  if (!paragraph.marks.length && position.r === 0 && position.off === 0) return 0;
  const mark = paragraph.marks[position.r];
  if (!mark || position.off > displayLength(mark)) throw new Error('文字位置超出段落范围');
  return mark.from + position.off;
}

function assertAtomBoundary(paragraph: FlatTextParagraph, offset: number): void {
  const inside = paragraph.marks.some((mark) => mark.atomText !== undefined
    && offset > mark.from && offset < mark.to);
  if (inside) throw new Error('公式只能作为整体选择');
}

function styleAt(paragraph: FlatTextParagraph, offset: number): TextMark {
  const mark = paragraph.marks.find((candidate) => offset >= candidate.from && offset < candidate.to)
    ?? [...paragraph.marks].reverse().find((candidate) => candidate.to <= offset)
    ?? paragraph.marks[0];
  if (mark) {
    const { math: _math, ...props } = mark.props;
    return { ...mark, from: 0, to: 0, atomText: undefined, preserveSource: undefined, props };
  }
  return { from: 0, to: 0, props: DEFAULT_RUN };
}

function sliceSegments(paragraph: FlatTextParagraph, from: number, to: number): Segment[] {
  const out: Segment[] = [];
  for (const mark of paragraph.marks) {
    const start = Math.max(from, mark.from);
    const end = Math.min(to, mark.to);
    if (end <= start) continue;
    if (mark.atomText !== undefined && (start !== mark.from || end !== mark.to)) {
      throw new Error('公式只能作为整体选择');
    }
    out.push({ text: paragraph.text.slice(start, end), template: mark });
  }
  return out;
}

function replace(
  paragraphs: readonly FlatTextParagraph[],
  from: TextPosition,
  to: TextPosition,
  text: string,
  allowLineBreak = false,
): FlatTextParagraph[] {
  if (text.includes('\r') || (!allowLineBreak && text.includes('\n'))) {
    throw new Error('replace 文本不能包含换行');
  }
  if (!Number.isInteger(from.p) || !Number.isInteger(to.p)
    || from.p < 0 || to.p < from.p || to.p >= paragraphs.length) {
    throw new Error('文字选择的段落范围无效');
  }
  const first = paragraphs[from.p];
  const last = paragraphs[to.p];
  const start = positionOffset(first, from);
  const end = positionOffset(last, to);
  if (from.p === to.p && end < start) throw new Error('文字选择起点不能晚于终点');
  assertAtomBoundary(first, start);
  assertAtomBoundary(last, end);
  const segments = [
    ...sliceSegments(first, 0, start),
    ...(text ? [{ text, template: styleAt(first, start) }] : []),
    ...sliceSegments(last, end, last.text.length),
  ];
  if (!segments.length) segments.push({ text: '', template: styleAt(first, start) });
  const joined = normalizedParagraph(first, segments);
  return [...paragraphs.slice(0, from.p), joined, ...paragraphs.slice(to.p + 1)];
}

function splitParagraph(
  paragraphs: readonly FlatTextParagraph[],
  at: TextPosition,
): FlatTextParagraph[] {
  if (!Number.isInteger(at.p) || at.p < 0 || at.p >= paragraphs.length) {
    throw new Error('拆分段落位置无效');
  }
  const paragraph = paragraphs[at.p];
  const offset = positionOffset(paragraph, at);
  assertAtomBoundary(paragraph, offset);
  const empty = { text: '', template: styleAt(paragraph, offset) };
  const leftParts = sliceSegments(paragraph, 0, offset);
  const rightParts = sliceSegments(paragraph, offset, paragraph.text.length);
  const left = normalizedParagraph(paragraph, leftParts.length ? leftParts : [empty]);
  // PowerPoint 的 Enter 继承原段 pPr/endParaRPr；两段共享只读来源身份，保存时分别克隆。
  const right = normalizedParagraph(paragraph, rightParts.length ? rightParts : [empty]);
  return [...paragraphs.slice(0, at.p), left, right, ...paragraphs.slice(at.p + 1)];
}

export function applyTextEditOps(
  body: TextBody,
  ops: readonly TextEditOp[],
  initial?: Extract<TextOverride, { kind: 'flat' }>,
): TextOverride {
  let override = initial ?? flattenTextBody(body);
  for (const op of ops) {
    const paragraphs = op.type === 'replace'
      ? replace(override.paragraphs, op.from, op.to, op.text)
      : op.type === 'splitParagraph'
        ? splitParagraph(override.paragraphs, op.at)
        : replace(override.paragraphs, op.at, op.at, '\n', true);
    override = { ...override, paragraphs };
  }
  return override;
}

export function validateFlatTextOverride(
  override: Extract<TextOverride, { kind: 'flat' }>,
): void {
  if (!override.body || !Array.isArray(override.paragraphs) || !override.paragraphs.length) {
    throw new Error('扁平文本覆盖至少需要一个段落');
  }
  for (const paragraph of override.paragraphs) {
    if (typeof paragraph.text !== 'string' || !Array.isArray(paragraph.marks)) {
      throw new Error('扁平文本段落无效');
    }
    let offset = 0;
    for (const mark of paragraph.marks) {
      if (!Number.isInteger(mark.from) || !Number.isInteger(mark.to)
        || mark.from !== offset || mark.to < mark.from || mark.to > paragraph.text.length) {
        throw new Error('文字格式区间必须连续覆盖段落');
      }
      if (mark.atomText !== undefined
        && (mark.to - mark.from !== 1 || paragraph.text.slice(mark.from, mark.to) !== TEXT_ATOM)) {
        throw new Error('公式标记必须覆盖单个原子');
      }
      offset = mark.to;
    }
    if (offset !== paragraph.text.length || (!paragraph.marks.length && paragraph.text.length)) {
      throw new Error('文字格式区间没有完整覆盖段落');
    }
  }
}
