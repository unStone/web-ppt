import {
  paragraphLayoutDirectFlags, PARAGRAPH_LAYOUT_DIRECT_BITS,
} from '../edit-metadata';
import type { ParagraphLayoutDirectFlags, TextRunDirectFlags } from '../edit-metadata';
import type { Paragraph, TextRun } from '../types';
import { directParagraphProps, effectiveParagraphProps } from './paragraph-props';
import type { Bullet, ParaProps, TextEnv } from './text';

const SYMBOL_BULLETS: Record<string, string> = {
  '': '▪', '': '•', '': '➢', '': '✓',
  '': '●', '': '◆', '': '□', '': '❖',
  '§': '▪', n: '▪', l: '●', u: '◆', p: '❑', v: '❖',
  w: '♦', 'Ø': '➢', 'ü': '✓', F: '☞', q: '❑',
};

function alpha(num: number): string {
  let value = '';
  while (num > 0) {
    value = String.fromCharCode(65 + ((num - 1) % 26)) + value;
    num = Math.floor((num - 1) / 26);
  }
  return value;
}

function roman(num: number): string {
  const table: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let value = '';
  for (const [amount, symbol] of table) while (num >= amount) { value += symbol; num -= amount; }
  return value;
}

function formatAutoNum(scheme: string, num: number): string {
  let body: string;
  if (scheme.startsWith('alphaLc')) body = alpha(num).toLowerCase();
  else if (scheme.startsWith('alphaUc')) body = alpha(num);
  else if (scheme.startsWith('romanLc')) body = roman(num).toLowerCase();
  else if (scheme.startsWith('romanUc')) body = roman(num);
  else if (scheme.startsWith('circleNum')) {
    body = num >= 1 && num <= 20 ? String.fromCharCode(0x2460 + num - 1) : String(num);
  } else body = String(num);
  if (scheme.endsWith('ParenBoth')) return `(${body})`;
  if (scheme.endsWith('ParenR')) return `${body})`;
  if (scheme.endsWith('Period')) return `${body}.`;
  return body;
}

function bulletText(bullet: Bullet | undefined, counters: number[], lvl: number): string | null {
  if (!bullet || bullet.kind === 'none' || bullet.kind === 'image') return null;
  if (bullet.kind === 'char') {
    const mapped = SYMBOL_BULLETS[bullet.char];
    if (mapped) return mapped;
    if (bullet.font && /wingdings|webdings|symbol/i.test(bullet.font)) return '•';
    return bullet.char;
  }
  counters.length = lvl + 1;
  counters[lvl] = (counters[lvl] ?? bullet.startAt - 1) + 1;
  return formatAutoNum(bullet.scheme, counters[lvl]);
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
      inheritedParagraphProps: effectiveParagraphProps(inherited, maxSize, lnSpcReduction),
      directParagraphProps: directParagraphProps(direct),
      directRun,
      directLayout: directParagraphLayoutBits(direct),
    } } : {}),
  };
}
