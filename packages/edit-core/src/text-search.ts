import type { TextBody, TextRun } from '@web-ppt/core';
import { assertDataArray, assertDataObject, own } from './data-validation';
import { effectiveElement } from './projection';
import { TEXT_ATOM, textPositionAtIndex, textRunEditLength } from './text-position';
import type { EditDoc, ElementId, SlideId, TableCellAddress } from './types';
import type { FindTextRequest, TextSearchMatch, TextSearchScope } from './text-search-types';

const WORD = /[\p{L}\p{M}\p{N}_]/u;

interface MatchOffset { readonly from: number; readonly to: number }

function assertScope(doc: EditDoc, value: unknown): asserts value is TextSearchScope {
  if ((value as TextSearchScope | null)?.kind === 'document') {
    assertDataObject(value, ['kind'], 'FindText.scope');
    return;
  }
  if ((value as TextSearchScope | null)?.kind === 'slide') {
    assertDataObject(value, ['kind', 'slideId'], 'FindText.scope');
    const id = (value as Extract<TextSearchScope, { kind: 'slide' }>).slideId;
    if (typeof id !== 'string' || !doc.slides[id]) throw new Error(`FindText.scope 页面不存在：${String(id)}`);
    return;
  }
  if ((value as TextSearchScope | null)?.kind === 'slides') {
    assertDataObject(value, ['kind', 'slideIds'], 'FindText.scope');
    const ids = (value as Extract<TextSearchScope, { kind: 'slides' }>).slideIds;
    assertDataArray(ids, 'FindText.scope.slideIds');
    if (!ids.length) throw new Error('FindText.scope.slideIds 不能为空');
    const seen = new Set<string>();
    for (const id of ids) {
      if (typeof id !== 'string' || !doc.slides[id]) throw new Error(`FindText.scope 页面不存在：${String(id)}`);
      if (seen.has(id)) throw new Error(`FindText.scope 页面重复：${id}`);
      seen.add(id);
    }
    return;
  }
  throw new Error('FindText.scope.kind 无效');
}

export function assertFindTextRequest(
  doc: EditDoc,
  value: unknown,
): asserts value is FindTextRequest {
  assertDataObject(value, ['query', 'scope', 'matchCase', 'wholeWord'], 'FindText');
  const request = value as FindTextRequest;
  if (typeof request.query !== 'string' || !request.query.length
    || request.query.includes('\r') || request.query.includes('\n') || request.query.includes(TEXT_ATOM)) {
    throw new Error('FindText.query 必须是不含换行与公式占位符的非空字符串');
  }
  assertScope(doc, request.scope);
  if (own(request, 'matchCase') && typeof request.matchCase !== 'boolean') {
    throw new Error('FindText.matchCase 必须是布尔值');
  }
  if (own(request, 'wholeWord') && typeof request.wholeWord !== 'boolean') {
    throw new Error('FindText.wholeWord 必须是布尔值');
  }
}

function scopedSlides(doc: EditDoc, scope: TextSearchScope): SlideId[] {
  if (scope.kind === 'document') return [...doc.slideOrder];
  if (scope.kind === 'slide') return [scope.slideId];
  const included = new Set(scope.slideIds);
  return doc.slideOrder.filter((id) => included.has(id));
}

function previousCodePoint(text: string, index: number): string {
  const points = [...text.slice(0, index)];
  return points[points.length - 1] ?? '';
}

function nextCodePoint(text: string, index: number): string {
  return String.fromCodePoint(text.codePointAt(index) ?? 0);
}

function isWholeWord(text: string, from: number, to: number): boolean {
  return !WORD.test(previousCodePoint(text, from)) && !WORD.test(nextCodePoint(text, to));
}

interface FoldedText {
  readonly text: string;
  readonly boundaries: ReadonlyMap<number, number>;
}

/** 默认 Unicode 小写可能扩展字符；边界映射避免折叠后的偏移污染 UTF-16 选区。 */
function foldText(value: string): FoldedText {
  const text = value.toLowerCase();
  let folded = 0;
  let original = 0;
  const boundaries = new Map<number, number>([[0, 0]]);
  for (const char of value) {
    // 整串折叠才能保留希腊 final sigma 等上下文规则；逐码点只用于恢复等长边界。
    folded += char.toLowerCase().length;
    original += char.length;
    boundaries.set(folded, original);
  }
  return { text, boundaries };
}

function literalOffsets(text: string, query: string, matchCase: boolean): MatchOffset[] {
  const haystack = matchCase ? { text, boundaries: null } : foldText(text);
  const needle = matchCase ? query : foldText(query).text;
  const offsets: MatchOffset[] = [];
  let cursor = 0;
  for (;;) {
    const found = haystack.text.indexOf(needle, cursor);
    if (found < 0) return offsets;
    const foldedTo = found + needle.length;
    const from = haystack.boundaries?.get(found) ?? found;
    const to = haystack.boundaries?.get(foldedTo) ?? foldedTo;
    if (from !== undefined && to !== undefined) offsets.push({ from, to });
    cursor = Math.max(found + needle.length, found + 1);
  }
}

function protectedIntervals(runs: readonly TextRun[]): MatchOffset[] {
  const intervals: MatchOffset[] = [];
  let offset = 0;
  for (const run of runs) {
    const length = textRunEditLength(run);
    if (run.field || run.math?.length) intervals.push({ from: offset, to: offset + length });
    offset += length;
  }
  return intervals;
}

function matchKey(
  slideId: SlideId,
  id: ElementId,
  cell: TableCellAddress | undefined,
  from: TextSearchMatch['range']['from'],
  to: TextSearchMatch['range']['to'],
): string {
  return [slideId, id, cell ? `${cell.r}:${cell.c}` : '',
    `${from.p}:${from.r}:${from.off}`, `${to.p}:${to.r}:${to.off}`].join('\u0000');
}

function bodyMatches(
  slideId: SlideId,
  id: ElementId,
  body: TextBody,
  request: FindTextRequest,
  cell?: TableCellAddress,
): TextSearchMatch[] {
  const matches: TextSearchMatch[] = [];
  let bodyOffset = 0;
  for (let paragraphIndex = 0; paragraphIndex < body.paragraphs.length; paragraphIndex++) {
    const paragraph = body.paragraphs[paragraphIndex];
    const text = paragraph.runs.map((run) => run.math?.length ? TEXT_ATOM : run.text).join('');
    const protectedRanges = protectedIntervals(paragraph.runs);
    for (const offset of literalOffsets(text, request.query, request.matchCase === true)) {
      if (protectedRanges.some((range) => offset.from < range.to && offset.to > range.from)
        || (request.wholeWord && !isWholeWord(text, offset.from, offset.to))) continue;
      const from = textPositionAtIndex(body, bodyOffset + offset.from);
      const to = textPositionAtIndex(body, bodyOffset + offset.to);
      matches.push({
        key: matchKey(slideId, id, cell, from, to), slideId, id,
        ...(cell ? { cell: { ...cell } } : {}), range: { from, to },
        text: text.slice(offset.from, offset.to),
        before: text.slice(Math.max(0, offset.from - 24), offset.from),
        after: text.slice(offset.to, offset.to + 24),
      });
    }
    bodyOffset += text.length + (paragraphIndex < body.paragraphs.length - 1 ? 1 : 0);
  }
  return matches;
}

function elementMatches(
  doc: EditDoc,
  slideId: SlideId,
  id: ElementId,
  request: FindTextRequest,
): TextSearchMatch[] {
  const element = effectiveElement(doc, id);
  if (element.kind === 'shape') {
    return element.text ? bodyMatches(slideId, id, element.text, request) : [];
  }
  if (element.kind !== 'table') return [];
  return element.rows.flatMap((row, r) => row.cells.flatMap((cell, c) =>
    !cell.merged && cell.text ? bodyMatches(slideId, id, cell.text, request, { r, c }) : []));
}

function walkMatches(
  doc: EditDoc,
  slideId: SlideId,
  ids: readonly ElementId[],
  request: FindTextRequest,
): TextSearchMatch[] {
  return ids.flatMap((id) => {
    const record = doc.elements[id];
    if (!record) throw new Error(`页面 ${slideId} 引用了不存在的元素：${id}`);
    // 隐藏组的后代会继承 visibility:hidden，不能把画布上不可见的文字暴露给搜索。
    if (record.meta.hiddenByUser) return [];
    return [
      ...elementMatches(doc, slideId, id, request),
      ...(record.children ? walkMatches(doc, slideId, record.children, request) : []),
    ];
  });
}

/** 无 DOM、无索引副作用；需要增量缓存的宿主可在此公开结果之上按脏页维护。 */
export function findText(doc: EditDoc, request: FindTextRequest): readonly TextSearchMatch[] {
  assertFindTextRequest(doc, request);
  return scopedSlides(doc, request.scope).flatMap((slideId) =>
    walkMatches(doc, slideId, doc.slides[slideId].children, request));
}
