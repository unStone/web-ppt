import {
  PARAGRAPH_LAYOUT_DIRECT_BITS, TEXT_BODY_PROPERTY_BITS, TEXT_RUN_DIRECT_BITS,
} from '@web-ppt/core';
import type {
  Paragraph, TextBody, TextRun, TextRunDirectFlags,
} from '@web-ppt/core';

const RUN_FIELDS = [
  ['b', TEXT_RUN_DIRECT_BITS.b], ['i', TEXT_RUN_DIRECT_BITS.i],
  ['u', TEXT_RUN_DIRECT_BITS.u], ['strike', TEXT_RUN_DIRECT_BITS.strike],
  ['size', TEXT_RUN_DIRECT_BITS.size],
  ['color', TEXT_RUN_DIRECT_BITS.color], ['baseline', TEXT_RUN_DIRECT_BITS.baseline],
  ['spacing', TEXT_RUN_DIRECT_BITS.spacing], ['caps', TEXT_RUN_DIRECT_BITS.caps],
  ['outline', TEXT_RUN_DIRECT_BITS.outline], ['gradient', TEXT_RUN_DIRECT_BITS.gradient],
  ['highlight', TEXT_RUN_DIRECT_BITS.highlight],
  ['underlineColor', TEXT_RUN_DIRECT_BITS.underlineColor],
] as const;

function stackFromSlots(slots: NonNullable<TextRun['editInfo']>['fontSlots']): string[] {
  return [...new Set([
    slots.latin, slots.eastAsian, slots.complexScript,
  ].filter((font): font is string => !!font))];
}

function rebasedRun(
  source: TextRun,
  target: TextRun,
  paragraphDirect: TextRunDirectFlags | 0,
): TextRun {
  const direct = (source.editInfo?.direct ?? 0) | paragraphDirect;
  const out = { ...source } as TextRun;
  const values = out as unknown as Record<string, unknown>;
  const sourceSlots = source.editInfo?.fontSlots;
  const targetSlots = target.editInfo?.fontSlots;
  if (sourceSlots && targetSlots) {
    const allDirect = !!(direct & TEXT_RUN_DIRECT_BITS.fonts);
    const fontSlots = {
      latin: allDirect || direct & TEXT_RUN_DIRECT_BITS.fontLatin
        ? sourceSlots.latin : targetSlots.latin,
      eastAsian: allDirect || direct & TEXT_RUN_DIRECT_BITS.fontEastAsian
        ? sourceSlots.eastAsian : targetSlots.eastAsian,
      complexScript: allDirect || direct & TEXT_RUN_DIRECT_BITS.fontComplexScript
        ? sourceSlots.complexScript : targetSlots.complexScript,
    };
    out.fonts = stackFromSlots(fontSlots);
    out.editInfo = { ...source.editInfo!, fontSlots };
  } else if (!(direct & (TEXT_RUN_DIRECT_BITS.fonts
    | TEXT_RUN_DIRECT_BITS.fontLatin
    | TEXT_RUN_DIRECT_BITS.fontEastAsian
    | TEXT_RUN_DIRECT_BITS.fontComplexScript))) {
    out.fonts = structuredClone(target.fonts);
  }
  for (const [field, bit] of RUN_FIELDS) {
    if (direct & bit) continue;
    const value = target[field];
    if (value === undefined) delete values[field];
    else values[field] = structuredClone(value);
  }
  if (source.editInfo && target.editInfo) {
    out.editInfo = {
      ...(out.editInfo ?? source.editInfo),
      inheritedRunProps: structuredClone(target.editInfo.inheritedRunProps),
    };
  }
  return out;
}

function rebasedParagraph(source: Paragraph, target: Paragraph): Paragraph {
  const direct = source.editInfo?.directParagraphProps ?? {};
  const out: Paragraph = { ...source };
  const assign = <K extends 'align' | 'lineHeight' | 'spaceBefore' | 'spaceAfter' | 'marL' | 'indent'>(
    field: K,
    directField: keyof NonNullable<Paragraph['editInfo']>['directParagraphProps'],
  ): void => {
    if (!direct[directField]) out[field] = target[field] as Paragraph[K];
  };
  assign('align', 'align');
  assign('lineHeight', 'lineHeight');
  assign('spaceBefore', 'spaceBefore');
  assign('spaceAfter', 'spaceAfter');
  assign('marL', 'marginLeft');
  assign('indent', 'indent');
  const directLayout = source.editInfo?.directLayout ?? 0;
  const assignLayout = <K extends 'bulletColor' | 'bulletFont' | 'bulletSize' | 'rtl'>(
    field: K,
    bit: number,
  ): void => {
    if (directLayout & bit) return;
    const value = target[field];
    if (value === undefined) delete out[field];
    else out[field] = structuredClone(value) as never;
  };
  if (!(directLayout & PARAGRAPH_LAYOUT_DIRECT_BITS.bullet)) {
    out.bullet = target.bullet;
    if (target.bulletImage === undefined) delete out.bulletImage;
    else out.bulletImage = target.bulletImage;
  }
  assignLayout('bulletColor', PARAGRAPH_LAYOUT_DIRECT_BITS.bulletColor);
  assignLayout('bulletFont', PARAGRAPH_LAYOUT_DIRECT_BITS.bulletFont);
  assignLayout('bulletSize', PARAGRAPH_LAYOUT_DIRECT_BITS.bulletSize);
  assignLayout('rtl', PARAGRAPH_LAYOUT_DIRECT_BITS.rtl);
  out.runs = source.runs.map((run, index) => rebasedRun(
    run, target.runs[index] ?? target.runs[target.runs.length - 1] ?? run,
    source.editInfo?.directRun ?? 0,
  ));
  if (source.editInfo && target.editInfo) {
    out.editInfo = {
      ...source.editInfo,
      inheritedParagraphProps: structuredClone(target.editInfo.inheritedParagraphProps),
    };
  }
  return out;
}

/** 仅替换没有页面直设位的字段；页面文字内容和 run 身份始终留在 source。 */
export function rebaseLayoutText(source: TextBody | null, target: TextBody | null): TextBody | null {
  if (!source || !target || !target.paragraphs.length) return source;
  const out: TextBody = { ...source };
  const bodyFields = [
    'anchor', 'insets', 'wrap', 'vert', 'anchorCtr', 'columns', 'columnGap',
  ] as const;
  const direct = source.editInfo?.direct ?? 0;
  for (const field of bodyFields) {
    if (direct & TEXT_BODY_PROPERTY_BITS[field]) continue;
    const value = target[field];
    if (value === undefined) delete out[field];
    else out[field] = structuredClone(value) as never;
  }
  if (!(direct & TEXT_BODY_PROPERTY_BITS.autoFit)) {
    for (const field of [
      'autoFitShape', 'autoFitNormal', 'autoFitCompute', 'fontScale', 'lnSpcReduction',
    ] as const) {
      const value = target[field];
      if (value === undefined) delete out[field];
      else out[field] = value as never;
    }
  }
  out.paragraphs = source.paragraphs.map((paragraph) => {
    const template = target.paragraphs.find((candidate) => candidate.lvl === paragraph.lvl)
      ?? target.paragraphs[0];
    return rebasedParagraph(paragraph, template);
  });
  if (source.editInfo && target.editInfo) {
    out.editInfo = {
      ...source.editInfo,
      ...(target.editInfo.inherited
        ? { inherited: structuredClone(target.editInfo.inherited) } : {}),
    };
  }
  return out;
}
