import {
  paragraphLayoutDirectFlags, TEXT_RUN_DIRECT_BITS, textRunDirectFlags,
} from '@web-ppt/core';
import type {
  Paragraph, TextBody, TextFontSlots, TextRun, TextRunEditInfo,
} from '@web-ppt/core';
import type { FlatTextParagraph, LinkOverride, TextMark, TextOverride } from './types';

function runProps(run: TextRun): Omit<TextRun, 'text'> {
  const { text: _text, editInfo: _editInfo, ...props } = run;
  return props;
}

function paragraphProps(paragraph: Paragraph): Omit<Paragraph, 'runs'> {
  const { runs: _runs, editInfo: _editInfo, ...props } = paragraph;
  return props;
}

const RUN_DIRECT_FIELDS = [
  ['size', TEXT_RUN_DIRECT_BITS.size], ['color', TEXT_RUN_DIRECT_BITS.color],
  ['b', TEXT_RUN_DIRECT_BITS.b], ['i', TEXT_RUN_DIRECT_BITS.i],
  ['u', TEXT_RUN_DIRECT_BITS.u], ['strike', TEXT_RUN_DIRECT_BITS.strike],
] as const;
const FONT_DIRECT_BITS = TEXT_RUN_DIRECT_BITS.fonts | TEXT_RUN_DIRECT_BITS.fontLatin
  | TEXT_RUN_DIRECT_BITS.fontEastAsian | TEXT_RUN_DIRECT_BITS.fontComplexScript;

function fontSlots(fonts: readonly string[]): TextFontSlots {
  return {
    latin: fonts[0] ?? null,
    eastAsian: fonts[1] ?? null,
    complexScript: fonts[2] ?? null,
  };
}

function uniformFontSlots(font: string | null): TextFontSlots {
  return { latin: font, eastAsian: font, complexScript: font };
}

/** 有效投影必须携带用户直设来源，否则后续样式投影会误把它当继承值覆盖。 */
function projectedRunEditInfo(
  mark: TextMark,
  props: Omit<TextRun, 'text'>,
  sourceRun?: TextRun,
  useMarkProps = false,
): TextRunEditInfo | undefined {
  const overrides = mark.runOverrides;
  let bits = sourceRun?.editInfo?.direct ?? 0;
  for (const [field, bit] of RUN_DIRECT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(overrides ?? {}, field)) continue;
    bits = overrides?.[field] === null ? bits & ~bit : bits | bit;
  }
  if (Object.prototype.hasOwnProperty.call(overrides ?? {}, 'font')) {
    bits = overrides?.font === null ? bits & ~FONT_DIRECT_BITS : bits | TEXT_RUN_DIRECT_BITS.fonts;
  }
  if (!sourceRun?.editInfo && bits === 0 && !mark.sourceLinkReadonly) return undefined;

  const sourceInfo = sourceRun?.editInfo;
  const inheritedRunProps = useMarkProps
    ? mark.inheritedRunProps ?? sourceInfo?.inheritedRunProps
    : sourceInfo?.inheritedRunProps ?? mark.inheritedRunProps;
  const preferredInheritedFonts = useMarkProps
    ? mark.inheritedFonts ?? sourceInfo?.inheritedRunProps.fonts
    : sourceInfo?.inheritedRunProps.fonts ?? mark.inheritedFonts;
  const inheritedFonts = [...(preferredInheritedFonts
    ?? (mark.inheritedProps?.font ? [mark.inheritedProps.font] : props.fonts))];
  const effectiveFonts = [...props.fonts];
  const inheritedSlots = (useMarkProps
    ? mark.inheritedFontSlots ?? sourceInfo?.inheritedFontSlots
    : sourceInfo?.inheritedFontSlots ?? mark.inheritedFontSlots)
    ?? fontSlots(inheritedFonts);
  return {
    inheritedRunProps: inheritedRunProps
      ? structuredClone(inheritedRunProps)
      : {
        b: mark.inheritedProps?.b ?? props.b,
        i: mark.inheritedProps?.i ?? props.i,
        u: mark.inheritedProps?.u ?? props.u,
        strike: mark.inheritedProps?.strike ?? props.strike,
        size: mark.inheritedProps?.size ?? props.size,
        color: mark.inheritedProps?.color ?? props.color,
        fonts: inheritedFonts,
      },
    inheritedFontSlots: structuredClone(inheritedSlots),
    direct: textRunDirectFlags(bits),
    fontSlots: Object.prototype.hasOwnProperty.call(overrides ?? {}, 'font')
      ? overrides?.font === null
        ? structuredClone(inheritedSlots)
        : uniformFontSlots(effectiveFonts[0] ?? null)
      : useMarkProps && !(bits & FONT_DIRECT_BITS)
        ? structuredClone(inheritedSlots)
        : sourceInfo?.fontSlots ?? fontSlots(effectiveFonts),
    ...(sourceInfo?.readonlyLink || mark.sourceLinkReadonly ? { readonlyLink: true } : {}),
  };
}

const PARAGRAPH_DIRECT_FIELDS = [
  'level', 'align', 'lineHeight', 'spaceBefore', 'spaceAfter', 'marginLeft', 'indent',
] as const;

function projectedParagraphEditInfo(
  paragraph: FlatTextParagraph,
  props: Omit<Paragraph, 'runs' | 'editInfo'>,
  source: Paragraph | undefined,
  useFlatLayout: boolean,
): Paragraph['editInfo'] {
  const sourceInfo = source?.editInfo;
  const overrides = paragraph.paragraphOverrides;
  const directParagraphProps = {
    ...(sourceInfo?.directParagraphProps ?? paragraph.directParagraphProps),
  };
  for (const field of PARAGRAPH_DIRECT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(overrides ?? {}, field)) continue;
    if (overrides?.[field] === null) delete directParagraphProps[field];
    else directParagraphProps[field] = true;
  }
  if (!sourceInfo && !paragraph.inheritedParagraphProps
    && !paragraph.directParagraphProps && !overrides) return undefined;
  const inherited = useFlatLayout
    ? paragraph.inheritedParagraphProps ?? sourceInfo?.inheritedParagraphProps
    : sourceInfo?.inheritedParagraphProps ?? paragraph.inheritedParagraphProps;
  return {
    inheritedParagraphProps: structuredClone(inherited ?? {
      level: props.lvl,
      align: props.align,
      lineHeight: props.lineHeight,
      spaceBefore: props.spaceBefore,
      spaceAfter: props.spaceAfter,
      marginLeft: props.marL,
      indent: props.indent,
    }),
    directParagraphProps,
    directRun: sourceInfo?.directRun ?? textRunDirectFlags(0),
    directLayout: sourceInfo?.directLayout ?? paragraphLayoutDirectFlags(0),
    ...(sourceInfo?.autoNumbering ? { autoNumbering: structuredClone(sourceInfo.autoNumbering) } : {}),
  };
}

function textRun(mark: TextMark, text: string, sourceRun?: TextRun, useMarkProps = false): TextRun {
  const props = { ...(sourceRun && !useMarkProps ? runProps(sourceRun) : mark.props) };
  if (sourceRun) {
    // math / field 是内容身份而非视觉格式；新输入只借来源样式，不能复活旧语义。
    for (const field of ['math', 'field'] as const) {
      const value = mark.props[field];
      if (value === undefined) delete props[field];
      else props[field] = structuredClone(value) as never;
    }
  }
  const overrides = mark.runOverrides;
  if (overrides?.font !== undefined) {
    const inheritedFonts = useMarkProps
      ? mark.inheritedFonts ?? sourceRun?.editInfo?.inheritedRunProps.fonts
      : sourceRun?.editInfo?.inheritedRunProps.fonts ?? mark.inheritedFonts;
    props.fonts = overrides.font === null
      ? [...(inheritedFonts ?? mark.props.fonts)]
      : overrides.font ? [overrides.font] : [];
  }
  for (const field of ['size', 'color', 'b', 'i', 'u', 'strike'] as const) {
    const value = overrides?.[field];
    if (value !== undefined) {
      const inherited = useMarkProps
        ? mark.inheritedProps?.[field] ?? sourceRun?.editInfo?.inheritedRunProps[field]
        : sourceRun?.editInfo?.inheritedRunProps[field] ?? mark.inheritedProps?.[field];
      (props as unknown as Record<string, unknown>)[field] = value === null ? inherited : value;
    }
  }
  if (props.field && sourceRun) {
    const preservesField = mark.preserveSource
      && sourceRun.field?.toLowerCase() === props.field.toLowerCase()
      && sourceRun.text === text;
    // 字段缓存一旦被局部改写，保存会降级为普通 run；投影必须采用同一字段身份语义。
    if (!preservesField) delete props.field;
  }
  const editInfo = projectedRunEditInfo(mark, props, sourceRun, useMarkProps);
  return { text: mark.atomText ?? text, ...props, ...(editInfo ? { editInfo } : {}) };
}

function bodyFromOverride(
  override: Extract<TextOverride, { kind: 'flat' }>,
  source?: TextBody | null,
): Omit<TextBody, 'paragraphs' | 'editInfo'> {
  const { paragraphs: _paragraphs, editInfo: _editInfo, ...sourceBody } = source ?? {
    ...override.body, paragraphs: [],
  };
  const body = { ...sourceBody };
  const overrides = override.bodyOverrides;
  const assign = <K extends 'anchor' | 'insets' | 'wrap'>(field: K): void => {
    if (overrides?.[field] === undefined) return;
    const value = overrides[field] === null
      ? source?.editInfo?.inherited?.[field] ?? override.body[field]
      : override.body[field];
    body[field] = structuredClone(value) as never;
  };
  assign('anchor');
  assign('insets');
  assign('wrap');
  const assignOptional = <K extends 'vert' | 'anchorCtr' | 'columns' | 'columnGap'>(field: K): void => {
    if (overrides?.[field] === undefined) return;
    const value = overrides[field] === null
      ? source?.editInfo?.inherited?.[field] : override.body[field];
    if (value === undefined) delete body[field];
    else body[field] = value as never;
  };
  assignOptional('vert');
  assignOptional('anchorCtr');
  assignOptional('columns');
  assignOptional('columnGap');
  if (overrides?.autoFit !== undefined) {
    for (const field of [
      'autoFitShape', 'autoFitNormal', 'autoFitCompute', 'lnSpcReduction',
    ] as const) delete body[field];
    const autoFitSource = overrides.autoFit === null
      ? source?.editInfo?.inherited ?? override.body : override.body;
    body.fontScale = autoFitSource.fontScale;
    for (const field of [
      'autoFitShape', 'autoFitNormal', 'autoFitCompute', 'lnSpcReduction',
    ] as const) {
      const value = autoFitSource[field];
      if (value !== undefined) body[field] = value as never;
    }
  }
  return body;
}

function paragraphFromOverride(
  paragraph: FlatTextParagraph,
  source: Paragraph | undefined,
  useFlatLayout = false,
): Omit<Paragraph, 'runs' | 'editInfo'> {
  const overrides = paragraph.paragraphOverrides;
  // level 会连带九级样式中的符号、缩进与字符默认值；投影必须采用已重基的扁平结果。
  const levelChanged = Object.prototype.hasOwnProperty.call(overrides ?? {}, 'level');
  const props = source && !levelChanged && !useFlatLayout
    ? paragraphProps(source) : { ...paragraph.props };
  const fields = [
    ['level', 'lvl'],
    ['align', 'align'], ['lineHeight', 'lineHeight'], ['spaceBefore', 'spaceBefore'],
    ['spaceAfter', 'spaceAfter'], ['marginLeft', 'marL'], ['indent', 'indent'],
  ] as const;
  for (const [overrideField, paragraphField] of fields) {
    if (overrides?.[overrideField] === undefined) continue;
    const inherited = levelChanged
      ? paragraph.inheritedParagraphProps ?? source?.editInfo?.inheritedParagraphProps
      : source?.editInfo?.inheritedParagraphProps ?? paragraph.inheritedParagraphProps;
    const value = overrides[overrideField] === null
      ? inherited?.[overrideField] ?? paragraph.props[paragraphField]
      : paragraph.props[paragraphField];
    props[paragraphField] = value as never;
  }
  return props;
}

/** 用户未触碰的格式每次从当前投影源重基；覆盖层不会冻结旧版式的有效值。 */
export function textBodyFromOverride(
  override: Extract<TextOverride, { kind: 'flat' }>,
  source?: TextBody | null,
  resolveLink?: (link: Exclude<LinkOverride, { kind: 'none' }>) => string | undefined,
): TextBody {
  const hasLevelChanges = override.paragraphs.some((paragraph) =>
    Object.prototype.hasOwnProperty.call(paragraph.paragraphOverrides ?? {}, 'level'));
  return {
    ...bodyFromOverride(override, source),
    // mark 与 data-r / TextPosition 必须一一对应；同来源切片已在 normalizedParagraph 合并。
    paragraphs: override.paragraphs.map((paragraph, paragraphIndex): Paragraph => {
      const sourceParagraph = source?.paragraphs[paragraph.sourceParagraph ?? paragraphIndex];
      const levelChanged = Object.prototype.hasOwnProperty.call(
        paragraph.paragraphOverrides ?? {}, 'level',
      );
      const paragraphProps = paragraphFromOverride(paragraph, sourceParagraph, hasLevelChanges);
      const editInfo = projectedParagraphEditInfo(
        paragraph, paragraphProps, sourceParagraph, levelChanged || hasLevelChanges,
      );
      return {
        ...paragraphProps,
        ...(editInfo ? { editInfo } : {}),
        runs: paragraph.marks.map((mark, markIndex) => {
          const sourceRun = source?.paragraphs[
            mark.source?.paragraph ?? paragraph.sourceParagraph ?? paragraphIndex
          ]?.runs[mark.source?.run ?? markIndex];
          const run = textRun(
            mark, paragraph.text.slice(mark.from, mark.to), sourceRun, levelChanged,
          );
          const overrideLink = mark.runOverrides?.link;
          if (overrideLink === undefined || overrideLink === null) return run;
          if (overrideLink.kind === 'none') {
            const { link: _link, ...withoutLink } = run;
            return withoutLink;
          }
          return { ...run, link: resolveLink?.(overrideLink) };
        }),
      };
    }),
  };
}
