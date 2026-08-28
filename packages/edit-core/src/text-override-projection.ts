import type { Paragraph, TextBody, TextRun } from '@web-ppt/core';
import type { FlatTextParagraph, LinkOverride, TextMark, TextOverride } from './types';

function runProps(run: TextRun): Omit<TextRun, 'text'> {
  const { text: _text, editInfo: _editInfo, ...props } = run;
  return props;
}

function paragraphProps(paragraph: Paragraph): Omit<Paragraph, 'runs'> {
  const { runs: _runs, editInfo: _editInfo, ...props } = paragraph;
  return props;
}

function textRun(mark: TextMark, text: string, sourceRun?: TextRun): TextRun {
  const props = { ...(sourceRun ? runProps(sourceRun) : mark.props) };
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
    props.fonts = overrides.font === null
      ? [...(sourceRun?.editInfo?.inheritedRunProps.fonts ?? mark.inheritedFonts ?? mark.props.fonts)]
      : overrides.font ? [overrides.font] : [];
  }
  for (const field of ['size', 'color', 'b', 'i', 'u', 'strike'] as const) {
    const value = overrides?.[field];
    if (value !== undefined) {
      const inherited = sourceRun?.editInfo?.inheritedRunProps[field]
        ?? mark.inheritedProps?.[field] ?? mark.props[field];
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
  return { text: mark.atomText ?? text, ...props };
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
): Omit<Paragraph, 'runs' | 'editInfo'> {
  const props = source ? paragraphProps(source) : { ...paragraph.props };
  const overrides = paragraph.paragraphOverrides;
  const fields = [
    ['align', 'align'], ['lineHeight', 'lineHeight'], ['spaceBefore', 'spaceBefore'],
    ['spaceAfter', 'spaceAfter'], ['marginLeft', 'marL'], ['indent', 'indent'],
  ] as const;
  for (const [overrideField, paragraphField] of fields) {
    if (overrides?.[overrideField] === undefined) continue;
    const inherited = source?.editInfo?.inheritedParagraphProps;
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
  return {
    ...bodyFromOverride(override, source),
    // mark 与 data-r / TextPosition 必须一一对应；同来源切片已在 normalizedParagraph 合并。
    paragraphs: override.paragraphs.map((paragraph, paragraphIndex): Paragraph => {
      const sourceParagraph = source?.paragraphs[paragraph.sourceParagraph ?? paragraphIndex];
      return {
        ...paragraphFromOverride(paragraph, sourceParagraph),
        runs: paragraph.marks.map((mark, markIndex) => {
          const sourceRun = source?.paragraphs[
            mark.source?.paragraph ?? paragraph.sourceParagraph ?? paragraphIndex
          ]?.runs[mark.source?.run ?? markIndex];
          const run = textRun(mark, paragraph.text.slice(mark.from, mark.to), sourceRun);
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
