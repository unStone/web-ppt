import { textRunDirectFlags } from '../edit-metadata';
import type { TextFontSlots, TextRunDirectFlags } from '../edit-metadata';
import type { TextRun } from '../types';
import { pt100 } from '../xml';
import type { RunProps, TextEnv } from './text';

function effectiveFontSlots(rp: RunProps, env: TextEnv): TextFontSlots {
  // run 里没写 a:latin 不等于「没有字体」——继承链最终落在主题 minorFont。
  return {
    latin: rp.latin ?? env.fonts.minor.latin,
    eastAsian: rp.ea ?? env.fonts.minor.ea,
    complexScript: rp.cs ?? env.fonts.minor.cs ?? null,
  };
}

function fontStack(slots: TextFontSlots): string[] {
  const { latin, eastAsian: ea, complexScript: cs } = slots;
  const fonts: string[] = [];
  if (latin) fonts.push(latin);
  if (ea && ea !== latin) fonts.push(ea);
  if (cs && cs !== latin && cs !== ea) fonts.push(cs);
  return fonts;
}

function decorationProps(
  rp: RunProps,
): Pick<TextRun, 'u' | 'strike'> & Partial<Pick<TextRun, 'underline' | 'strikeType'>> {
  const underline = rp.u ?? 'none';
  const strikeType = rp.strike ?? 'noStrike';
  return {
    u: underline !== 'none',
    strike: strikeType !== 'noStrike',
    ...(underline !== 'none' ? { underline } : {}),
    ...(strikeType !== 'noStrike' ? { strikeType } : {}),
  };
}

function effectiveRunProps(rp: RunProps, env: TextEnv): {
  readonly props: NonNullable<TextRun['editInfo']>['inheritedRunProps'];
  readonly fontSlots: TextFontSlots;
} {
  const fontSlots = effectiveFontSlots(rp, env);
  return { fontSlots, props: {
    b: rp.b ?? false,
    i: rp.i ?? false,
    ...decorationProps(rp),
    size: pt100(rp.sz ?? 1800),
    color: rp.color ?? env.defaultColor ?? 'rgb(0,0,0)',
    fonts: fontStack(fontSlots),
    baseline: rp.baseline || undefined,
    spacing: rp.spc || undefined,
    caps: rp.caps && rp.caps !== 'none' ? rp.caps : undefined,
    outline: rp.outline ?? null,
    gradient: rp.gradient ?? null,
    highlight: rp.highlight ?? null,
    underlineColor: rp.uColor ?? null,
    ...(rp.gradientFill !== undefined ? { gradientFill: rp.gradientFill } : {}),
    ...(rp.shadowEffect !== undefined ? { shadow: rp.shadow, shadowEffect: rp.shadowEffect } : {}),
    ...(rp.generationIssues?.length ? { generationIssues: rp.generationIssues } : {}),
  } };
}

export function finalizeRun(
  text: string,
  rp: RunProps,
  env: TextEnv,
  inherited?: RunProps,
  direct: TextRunDirectFlags = textRunDirectFlags(0),
): TextRun {
  const effective = effectiveRunProps(rp, env);
  const inheritedEffective = env.edit && inherited ? effectiveRunProps(inherited, env) : null;
  return {
    text,
    ...effective.props,
    link: rp.link,
    ...(inheritedEffective ? { editInfo: {
      inheritedRunProps: inheritedEffective.props,
      inheritedFontSlots: inheritedEffective.fontSlots,
      direct,
      fontSlots: effective.fontSlots,
    } } : {}),
  };
}
