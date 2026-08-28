import { DEFAULT_TEXT_LINE_HEIGHT } from '../types';
import type { Paragraph } from '../types';
import type { LevelStyles, ParaProps } from './text';

const ALIGN: Record<string, Paragraph['align']> = {
  l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify',
};

export function mergeParagraphProps(base: ParaProps, over: ParaProps): ParaProps {
  const merged = { ...base, ...over, rp: { ...base.rp, ...over.rp } };
  // lnSpc 的 spcPct / spcPts 是同一 choice；直接层选择一种时必须遮住继承层的另一种。
  if (over.lnPct !== undefined) delete merged.lnPx;
  if (over.lnPx !== undefined) delete merged.lnPct;
  if (over.buSizePct !== undefined) delete merged.buSizePts;
  if (over.buSizePts !== undefined) delete merged.buSizePct;
  return merged;
}

export function resolveParagraphLevel(chain: LevelStyles[], lvl: number): ParaProps {
  let resolved: ParaProps = { rp: {} };
  for (const style of chain) {
    if (style.def) resolved = mergeParagraphProps(resolved, style.def);
    const level = style.lvls[lvl];
    if (level) resolved = mergeParagraphProps(resolved, level);
  }
  return resolved;
}

export function effectiveParagraphProps(
  props: ParaProps,
  maxSize: number,
  lnSpcReduction: number,
): Omit<NonNullable<Paragraph['editInfo']>['inheritedParagraphProps'], 'level'> {
  // spcPct 以字体单倍行高（≈1.2em）为基准，spcPts 才是绝对点值。
  let lineHeight: number | null = props.lnPct !== undefined ? props.lnPct * DEFAULT_TEXT_LINE_HEIGHT : null;
  if (lineHeight === null && props.lnPx) lineHeight = props.lnPx / maxSize;
  if (lnSpcReduction) lineHeight = Math.max(0.5, (lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT) - lnSpcReduction);
  return {
    align: ALIGN[props.algn ?? 'l'] ?? 'left',
    lineHeight,
    spaceBefore: props.spcBef ?? 0,
    spaceAfter: props.spcAft ?? 0,
    marginLeft: props.marL ?? 0,
    indent: props.indent ?? 0,
  };
}

export function directParagraphProps(
  props: ParaProps,
): NonNullable<Paragraph['editInfo']>['directParagraphProps'] {
  return {
    ...(props.lvl !== undefined ? { level: true as const } : {}),
    ...(props.algn !== undefined ? { align: true as const } : {}),
    ...(props.lnPct !== undefined || props.lnPx !== undefined ? { lineHeight: true as const } : {}),
    ...(props.spcBef !== undefined ? { spaceBefore: true as const } : {}),
    ...(props.spcAft !== undefined ? { spaceAfter: true as const } : {}),
    ...(props.marL !== undefined ? { marginLeft: true as const } : {}),
    ...(props.indent !== undefined ? { indent: true as const } : {}),
  };
}
