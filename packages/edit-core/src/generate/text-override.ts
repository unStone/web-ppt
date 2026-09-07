import { PARAGRAPH_LAYOUT_DIRECT_BITS, TEXT_RUN_DIRECT_BITS } from '@web-ppt/core';
import type { TextBody } from '@web-ppt/core';
import { insertionResourceToken } from '../session-assets';
import { flattenTextBody } from '../text-model';
import type { EditDoc, ElementInsertionResource, ElementImageReplacement, ParagraphBullet, SlideId, TextOverride } from '../types';
import { generatedLink } from './links';
import { imageClosure } from './media';
import { hasNativeText, validateNativeText } from './text-effects';

export interface GeneratedTextContext {
  readonly part: string;
  readonly relationshipPrefix: string;
  readonly resources: Map<string, ElementInsertionResource>;
}

function generatedParagraphBullet(
  doc: EditDoc,
  paragraph: TextBody['paragraphs'][number],
  index: number,
  context: GeneratedTextContext,
): { readonly bullet?: ParagraphBullet; readonly image?: ElementImageReplacement } {
  const info = paragraph.editInfo?.bullet;
  const style = info && info.kind !== 'none' ? {
    ...(info.color !== undefined ? { color: info.color } : {}),
    ...(info.font !== undefined ? { font: info.font } : {}),
    ...(info.size !== undefined ? { size: info.size } : {}),
  } : {};
  if (paragraph.bulletImage || info?.kind === 'image') {
    const source = paragraph.bulletImage ?? (info?.kind === 'image' ? info.src : null);
    if (!source) throw new Error('生成保存的图片项目符号缺少资源来源');
    const closure = imageClosure(
      doc, { src: source }, `${context.relationshipPrefix}P${index + 1}`, context.part,
    );
    if (!closure.resource) throw new Error('外链图片项目符号不能生成独立包');
    context.resources.set(closure.resource.hash, closure.resource);
    const src = insertionResourceToken(closure.resource.hash);
    return {
      bullet: { kind: 'blip', image: { src }, ...style },
      image: { src, relationships: [closure.relationship], resourceHash: closure.resource.hash },
    };
  }
  if (info?.kind === 'autoNum') return {
    bullet: {
      kind: 'autoNum', type: info.type as import('../types').ParagraphAutoNumberType,
      startAt: info.startAt, ...style,
    },
  };
  if (info?.kind === 'char') return { bullet: { kind: 'char', char: info.char, ...style } };
  if (paragraph.bullet !== null) return {
    bullet: { kind: 'char', char: paragraph.bullet, ...style },
  };
  return paragraph.editInfo?.directLayout &&
    paragraph.editInfo.directLayout & PARAGRAPH_LAYOUT_DIRECT_BITS.bullet
    ? { bullet: { kind: 'none' } } : {};
}

export function textOverride(
  doc: EditDoc,
  slideId: SlideId,
  body: TextBody | null | undefined,
  context: GeneratedTextContext,
  tableStyleAware = false,
): TextOverride | undefined {
  if (!body) return undefined;
  for (const paragraph of body.paragraphs) {
    for (const run of paragraph.runs) {
      validateNativeText(run);
    }
  }
  const flat = flattenTextBody(body);
  const autoFit = body.autoFitShape ? 'shape' : body.autoFitNormal ? 'normal' : 'none';
  return {
    ...flat,
    bodyOverrides: {
      anchor: body.anchor,
      insets: body.insets,
      wrap: body.wrap,
      vert: body.vert ?? 'horz',
      anchorCtr: body.anchorCtr ?? false,
      columns: body.columns ?? 1,
      columnGap: body.columnGap ?? 0,
      autoFit,
    },
    paragraphs: flat.paragraphs.map((paragraph, paragraphIndex) => {
      const bullet = generatedParagraphBullet(doc, body.paragraphs[paragraphIndex], paragraphIndex, context);
      return {
        ...paragraph,
        sourceParagraph: body.paragraphs[paragraphIndex].runs.some(run => run.math?.length)
          ? paragraphIndex : undefined,
        paragraphOverrides: {
        align: paragraph.props.align,
        lineHeight: paragraph.props.lineHeight,
        spaceBefore: paragraph.props.spaceBefore,
        spaceAfter: paragraph.props.spaceAfter,
        marginLeft: paragraph.props.marL,
        indent: paragraph.props.indent,
          ...(bullet.bullet ? { bullet: bullet.bullet } : {}),
        },
        ...(bullet.image ? { bulletImageOverride: bullet.image } : {}),
        marks: paragraph.marks.map((mark, markIndex) => {
        const sourceParagraph = body.paragraphs[paragraphIndex];
        const sourceRun = sourceParagraph?.runs[markIndex];
        const direct = (sourceParagraph?.editInfo?.directRun ?? 0) | (sourceRun?.editInfo?.direct ?? 0);
        const underline = mark.props.underline ?? (mark.props.u ? 'sng' : 'none');
        const strikeType = mark.props.strikeType
          ?? (mark.props.strike ? 'sngStrike' : 'noStrike');
        const preserveField = !!sourceRun && hasNativeText(sourceRun);
        return {
          ...mark,
          source: preserveField ? { paragraph: paragraphIndex, run: markIndex } : undefined,
          preserveSource: preserveField ? true : undefined,
          // 生成包不再拥有原主题继承链；表样式控制的 b/color 只有真实直设才固定。
          runOverrides: {
            size: mark.props.size,
            ...(!tableStyleAware || direct & TEXT_RUN_DIRECT_BITS.b ? { b: mark.props.b } : {}),
            ...(tableStyleAware && direct & TEXT_RUN_DIRECT_BITS.color && !mark.props.gradientFill
              ? { color: mark.props.color } : {}),
            i: mark.props.i,
            ...(underline !== 'none' ? { underline } : {}),
            ...(strikeType !== 'noStrike' ? { strikeType } : {}),
            ...(mark.props.highlight ? { highlight: mark.props.highlight } : {}),
            ...(mark.props.spacing ? { spacing: mark.props.spacing } : {}),
            ...(mark.props.caps && mark.props.caps !== 'none' ? { caps: mark.props.caps } : {}),
            ...(mark.props.baseline ? { baseline: mark.props.baseline } : {}),
            ...(mark.props.link
              ? { link: generatedLink(doc, slideId, mark.props.link, '文字链接') } : {}),
          },
        };
        }),
      };
    }),
  };
}
