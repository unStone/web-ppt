import type { TextRun } from '../types';
import { isFullWidth } from './cjk-punct';
import { layoutMath } from './math-svg';
import type { MathLayout } from './math-svg';
import { escapeCssString } from './serialize';

const MATH_FAMILY = "'Cambria Math','Latin Modern Math','STIX Two Math','Times New Roman',serif";
const FALLBACK = [`'PingFang SC'`, `'Hiragino Sans GB'`, `'Microsoft YaHei'`, 'sans-serif'];
/**
 * 等线缺席时的西文替身。按 issue #8 附带的 PowerPoint 导出图逐词拟合：常规体西文前进宽度
 * 约为 Arial 的 0.996 倍，粗体约 0.954 倍，下划线只有 0.415em（Arial 为 0.556em）。
 * CJK 回退字体自带的西文宽出 6% 以上，断行会整体提前。
 *
 * 合成字族用 local() 引用系统 Arial 度量族，再按实测 size-adjust：粗体整体缩到 95.4%，
 * 下划线单独缩到 74.6%（填空线由连续下划线组成，长度直接决定它落在哪一行）。代价是粗体
 * 字形也随之变小——宽度与字高不能同时对上，断行一致优先。它只在页面 <style> 里声明，
 * 字体栈里排在 '等线' 之后：真装了等线时原字体先生效。`@web-ppt/fonts` 的替换路径
 * 对 Arimo 套用同一组参数（测试断言两边数值一致）。
 */
export const DENGXIAN_LATIN_METRICS = { boldSizeAdjust: 95.4, underscoreSizeAdjust: 74.6 } as const;
export const DENGXIAN_LATIN_FAMILY = 'WebPPT DengXian Latin';
const DENGXIAN_LATIN_FALLBACK = [`'${DENGXIAN_LATIN_FAMILY}'`, `'Arial'`, `'Helvetica'`, `'Arimo'`, `'Liberation Sans'`];
const ARIAL_REGULAR = ['Arial', 'ArialMT', 'Helvetica', 'Arimo', 'Arimo-Regular', 'Liberation Sans', 'LiberationSans'];
const ARIAL_BOLD = ['Arial Bold', 'Arial-BoldMT', 'Helvetica Bold', 'Helvetica-Bold', 'Arimo Bold', 'Arimo-Bold',
  'Liberation Sans Bold', 'LiberationSans-Bold'];

function isDengXian(run: Pick<TextRun, 'fonts'>): boolean {
  return /^(等线|dengxian)$/i.test(run.fonts[0] ?? '');
}

/** 合成字族的 @font-face；页面里出现等线西文时由 renderSlideToSvg 放进根 <style>。 */
export function dengXianLatinFontFaces(): string {
  const { boldSizeAdjust, underscoreSizeAdjust } = DENGXIAN_LATIN_METRICS;
  const face = (names: readonly string[], weight: string, extra: string): string =>
    `@font-face{font-family:'${DENGXIAN_LATIN_FAMILY}';src:${names.map((name) => `local('${name}')`).join(',')};`
    + `font-weight:${weight};${extra}}`;
  // 同字重的面按声明逆序匹配 unicode-range，下划线面必须写在整体面之后。
  return face(ARIAL_REGULAR, '1 599', '')
    + face(ARIAL_BOLD, '600 1000', `size-adjust:${boldSizeAdjust}%;`)
    + face(ARIAL_REGULAR, '1 599', `unicode-range:U+5F;size-adjust:${underscoreSizeAdjust}%;`)
    + face(ARIAL_BOLD, '600 1000', `unicode-range:U+5F;size-adjust:${underscoreSizeAdjust}%;`);
}

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
      out.push(`'${escapeCssString(font)}'`);
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
  const fallback = isDengXian(run) ? [...DENGXIAN_LATIN_FALLBACK, ...FALLBACK] : FALLBACK;
  return run.fonts.length ? stack(run.fonts, fallback) : stack(['Helvetica', 'Arial'], fallback);
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

/**
 * 字体环境变化（网络字体到货、嵌入字体经 FontFace 注册）后作废按度量缓存的布局结论。
 * 宽度本身每次现量（canvas 会用已加载的字体），唯一按字体定型的是数学布局缓存；
 * 幂等，重复调用只是空清理。
 */
export function invalidateTextMeasureCaches(): void {
  mathCache.clear();
}

export function measureTextWidth(
  text: string,
  run: TextRun,
  scale: number,
  measurer?: TextMeasure,
): number {
  // 数学公式布局自带测量（mathMeasure 用专用数学字体栈），不经外部 measurer——
  // 注入测字（Node 的 withFontMeasurement）遇到公式 run 时走这里，而不是整页拒绝。
  if (run.math?.length) return mathOf(run, scale)?.w ?? 0;
  if (measurer) {
    const width = measurer(text, run, scale);
    return Number.isFinite(width) && width > 0 ? width : 0;
  }
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
