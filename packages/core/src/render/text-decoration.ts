import type { TextRun, TextUnderlineStyle } from '../types';

function underlineStyle(style: TextUnderlineStyle): string {
  if (style === 'dbl') return 'double';
  if (style === 'dotted' || style === 'dottedHeavy') return 'dotted';
  if (style.startsWith('wavy')) return 'wavy';
  if (style === 'dash' || style === 'dashHeavy' || style === 'dashLong'
    || style === 'dashLongHeavy' || style.startsWith('dotDash')
    || style.startsWith('dotDotDash')) return 'dashed';
  return 'solid';
}

const heavyUnderline = (style: TextUnderlineStyle): boolean =>
  style === 'heavy' || style.endsWith('Heavy');

/** CSS/SVG2 不能区分全部 DrawingML 线型；保留线位、双线、波浪、点划和粗细等可表达维度。 */
export function textDecorationStyles(run: TextRun): {
  readonly underline?: string;
  readonly strike?: string;
} {
  const underline = run.underline ?? (run.u ? 'sng' : 'none');
  const strike = run.strikeType ?? (run.strike ? 'sngStrike' : 'noStrike');
  const color = run.underlineColor ? `;text-decoration-color:${run.underlineColor}` : '';
  const thickness = heavyUnderline(underline) ? ';text-decoration-thickness:0.12em' : '';
  const words = underline === 'words' ? ';text-decoration-skip-spaces:all' : '';
  return {
    ...(underline !== 'none' ? {
      underline: `text-decoration-line:underline;text-decoration-style:${underlineStyle(underline)}`
        + `${color}${thickness}${words}`,
    } : {}),
    ...(strike !== 'noStrike' ? {
      strike: `text-decoration-line:line-through;text-decoration-style:${strike === 'dblStrike' ? 'double' : 'solid'}`,
    } : {}),
  };
}

export function decorateText(content: string, run: TextRun, tag: 'span' | 'tspan'): string {
  const styles = textDecorationStyles(run);
  let out = content;
  if (styles.strike) out = `<${tag} style="${styles.strike}">${out}</${tag}>`;
  if (styles.underline) out = `<${tag} style="${styles.underline}">${out}</${tag}>`;
  return out;
}

/** 项目符号只借正文 run 的字体、字号与颜色；其余字符格式由正文自身消费。 */
export function bulletTextRun(run: TextRun): TextRun {
  return {
    text: run.text,
    b: false,
    i: false,
    u: false,
    strike: false,
    size: run.size,
    color: run.color,
    fonts: [...run.fonts],
  };
}
