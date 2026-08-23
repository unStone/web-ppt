import type { TextRun } from '../types';
import { isFullWidth } from './cjk-punct';
import { layoutMath } from './math-svg';
import type { MathLayout } from './math-svg';

const MATH_FAMILY = "'Cambria Math','Latin Modern Math','STIX Two Math','Times New Roman',serif";
const FALLBACK = [`'PingFang SC'`, `'Hiragino Sans GB'`, `'Microsoft YaHei'`, 'sans-serif'];

/** 自定义文字宽度测量；返回值是整个字符串含字距后的 px 宽度。 */
export type TextMeasure = (text: string, run: Readonly<TextRun>, scale: number) => number;

let measureCtx: CanvasRenderingContext2D | null = null;
let measureProbed = false;

/** 拿不到 Canvas 时缓存这个结论，避免 Node / Worker 每次测字都创建 canvas。 */
function ctx2d(): CanvasRenderingContext2D | null {
  if (measureProbed) return measureCtx;
  measureProbed = true;
  try {
    const context = document.createElement('canvas').getContext('2d');
    measureCtx = context && typeof context.measureText === 'function' ? context : null;
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

function stack(fonts: readonly string[], fallback: readonly string[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const font of fonts) {
    const key = font.toLowerCase();
    if (font && !seen.has(key)) {
      seen.add(key);
      out.push(`'${font}'`);
    }
  }
  for (const font of fallback) {
    const key = font.replace(/'/g, '').toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(font);
    }
  }
  return out.join(',');
}

export function fontFamily(run: TextRun): string {
  return run.fonts.length ? stack(run.fonts, FALLBACK) : stack(['Helvetica', 'Arial'], FALLBACK);
}

export function fontSize(run: TextRun, scale: number): number {
  const base = run.size * scale;
  return run.baseline ? base * 0.65 : base;
}

function mathMeasure(text: string, size: number, italic: boolean, bold: boolean): number {
  const context = ctx2d();
  if (!context) return text.length * size * 0.55;
  context.font = `${italic ? 'italic ' : ''}${bold ? '700 ' : '400 '}${size}px ${MATH_FAMILY}`;
  return context.measureText(text).width;
}

const mathCache = new Map<string, MathLayout>();

export function mathOf(run: TextRun, scale: number): MathLayout | null {
  if (!run.math?.length) return null;
  const size = run.size * scale;
  const key = `${size}|${run.color}|${JSON.stringify(run.math)}`;
  let hit = mathCache.get(key);
  if (!hit) {
    hit = layoutMath(run.math, size, run.color, mathMeasure);
    if (mathCache.size > 512) mathCache.clear();
    mathCache.set(key, hit);
  }
  return hit;
}

export function measureTextWidth(
  text: string,
  run: TextRun,
  scale: number,
  measurer?: TextMeasure,
): number {
  if (measurer) {
    const width = measurer(text, run, scale);
    return Number.isFinite(width) && width > 0 ? width : 0;
  }
  if (run.math?.length) return mathOf(run, scale)?.w ?? 0;
  if (!text) return 0;
  const context = ctx2d();
  const size = fontSize(run, scale);
  if (!context) {
    let width = 0;
    for (const char of text) width += isFullWidth(char) ? size : size * 0.55;
    return width;
  }
  context.font = `${run.i ? 'italic ' : ''}${run.b ? '700 ' : '400 '}${size}px ${fontFamily(run)}`;
  return context.measureText(text).width + (run.spacing ?? 0) * text.length;
}
