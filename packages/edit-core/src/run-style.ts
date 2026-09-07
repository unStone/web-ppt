import type { TextRun, TextStrikeStyle, TextUnderlineStyle } from '@web-ppt/core';
import type { RunProperties, RunPropertyOverrides, TextMark } from './types';
import { STYLE_PROPERTY_FIELDS } from './run-property-fields';
import { own } from './data-validation';

export { STYLE_PROPERTY_FIELDS } from './run-property-fields';
const RUN_OVERRIDE_FIELDS = [...STYLE_PROPERTY_FIELDS, 'u', 'strike', 'link'] as const;

export const underlineOf = (run: Pick<TextRun, 'u' | 'underline'>): TextUnderlineStyle =>
  run.underline ?? (run.u ? 'sng' : 'none');
export const strikeTypeOf = (run: Pick<TextRun, 'strike' | 'strikeType'>): TextStrikeStyle =>
  run.strikeType ?? (run.strike ? 'sngStrike' : 'noStrike');

export function runProperties(run: Omit<TextRun, 'text'>): RunProperties {
  return {
    font: run.fonts[0] ?? null, size: run.size, color: run.color,
    b: run.b, i: run.i, u: run.u, strike: run.strike,
    underline: underlineOf(run), strikeType: strikeTypeOf(run),
    highlight: run.highlight ?? null, spacing: run.spacing ?? 0,
    caps: run.caps ?? 'none', baseline: run.baseline ?? 0,
  };
}

export const DEFAULT_RUN: Omit<TextRun, 'text'> = {
  b: false, i: false, u: false, strike: false, size: 18, color: '#000000', fonts: [],
};

export const DEFAULT_PROPERTIES: RunProperties = runProperties(DEFAULT_RUN);

/** DrawingML 没有 highlight="none"；透明直设用于覆盖版式/母版的继承高亮。 */
export const NO_HIGHLIGHT = 'rgba(0,0,0,0)';

export function visibleHighlight(value: string | null | undefined): string | null {
  if (!value) return null;
  const alpha = /^rgba\([^)]*,\s*([\d.]+)\s*\)$/i.exec(value)?.[1];
  return alpha !== undefined && Number(alpha) === 0 ? null : value;
}

export function sameRunOverrides(left?: RunPropertyOverrides, right?: RunPropertyOverrides): boolean {
  return RUN_OVERRIDE_FIELDS.every((field) => own(left ?? {}, field)
    === own(right ?? {}, field)
    && Object.is(left?.[field], right?.[field]));
}

export function sameInherited(left?: RunProperties, right?: RunProperties): boolean {
  return STYLE_PROPERTY_FIELDS.every((field) => Object.is(left?.[field], right?.[field]));
}

function canonicalInput(props: RunPropertyOverrides): RunPropertyOverrides {
  const out: Record<string, unknown> = { ...props };
  if (own(props, 'u')) {
    out.underline = props.u === null ? null : props.u ? 'sng' : 'none';
    delete out.u;
  }
  if (own(props, 'strike')) {
    out.strikeType = props.strike === null ? null : props.strike ? 'sngStrike' : 'noStrike';
    delete out.strike;
  }
  return out as RunPropertyOverrides;
}

function canonicalOverrides(props?: RunPropertyOverrides): Record<string, unknown> {
  if (!props) return {};
  const out: Record<string, unknown> = { ...props };
  // 旧恢复数据可能只保存布尔别名；先迁移为精确值，编辑其他字段时才不会丢掉直设来源。
  if (own(props, 'u') && !own(props, 'underline')) {
    out.underline = props.u === null ? null : props.u ? 'sng' : 'none';
  }
  if (own(props, 'strike') && !own(props, 'strikeType')) {
    out.strikeType = props.strike === null ? null : props.strike ? 'sngStrike' : 'noStrike';
  }
  delete out.u;
  delete out.strike;
  return out;
}

function optional<T>(value: T, empty: T): T | undefined {
  return Object.is(value, empty) ? undefined : value;
}

export function formattedMark(mark: TextMark, input: RunPropertyOverrides): TextMark {
  const props = canonicalInput(input);
  const inherited = mark.inheritedProps ?? DEFAULT_PROPERTIES;
  const nextOverrides = canonicalOverrides(mark.runOverrides);
  for (const field of STYLE_PROPERTY_FIELDS) {
    if (own(props, field)) nextOverrides[field] = props[field];
  }
  if (own(props, 'link')) {
    if (props.link === null) delete nextOverrides.link;
    else nextOverrides.link = props.link;
  }
  const effective = { ...runProperties(mark.props) };
  for (const field of STYLE_PROPERTY_FIELDS) {
    if (!own(props, field)) continue;
    const value = props[field];
    (effective as unknown as Record<string, unknown>)[field] = value === null
      ? inherited[field] : value;
  }
  const underline = effective.underline;
  const strikeType = effective.strikeType;
  const nextProps = {
    ...mark.props,
    fonts: effective.font ? [effective.font] : [],
    size: effective.size, color: effective.color, b: effective.b, i: effective.i,
    u: underline !== 'none', strike: strikeType !== 'noStrike',
    underline: optional(underline, 'none'), strikeType: optional(strikeType, 'noStrike'),
    highlight: effective.highlight,
    spacing: optional(effective.spacing, 0), caps: optional(effective.caps, 'none'),
    baseline: optional(effective.baseline, 0),
  };
  if (props.font === null) {
    nextProps.fonts = [...(mark.inheritedFonts ?? (inherited.font ? [inherited.font] : []))];
  }
  return {
    ...mark, props: nextProps,
    ...(Object.keys(nextOverrides).length
      ? { runOverrides: nextOverrides as RunPropertyOverrides }
      : { runOverrides: undefined }),
  };
}

export function clearedMark(mark: TextMark): TextMark {
  const inheritedSource = mark.inheritedRunProps ?? mark.props;
  const inherited = mark.inheritedProps ?? runProperties(inheritedSource);
  const underline = inheritedSource.underline ?? (inheritedSource.u ? 'sng' : inherited.underline);
  const strikeType = inheritedSource.strikeType
    ?? (inheritedSource.strike ? 'sngStrike' : inherited.strikeType);
  const props = {
    ...mark.props,
    b: inheritedSource.b, i: inheritedSource.i,
    u: underline !== 'none', strike: strikeType !== 'noStrike',
    underline: optional(underline, 'none'), strikeType: optional(strikeType, 'noStrike'),
    size: inheritedSource.size, color: inheritedSource.color,
    fonts: [...(mark.inheritedFonts ?? inheritedSource.fonts)],
    baseline: optional(inheritedSource.baseline ?? 0, 0),
    spacing: optional(inheritedSource.spacing ?? 0, 0),
    caps: optional(inheritedSource.caps ?? 'none', 'none'),
    outline: inheritedSource.outline ?? null,
    gradient: inheritedSource.gradient ?? null,
    gradientFill: inheritedSource.gradientFill ?? null,
    shadow: inheritedSource.shadow ?? null,
    shadowEffect: inheritedSource.shadowEffect ?? null,
    generationIssues: inheritedSource.generationIssues,
    highlight: inheritedSource.highlight ?? null,
    underlineColor: inheritedSource.underlineColor ?? null,
  };
  const link = mark.runOverrides && own(mark.runOverrides, 'link')
    ? { link: mark.runOverrides.link } : undefined;
  return {
    ...mark, props, clearDirectFormatting: true,
    ...(link ? { runOverrides: link } : { runOverrides: undefined }),
  };
}
