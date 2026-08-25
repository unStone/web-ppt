import { paragraphLayoutDirectFlags, textRunDirectFlags } from '@web-ppt/core';
import type { TextBody } from '@web-ppt/core';

/** 字段内容属于页面；版式字段节点上的直设格式只是缓存，克隆时必须回到继承层。 */
export function fieldTextWithoutDirect(source: TextBody): TextBody {
  const text = structuredClone(source);
  const inheritedBody = text.editInfo?.inherited;
  if (inheritedBody) {
    for (const field of [
      'anchor', 'insets', 'wrap', 'fontScale', 'autoFitCompute', 'autoFitNormal',
      'lnSpcReduction', 'vert', 'anchorCtr', 'autoFitShape', 'columns', 'columnGap',
    ] as const) {
      const value = inheritedBody[field];
      if (value === undefined) delete text[field];
      else text[field] = structuredClone(value) as never;
    }
  }
  if (text.editInfo) text.editInfo = { ...text.editInfo, direct: 0 };
  for (const paragraph of text.paragraphs) {
    const inheritedParagraph = paragraph.editInfo?.inheritedParagraphProps;
    if (inheritedParagraph) {
      Object.assign(paragraph, {
        align: inheritedParagraph.align, lineHeight: inheritedParagraph.lineHeight,
        spaceBefore: inheritedParagraph.spaceBefore, spaceAfter: inheritedParagraph.spaceAfter,
        marL: inheritedParagraph.marginLeft, indent: inheritedParagraph.indent,
      });
    }
    if (paragraph.editInfo) {
      paragraph.editInfo = {
        ...paragraph.editInfo, directParagraphProps: {},
        directRun: textRunDirectFlags(0), directLayout: paragraphLayoutDirectFlags(0),
      };
    }
    for (const run of paragraph.runs) {
      const inheritedRun = run.editInfo?.inheritedRunProps;
      if (inheritedRun) {
        Object.assign(run, {
          b: inheritedRun.b, i: inheritedRun.i, u: inheritedRun.u, strike: inheritedRun.strike,
          size: inheritedRun.size, color: inheritedRun.color, fonts: [...inheritedRun.fonts],
          baseline: inheritedRun.baseline, spacing: inheritedRun.spacing, caps: inheritedRun.caps,
          outline: structuredClone(inheritedRun.outline),
          gradient: inheritedRun.gradient, highlight: inheritedRun.highlight,
          underlineColor: inheritedRun.underlineColor,
        });
      }
      if (run.editInfo) run.editInfo = { ...run.editInfo, direct: textRunDirectFlags(0) };
    }
  }
  return text;
}
