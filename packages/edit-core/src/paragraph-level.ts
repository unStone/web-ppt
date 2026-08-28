import {
  formatDrawingAutoNumber, PARAGRAPH_LAYOUT_DIRECT_BITS, TEXT_RUN_DIRECT_BITS,
} from '@web-ppt/core';
import type { Paragraph, TextBody, TextRun } from '@web-ppt/core';
import type {
  FlatTextParagraph, ParagraphProperties, ParagraphPropertyOverrides, RunProperties, TextMark,
  TextOverride,
} from './types';
import type { TextRange } from './commands/types';

const own = (value: object | undefined, field: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value ?? {}, field);

function sourceParagraph(
  body: TextBody,
  paragraph: FlatTextParagraph,
  index: number,
): Paragraph | undefined {
  return body.paragraphs[paragraph.sourceParagraph ?? index];
}

function levelParagraph(template: TextBody | undefined, level: number): Paragraph | undefined {
  return template?.paragraphs.find((paragraph) => paragraph.lvl === level)
    ?? template?.paragraphs[0];
}

function paragraphDirect(
  paragraph: FlatTextParagraph,
  field: keyof ParagraphProperties,
): boolean {
  if (own(paragraph.paragraphOverrides, field)) return paragraph.paragraphOverrides?.[field] !== null;
  return paragraph.directParagraphProps?.[field] === true;
}

function runProperties(run: TextRun): RunProperties {
  return {
    font: run.fonts[0] ?? null,
    size: run.size,
    color: run.color,
    b: run.b,
    i: run.i,
    u: run.u,
    strike: run.strike,
  };
}

function sourceRun(
  body: TextBody,
  paragraph: FlatTextParagraph,
  paragraphIndex: number,
  mark: TextMark,
): { paragraph: Paragraph | undefined; run: TextRun | undefined } {
  const source = body.paragraphs[mark.source?.paragraph
    ?? paragraph.sourceParagraph ?? paragraphIndex];
  return { paragraph: source, run: source?.runs[mark.source?.run ?? 0] };
}

function runDirect(
  mark: TextMark,
  source: ReturnType<typeof sourceRun>,
  field: keyof RunProperties,
): boolean {
  if (own(mark.runOverrides, field)) return mark.runOverrides?.[field] !== null;
  const bits = (source.paragraph?.editInfo?.directRun ?? 0) | (source.run?.editInfo?.direct ?? 0);
  if (field === 'font') {
    return !!(bits & (TEXT_RUN_DIRECT_BITS.fonts
      | TEXT_RUN_DIRECT_BITS.fontLatin
      | TEXT_RUN_DIRECT_BITS.fontEastAsian
      | TEXT_RUN_DIRECT_BITS.fontComplexScript));
  }
  return !!(bits & TEXT_RUN_DIRECT_BITS[field]);
}

function rebasedMark(
  body: TextBody,
  paragraph: FlatTextParagraph,
  paragraphIndex: number,
  mark: TextMark,
  target: TextRun,
): TextMark {
  const source = sourceRun(body, paragraph, paragraphIndex, mark);
  const props = { ...mark.props };
  if (!runDirect(mark, source, 'font')) props.fonts = [...target.fonts];
  for (const field of ['size', 'color', 'b', 'i', 'u', 'strike'] as const) {
    if (!runDirect(mark, source, field)) props[field] = target[field] as never;
  }
  return {
    ...mark,
    props,
    inheritedProps: runProperties(target),
    inheritedFonts: [...target.fonts],
  };
}

function inheritedProperties(target: Paragraph): ParagraphProperties {
  const inherited = target.editInfo?.inheritedParagraphProps;
  return inherited ? { ...inherited } : {
    level: 0,
    align: target.align,
    lineHeight: target.lineHeight,
    spaceBefore: target.spaceBefore,
    spaceAfter: target.spaceAfter,
    marginLeft: target.marL,
    indent: target.indent,
  };
}

/** 改级只重基未直设字段；pPr/rPr 的来源直设与用户覆盖继续压过列表样式。 */
export function rebaseParagraphLevel(
  body: TextBody,
  paragraph: FlatTextParagraph,
  paragraphIndex: number,
  level: number,
  template: TextBody | undefined,
): FlatTextParagraph {
  if (paragraph.props.lvl === level) return paragraph;
  const target = levelParagraph(template, level) ?? levelParagraph(body, level);
  if (!target) return { ...paragraph, props: { ...paragraph.props, lvl: level } };
  const source = sourceParagraph(body, paragraph, paragraphIndex);
  const props = { ...paragraph.props, lvl: level };
  const fields = [
    ['align', 'align'], ['lineHeight', 'lineHeight'], ['spaceBefore', 'spaceBefore'],
    ['spaceAfter', 'spaceAfter'], ['marginLeft', 'marL'], ['indent', 'indent'],
  ] as const;
  for (const [field, targetField] of fields) {
    if (!paragraphDirect(paragraph, field)) props[targetField] = target[targetField] as never;
  }
  const directLayout = source?.editInfo?.directLayout ?? 0;
  const layouts = [
    ['bulletColor', PARAGRAPH_LAYOUT_DIRECT_BITS.bulletColor],
    ['bulletFont', PARAGRAPH_LAYOUT_DIRECT_BITS.bulletFont],
    ['bulletSize', PARAGRAPH_LAYOUT_DIRECT_BITS.bulletSize],
    ['rtl', PARAGRAPH_LAYOUT_DIRECT_BITS.rtl],
  ] as const;
  if (!(directLayout & PARAGRAPH_LAYOUT_DIRECT_BITS.bullet)) {
    props.bullet = target.bullet;
    if (target.bulletImage === undefined) delete props.bulletImage;
    else props.bulletImage = target.bulletImage;
  }
  for (const [field, bit] of layouts) {
    if (directLayout & bit) continue;
    const value = target[field];
    if (value === undefined) delete props[field];
    else props[field] = value as never;
  }
  const targetRun = target.runs[target.runs.length - 1];
  return {
    ...paragraph,
    props,
    inheritedParagraphProps: inheritedProperties(target),
    marks: targetRun
      ? paragraph.marks.map((mark) => rebasedMark(body, paragraph, paragraphIndex, mark, targetRun))
      : paragraph.marks,
  };
}

function autoNumbering(
  body: TextBody,
  paragraph: FlatTextParagraph,
  index: number,
  template: TextBody | undefined,
): { readonly scheme: string; readonly startAt: number } | undefined {
  const source = sourceParagraph(body, paragraph, index);
  if (source?.editInfo && source.editInfo.directLayout & PARAGRAPH_LAYOUT_DIRECT_BITS.bullet) {
    return source.editInfo.autoNumbering;
  }
  const templateParagraph = template?.paragraphs.find((candidate) =>
    candidate.lvl === paragraph.props.lvl);
  if (templateParagraph) return templateParagraph.editInfo?.autoNumbering;
  return body.paragraphs.find((candidate) => candidate.lvl === paragraph.props.lvl)
    ?.editInfo?.autoNumbering;
}

/** 改动中段级别会改变后续同级编号，必须在整段序列上重新计数。 */
export function renumberParagraphs(
  body: TextBody,
  paragraphs: readonly FlatTextParagraph[],
  template: TextBody | undefined,
): FlatTextParagraph[] {
  const counters: number[] = [];
  return paragraphs.map((paragraph, index) => {
    const numbering = autoNumbering(body, paragraph, index, template);
    if (!numbering) return paragraph;
    const level = paragraph.props.lvl;
    counters.length = level + 1;
    counters[level] = (counters[level] ?? numbering.startAt - 1) + 1;
    return {
      ...paragraph,
      props: {
        ...paragraph.props,
        bullet: formatDrawingAutoNumber(numbering.scheme, counters[level]),
      },
    };
  });
}

/** 段落覆盖与列表重基必须一次生成，避免派生布局和稀疏覆盖出现中间态。 */
export function applyParagraphPropertyOverrides(
  sourceBody: TextBody,
  override: Extract<TextOverride, { kind: 'flat' }>,
  range: TextRange,
  changes: ParagraphPropertyOverrides,
  levelTemplate?: TextBody,
): TextOverride {
  const has = (field: keyof ParagraphPropertyOverrides): boolean =>
    Object.prototype.hasOwnProperty.call(changes, field);
  const current = (paragraph: FlatTextParagraph): ParagraphProperties => ({
    level: paragraph.props.lvl, align: paragraph.props.align, lineHeight: paragraph.props.lineHeight,
    spaceBefore: paragraph.props.spaceBefore, spaceAfter: paragraph.props.spaceAfter,
    marginLeft: paragraph.props.marL, indent: paragraph.props.indent,
  });
  const formatted = (paragraph: FlatTextParagraph): ParagraphProperties => {
    const before = current(paragraph);
    const inherited = paragraph.inheritedParagraphProps ?? before;
    return {
      level: has('level') ? changes.level ?? inherited.level : before.level,
      align: has('align') ? changes.align ?? inherited.align : before.align,
      lineHeight: has('lineHeight') ? changes.lineHeight ?? inherited.lineHeight : before.lineHeight,
      spaceBefore: has('spaceBefore')
        ? changes.spaceBefore ?? inherited.spaceBefore : before.spaceBefore,
      spaceAfter: has('spaceAfter')
        ? changes.spaceAfter ?? inherited.spaceAfter : before.spaceAfter,
      marginLeft: has('marginLeft')
        ? changes.marginLeft ?? inherited.marginLeft : before.marginLeft,
      indent: has('indent') ? changes.indent ?? inherited.indent : before.indent,
    };
  };
  const sparseOverrides = (
    paragraph: FlatTextParagraph,
    original: FlatTextParagraph,
  ): ParagraphPropertyOverrides => {
    const next: Record<string, ParagraphPropertyOverrides[keyof ParagraphPropertyOverrides]> = {
      ...paragraph.paragraphOverrides,
    };
    const before = current(original);
    for (const field of Object.keys(changes) as (keyof ParagraphPropertyOverrides)[]) {
      if (Object.is(changes[field], before[field])) continue;
      if (changes[field] === null && !paragraph.directParagraphProps?.[field]) delete next[field];
      else next[field] = changes[field];
    }
    return next;
  };
  let paragraphs = override.paragraphs.map((paragraph, index) => {
    if (index < range.from.p || index > range.to.p) return paragraph;
    const rebased = has('level')
      ? rebaseParagraphLevel(
        sourceBody, paragraph, index,
        changes.level ?? paragraph.inheritedParagraphProps?.level ?? 0,
        levelTemplate,
      )
      : paragraph;
    const next = formatted(rebased);
    const nextOverrides = sparseOverrides(rebased, paragraph);
    const { paragraphOverrides: _previous, ...base } = rebased;
    return {
      ...base,
      props: {
        ...rebased.props,
        lvl: next.level,
        align: next.align, lineHeight: next.lineHeight,
        spaceBefore: next.spaceBefore, spaceAfter: next.spaceAfter,
        marL: next.marginLeft, indent: next.indent,
      },
      ...(Object.keys(nextOverrides).length ? { paragraphOverrides: nextOverrides } : {}),
    };
  });
  if (has('level')) paragraphs = renumberParagraphs(sourceBody, paragraphs, levelTemplate);
  return { ...override, paragraphs };
}
