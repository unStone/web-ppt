import {
  paragraphLayoutDirectFlags, PARAGRAPH_LAYOUT_DIRECT_BITS,
} from '../edit-metadata';
import type { ParagraphLayoutDirectFlags, TextRunDirectFlags } from '../edit-metadata';
import type { Paragraph, ParagraphBulletInfo, TextRun } from '../types';
import { formatDrawingAutoNumber } from '../text-auto-number';
import { directParagraphProps, effectiveParagraphProps } from './paragraph-props';
import type { Bullet, ParaProps, TextEnv } from './text';

const SYMBOL_BULLETS: Record<string, string> = {
  '': '▪', '': '•', '': '➢', '': '✓',
  '': '●', '': '◆', '': '□', '': '❖',
  '§': '▪', n: '▪', l: '●', u: '◆', p: '❑', v: '❖',
  w: '♦', 'Ø': '➢', 'ü': '✓', F: '☞', q: '❑',
};

function bulletText(bullet: Bullet | undefined, counters: number[], lvl: number): string | null {
  if (!bullet || bullet.kind !== 'auto') {
    counters.length = lvl + 1;
    delete counters[lvl];
  }
  if (!bullet || bullet.kind === 'none' || bullet.kind === 'image') return null;
  if (bullet.kind === 'char') {
    const mapped = SYMBOL_BULLETS[bullet.char];
    if (mapped) return mapped;
    if (bullet.font && /wingdings|webdings|symbol/i.test(bullet.font)) return '•';
    return bullet.char;
  }
  counters.length = lvl + 1;
  counters[lvl] = (counters[lvl] ?? bullet.startAt - 1) + 1;
  return formatDrawingAutoNumber(bullet.scheme, counters[lvl]);
}

function bulletInfo(
  props: ParaProps,
  resolveImage: TextEnv['resolveImage'],
): ParagraphBulletInfo {
  const bullet = props.bullet;
  if (!bullet || bullet.kind === 'none') return { kind: 'none' };
  const style = {
    ...(props.buColor !== undefined ? { color: props.buColor } : {}),
    ...(props.buFont !== undefined ? { font: props.buFont } : {}),
    ...(props.buSizePts !== undefined
      ? { size: { kind: 'points' as const, value: props.buSizePts * 0.75 } }
      : props.buSizePct !== undefined ? { size: props.buSizePct === null
        ? null : { kind: 'percent' as const, value: props.buSizePct } } : {}),
  };
  if (bullet.kind === 'char') {
    return {
      kind: 'char', char: bullet.char,
      ...(bullet.font && style.font === undefined ? { font: bullet.font } : {}), ...style,
    };
  }
  if (bullet.kind === 'auto') {
    return { kind: 'autoNum', type: bullet.scheme, startAt: bullet.startAt, ...style };
  }
  return {
    kind: 'image', rid: bullet.rid, src: resolveImage?.(bullet.rid) ?? null, ...style,
  };
}

function directParagraphLayoutBits(props: ParaProps): ParagraphLayoutDirectFlags {
  let bits = 0;
  if (props.bullet !== undefined) bits |= PARAGRAPH_LAYOUT_DIRECT_BITS.bullet;
  if (props.buColor !== undefined) bits |= PARAGRAPH_LAYOUT_DIRECT_BITS.bulletColor;
  if (props.buFont !== undefined) bits |= PARAGRAPH_LAYOUT_DIRECT_BITS.bulletFont;
  if (props.buSizePct !== undefined || props.buSizePts !== undefined) {
    bits |= PARAGRAPH_LAYOUT_DIRECT_BITS.bulletSize;
  }
  if (props.rtl !== undefined) bits |= PARAGRAPH_LAYOUT_DIRECT_BITS.rtl;
  return paragraphLayoutDirectFlags(bits);
}

export interface ParagraphMaterialization {
  lvl: number;
  resolved: ParaProps;
  inherited: ParaProps;
  direct: ParaProps;
  directRun: TextRunDirectFlags;
  runs: TextRun[];
  counters: number[];
  lnSpcReduction: number;
  env: TextEnv;
}

/** 正文解析与版式九级模板共用同一套有效段落求值，避免继承语义漂移。 */
export function materializeParagraph(input: ParagraphMaterialization): Paragraph {
  const {
    lvl, resolved, inherited, direct, directRun,
    runs, counters, lnSpcReduction, env,
  } = input;
  const maxSize = Math.max(...runs.map((run) => run.size), 1);
  const effective = effectiveParagraphProps(resolved, maxSize, lnSpcReduction);
  const bulletImage = resolved.bullet?.kind === 'image' && env.resolveImage
    ? env.resolveImage(resolved.bullet.rid) : null;
  return {
    align: effective.align,
    lvl,
    marL: effective.marginLeft,
    indent: effective.indent,
    bullet: bulletText(resolved.bullet, counters, lvl),
    lineHeight: effective.lineHeight,
    spaceBefore: effective.spaceBefore,
    spaceAfter: effective.spaceAfter,
    runs,
    bulletColor: resolved.buColor ?? null,
    bulletFont: resolved.buFont ?? null,
    bulletSize: resolved.buSizePts !== undefined
      ? resolved.buSizePts / maxSize : resolved.buSizePct ?? null,
    bulletImage,
    rtl: resolved.rtl,
    ...(env.edit ? { editInfo: {
      inheritedParagraphProps: {
        level: 0,
        ...effectiveParagraphProps(inherited, maxSize, lnSpcReduction),
      },
      directParagraphProps: directParagraphProps(direct),
      directRun,
      directLayout: directParagraphLayoutBits(direct),
      ...(resolved.bullet?.kind === 'auto'
        ? { autoNumbering: { scheme: resolved.bullet.scheme, startAt: resolved.bullet.startAt } }
        : {}),
      bullet: bulletInfo(resolved, env.resolveImage),
      inheritedBullet: bulletInfo(inherited, env.resolveImage),
    } } : {}),
  };
}
