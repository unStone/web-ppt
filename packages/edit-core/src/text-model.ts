import { formatDrawingAutoNumber } from '@web-ppt/core';
import type { TextBody, TextRun } from '@web-ppt/core';
import type { TextEditOp, TextPosition, TextRange } from './commands/types';
import type {
  FlatTextParagraph, ParagraphPropertiesState, ParagraphPropertyOverrides, RunProperties,
  RunPropertiesState, RunPropertyOverrides, RunPropertyState, TextFragment, TextMark, TextOverride,
} from './types';
import { applyParagraphPropertyOverrides } from './paragraph-level';
import { flattenTextBody } from './text-flatten';
import { assertTextAtomBoundary, textPositionOffset } from './text-selection';

export { textBodyFromOverride } from './text-override-projection';
export { flattenTextBody } from './text-flatten';
export { textFragmentFromRange } from './text-fragment';

const DEFAULT_RUN: Omit<TextRun, 'text'> = {
  b: false, i: false, u: false, strike: false, size: 18, color: '#000000', fonts: [],
};

const DEFAULT_PROPERTIES: RunProperties = {
  font: null, size: DEFAULT_RUN.size, color: DEFAULT_RUN.color, b: DEFAULT_RUN.b, i: DEFAULT_RUN.i,
  u: DEFAULT_RUN.u, strike: DEFAULT_RUN.strike,
};

const STYLE_PROPERTY_FIELDS = ['font', 'size', 'color', 'b', 'i', 'u', 'strike'] as const;
const RUN_OVERRIDE_FIELDS = [...STYLE_PROPERTY_FIELDS, 'link'] as const;

function sameRunOverrides(left?: RunPropertyOverrides, right?: RunPropertyOverrides): boolean {
  return RUN_OVERRIDE_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(left ?? {}, field)
    === Object.prototype.hasOwnProperty.call(right ?? {}, field)
    && Object.is(left?.[field], right?.[field]));
}

function sameInherited(left?: RunProperties, right?: RunProperties): boolean {
  return STYLE_PROPERTY_FIELDS.every((field) => Object.is(left?.[field], right?.[field]));
}

function sameStyle(left: TextMark, right: TextMark): boolean {
  return left.atomText === right.atomText
    && JSON.stringify(left.props) === JSON.stringify(right.props)
    && left.preserveSource === right.preserveSource
    && sameRunOverrides(left.runOverrides, right.runOverrides)
    && sameInherited(left.inheritedProps, right.inheritedProps)
    && JSON.stringify(left.inheritedRunProps) === JSON.stringify(right.inheritedRunProps)
    && JSON.stringify(left.inheritedFonts) === JSON.stringify(right.inheritedFonts)
    && JSON.stringify(left.inheritedFontSlots) === JSON.stringify(right.inheritedFontSlots)
    && left.sourceLinkReadonly === right.sourceLinkReadonly
    // 不跨来源合并字段/超链接身份；同一来源被区间操作切开的片段仍会归一。
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
  const normalizedSegments = segments.flatMap((segment): Segment[] => {
    if (!segment.text.includes('\n')) return [segment];
    const parts: Segment[] = [];
    let start = 0;
    for (let index = 0; index < segment.text.length; index++) {
      if (segment.text[index] !== '\n') continue;
      if (index > start) parts.push({ text: segment.text.slice(start, index), template: segment.template });
      parts.push({ text: '\n', template: segment.template });
      start = index + 1;
    }
    if (start < segment.text.length) parts.push({ text: segment.text.slice(start), template: segment.template });
    return parts;
  });
  for (const segment of normalizedSegments) {
    if (!segment.text && segments.length > 1) continue;
    const from = text.length;
    text += segment.text;
    const next: TextMark = { ...segment.template, from, to: text.length };
    const previous = marks[marks.length - 1];
    if (previous && previous.to === next.from && sameStyle(previous, next)
      && !previous.atomText && !next.atomText && segment.text !== '\n'
      && text.slice(previous.from, previous.to) !== '\n') {
      marks[marks.length - 1] = { ...previous, to: next.to };
    } else if (next.to > next.from || segments.length === 1) marks.push(next);
  }
  return { ...source, text, marks };
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
  const start = textPositionOffset(first, from);
  const end = textPositionOffset(last, to);
  if (from.p === to.p && end < start) throw new Error('文字选择起点不能晚于终点');
  assertTextAtomBoundary(first, start);
  assertTextAtomBoundary(last, end);
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
  const offset = textPositionOffset(paragraph, at);
  assertTextAtomBoundary(paragraph, offset);
  const empty = { text: '', template: styleAt(paragraph, offset) };
  const leftParts = sliceSegments(paragraph, 0, offset);
  const rightParts = sliceSegments(paragraph, offset, paragraph.text.length);
  const left = normalizedParagraph(paragraph, leftParts.length ? leftParts : [empty]);
  // PowerPoint 的 Enter 继承原段 pPr/endParaRPr；两段共享只读来源身份，保存时分别克隆。
  const right = normalizedParagraph(paragraph, rightParts.length ? rightParts : [empty]);
  return [...paragraphs.slice(0, at.p), left, right, ...paragraphs.slice(at.p + 1)];
}

function replaceFragment(
  paragraphs: readonly FlatTextParagraph[],
  from: TextPosition,
  to: TextPosition,
  fragment: TextFragment,
  imageOverrides: ReadonlyMap<number, import('./types').ElementImageReplacement> | undefined,
): FlatTextParagraph[] {
  // 复用普通替换统一校验跨段与公式边界，再在同一插入点展开已清洗片段。
  const offset = textPositionOffset(paragraphs[from.p], from);
  const inherited = styleAt(paragraphs[from.p], offset);
  const removed = replace(paragraphs, from, to, '');
  const source = removed[from.p];
  const prefix = sliceSegments(source, 0, offset);
  const suffix = sliceSegments(source, offset, source.text.length);
  const fragmentSegments = fragment.paragraphs.map((paragraph): Segment[] => paragraph.text.length
    ? paragraph.marks.map((mark) => ({
      text: paragraph.text.slice(mark.from, mark.to),
      template: formattedMark(inherited, mark.props),
    }))
    : [{ text: '', template: inherited }]);
  const inserted = fragmentSegments.map((segments, index) => {
    const normalized = normalizedParagraph(source, [
      ...(index === 0 ? prefix : []), ...segments,
      ...(index === fragmentSegments.length - 1 ? suffix : []),
    ]);
    const bullet = fragment.paragraphs[index].bullet;
    if (!bullet) return normalized;
    const image = bullet.kind === 'blip' ? imageOverrides?.get(index) : undefined;
    if (bullet.kind === 'blip' && !image) throw new Error('富文本图片项目符号缺少资源闭包');
    // 片段中的缺省样式表示“跟随文字”，落到覆盖层时必须显式归一为 null；否则保存会保留目标 pPr 的旧样式。
    const styledBullet = bullet.kind === 'none' ? bullet : {
      ...bullet, font: bullet.font ?? null, color: bullet.color ?? null, size: bullet.size ?? null,
    };
    const storedBullet = styledBullet.kind === 'blip'
      ? { ...styledBullet, image: { src: image!.src } } : styledBullet;
    const props = { ...normalized.props };
    if (storedBullet.kind === 'char') {
      props.bullet = storedBullet.char;
      delete props.bulletImage;
    } else if (storedBullet.kind === 'autoNum') {
      props.bullet = formatDrawingAutoNumber(storedBullet.type, storedBullet.startAt ?? 1);
      delete props.bulletImage;
    } else if (storedBullet.kind === 'blip') {
      props.bullet = null;
      props.bulletImage = storedBullet.image.src;
    } else {
      props.bullet = null;
      delete props.bulletImage;
    }
    if (storedBullet.kind !== 'none') {
      props.bulletFont = storedBullet.font ?? null;
      props.bulletColor = storedBullet.color ?? null;
      const maxSize = Math.max(...normalized.marks.map((mark) => mark.props.size), 1);
      props.bulletSize = storedBullet.size?.kind === 'points'
        ? storedBullet.size.value * (4 / 3) / maxSize
        : storedBullet.size?.value ?? null;
    }
    return {
      ...normalized,
      props,
      paragraphOverrides: { ...normalized.paragraphOverrides, bullet: storedBullet },
      ...(image ? { bulletImageOverride: image } : {}),
    };
  });
  return [...removed.slice(0, from.p), ...inserted, ...removed.slice(from.p + 1)];
}

export function applyTextEditOps(
  body: TextBody,
  ops: readonly TextEditOp[],
  initial?: Extract<TextOverride, { kind: 'flat' }>,
  fragmentImageOverrides?: ReadonlyMap<number, ReadonlyMap<number,
    import('./types').ElementImageReplacement>>,
): TextOverride {
  let override = initial ?? flattenTextBody(body);
  for (let opIndex = 0; opIndex < ops.length; opIndex++) {
    const op = ops[opIndex];
    const paragraphs = op.type === 'replace'
      ? replace(override.paragraphs, op.from, op.to, op.text)
      : op.type === 'splitParagraph'
        ? splitParagraph(override.paragraphs, op.at)
        : op.type === 'insertLineBreak'
          ? replace(override.paragraphs, op.at, op.at, '\n', true)
          : replaceFragment(
            override.paragraphs, op.from, op.to, op.fragment,
            fragmentImageOverrides?.get(opIndex),
          );
    override = { ...override, paragraphs };
  }
  return override;
}

function formattedMark(mark: TextMark, props: RunPropertyOverrides): TextMark {
  const inherited = mark.inheritedProps ?? DEFAULT_PROPERTIES;
  const font = props.font === null ? inherited.font : props.font;
  const size = props.size === null ? inherited.size : props.size;
  const color = props.color === null ? inherited.color : props.color;
  const b = props.b === null ? inherited.b : props.b;
  const i = props.i === null ? inherited.i : props.i;
  const u = props.u === null ? inherited.u : props.u;
  const strike = props.strike === null ? inherited.strike : props.strike;
  const nextOverrides: Record<string, unknown> = { ...mark.runOverrides };
  for (const field of STYLE_PROPERTY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(props, field)) nextOverrides[field] = props[field];
  }
  if (Object.prototype.hasOwnProperty.call(props, 'link')) {
    if (props.link === null) delete nextOverrides.link;
    else nextOverrides.link = props.link;
  }
  return {
    ...mark,
    props: {
      ...mark.props,
      ...(font !== undefined
        ? { fonts: props.font === null ? [...(mark.inheritedFonts ?? (font ? [font] : []))] : font ? [font] : [] }
        : {}),
      ...(size !== undefined ? { size } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(b !== undefined ? { b } : {}),
      ...(i !== undefined ? { i } : {}),
      ...(u !== undefined ? { u } : {}),
      ...(strike !== undefined ? { strike } : {}),
    },
    ...(Object.keys(nextOverrides).length
      ? { runOverrides: nextOverrides as RunPropertyOverrides }
      : { runOverrides: undefined }),
  };
}

function formatParagraph(
  paragraph: FlatTextParagraph,
  from: number,
  to: number,
  props: RunPropertyOverrides,
  includeEmpty = false,
): FlatTextParagraph {
  assertTextAtomBoundary(paragraph, from);
  assertTextAtomBoundary(paragraph, to);
  if (includeEmpty && !paragraph.text.length && paragraph.marks.length === 1) {
    return { ...paragraph, marks: [{ ...formattedMark(paragraph.marks[0], props), from: 0, to: 0 }] };
  }
  const segments: Segment[] = [];
  for (const mark of paragraph.marks) {
    const selectedFrom = Math.max(from, mark.from);
    const selectedTo = Math.min(to, mark.to);
    if (selectedTo <= selectedFrom || mark.atomText !== undefined) {
      segments.push({ text: paragraph.text.slice(mark.from, mark.to), template: mark });
      continue;
    }
    if (mark.from < selectedFrom) {
      segments.push({ text: paragraph.text.slice(mark.from, selectedFrom), template: mark });
    }
    segments.push({
      text: paragraph.text.slice(selectedFrom, selectedTo),
      template: formattedMark(mark, props),
    });
    if (selectedTo < mark.to) {
      segments.push({ text: paragraph.text.slice(selectedTo, mark.to), template: mark });
    }
  }
  return normalizedParagraph(paragraph, segments);
}

export function applyRunProps(
  body: TextBody,
  range: TextRange,
  props: RunPropertyOverrides,
  initial?: Extract<TextOverride, { kind: 'flat' }>,
): TextOverride {
  const override = initial ?? flattenTextBody(body);
  if (range.from.p < 0 || range.to.p < range.from.p || range.to.p >= override.paragraphs.length) {
    throw new Error('字符格式选区段落范围无效');
  }
  const first = override.paragraphs[range.from.p];
  const last = override.paragraphs[range.to.p];
  const from = textPositionOffset(first, range.from);
  const to = textPositionOffset(last, range.to);
  if (range.from.p === range.to.p && to < from) throw new Error('字符格式选区起点不能晚于终点');
  if (range.from.p === range.to.p && to === from) return override;
  const paragraphs = [...override.paragraphs];
  for (let index = range.from.p; index <= range.to.p; index++) {
    const paragraph = paragraphs[index];
    const start = index === range.from.p ? from : 0;
    const end = index === range.to.p ? to : paragraph.text.length;
    paragraphs[index] = formatParagraph(
      paragraph, start, end, props,
      range.from.p !== range.to.p && !paragraph.text.length,
    );
  }
  return { ...override, paragraphs };
}

export function applyParagraphProps(
  body: TextBody,
  range: TextRange,
  props: ParagraphPropertyOverrides,
  initial?: Extract<TextOverride, { kind: 'flat' }>,
  levelTemplate?: TextBody,
  sourceBody: TextBody = body,
  imageOverride?: import('./types').ElementImageReplacement,
): TextOverride {
  const override = initial ?? flattenTextBody(body);
  queryTextRunProps(body, range, override);
  return applyParagraphPropertyOverrides(
    sourceBody, override, range, props, levelTemplate, imageOverride,
  );
}

export function queryTextParagraphProps(
  body: TextBody,
  range: TextRange,
  initial?: Extract<TextOverride, { kind: 'flat' }>,
): ParagraphPropertiesState {
  const override = initial ?? flattenTextBody(body);
  queryTextRunProps(body, range, override);
  const paragraphs = override.paragraphs.slice(range.from.p, range.to.p + 1);
  const bullet = (paragraph: FlatTextParagraph) => {
    if (Object.prototype.hasOwnProperty.call(paragraph.paragraphOverrides ?? {}, 'bullet')) {
      return paragraph.paragraphOverrides?.bullet
        ?? paragraph.inheritedBullet ?? { kind: 'none' as const };
    }
    if (paragraph.sourceBullet) return paragraph.sourceBullet;
    if (paragraph.props.bullet === null || paragraph.props.bulletImage) return null;
    return {
      kind: 'char' as const,
      char: paragraph.props.bullet,
      ...(paragraph.props.bulletFont ? { font: paragraph.props.bulletFont } : {}),
    };
  };
  const bulletValues = paragraphs.map(bullet);
  const firstBullet = bulletValues[0] ?? null;
  const bulletState: RunPropertyState<NonNullable<typeof firstBullet>> = {
    value: firstBullet,
    mixed: bulletValues.some((value) => JSON.stringify(value) !== JSON.stringify(firstBullet)),
  };
  return {
    level: state(paragraphs.map((paragraph) => paragraph.props.lvl)),
    align: state(paragraphs.map((paragraph) => paragraph.props.align)),
    lineHeight: state(paragraphs.map((paragraph) => paragraph.props.lineHeight)),
    spaceBefore: state(paragraphs.map((paragraph) => paragraph.props.spaceBefore)),
    spaceAfter: state(paragraphs.map((paragraph) => paragraph.props.spaceAfter)),
    marginLeft: state(paragraphs.map((paragraph) => paragraph.props.marL)),
    indent: state(paragraphs.map((paragraph) => paragraph.props.indent)),
    bullet: bulletState,
  };
}

function state<T>(values: readonly (T | null)[]): RunPropertyState<T> {
  const first = values[0] ?? null;
  return { value: first, mixed: values.some((value) => !Object.is(value, first)) };
}

function fontState(marks: readonly TextMark[]): RunPropertyState<string> {
  const first = marks[0]?.props.fonts[0] ?? null;
  const signature = JSON.stringify(marks[0]?.props.fonts ?? []);
  return {
    value: first,
    // 面板只显示主字体，但 eastAsia / complexScript 回退不同仍属于真实混合格式。
    mixed: marks.some((mark) => JSON.stringify(mark.props.fonts) !== signature),
  };
}

export function queryTextRunProps(
  body: TextBody,
  range: TextRange,
  initial?: Extract<TextOverride, { kind: 'flat' }>,
): RunPropertiesState {
  const selected = textMarksInRange(body, range, initial);
  return {
    font: fontState(selected),
    size: state(selected.map((mark) => mark.props.size)),
    color: state(selected.map((mark) => mark.props.color)),
    b: state(selected.map((mark) => mark.props.b)),
    i: state(selected.map((mark) => mark.props.i)),
    u: state(selected.map((mark) => mark.props.u)),
    strike: state(selected.map((mark) => mark.props.strike)),
  };
}

/** 链接查询与字符面板复用完全相同的区间/公式边界语义。 */
export function textMarksInRange(
  body: TextBody,
  range: TextRange,
  initial?: Extract<TextOverride, { kind: 'flat' }>,
): TextMark[] {
  const override = initial ?? flattenTextBody(body);
  if (range.from.p < 0 || range.to.p < range.from.p || range.to.p >= override.paragraphs.length) {
    throw new Error('字符格式查询段落范围无效');
  }
  const first = override.paragraphs[range.from.p];
  const last = override.paragraphs[range.to.p];
  const from = textPositionOffset(first, range.from);
  const to = textPositionOffset(last, range.to);
  if (range.from.p === range.to.p && to < from) throw new Error('字符格式查询起点不能晚于终点');
  const selected: TextMark[] = [];
  for (let index = range.from.p; index <= range.to.p; index++) {
    const paragraph = override.paragraphs[index];
    const start = index === range.from.p ? from : 0;
    const end = index === range.to.p ? to : paragraph.text.length;
    selected.push(...paragraph.marks.filter((mark) => mark.to > start && mark.from < end));
  }
  if (!selected.length) selected.push(styleAt(first, from));
  return selected;
}
