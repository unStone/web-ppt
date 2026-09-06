import type { OpcPackage, SlideElement } from '../types';
import type { ColorCtx } from '../pptx/color';
import type { ThemeFonts } from '../pptx/text';

/**
 * 图表【解析器】的注入点。
 *
 * chart/ 读的是 ppt/charts/chart1.xml —— 那本身就是 OOXML/DrawingML，
 * 所以 ChartEnv 携带 ColorCtx 与 ThemeFonts 是正当复用，不是层次泄漏：
 * 图表要按主题色和主题字体解析自己的 XML。
 *
 * 之所以经 hook 注入而不是直接 import，有两个与「格式无关性」无关的原因：
 *   1. 打破 pptx/parser → chart → pptx/color 的模块环
 *   2. 不用图表的使用者可以把这 3637 行 tree-shake 掉
 */
export interface ChartEnv {
  ctx: ColorCtx;
  fonts: ThemeFonts;
  rels: Record<string, { type: string; target: string }>;
  /** 按需解析器只能读取包内字节，不拥有网络或资源生命周期。 */
  readPart?: (path: string) => Uint8Array | undefined;
}

/** 读 chart XML，产出统一 Schema 的元素 —— 这是解析，不是渲染 */
export type ChartParser = (chartRoot: Element, w: number, h: number, env: ChartEnv) => SlideElement[];

/** @deprecated 名不副实：它产出 Schema 而非 SVG。改用 {@link ChartParser} */
export type ChartRenderer = ChartParser;

let parser: ChartParser | null = null;
let extendedParser: ChartParser | null = null;
const extendedSessions = new WeakMap<object, ChartParser>();

/** 默认文稿没有常驻附加字段；已打开文稿的惰性页面必须固定当时的解析能力。 */
export function captureChartExParser(target: object, source?: object): void {
  const current = source ? extendedSessions.get(source) : extendedParser;
  if (current) extendedSessions.set(target, current);
  else extendedSessions.delete(target);
}

/** 派生包继续属于原文稿，不能因保存或设计投影换句柄而改变解析语义。 */
export function inheritPptxParsingContext(source: OpcPackage, target: OpcPackage): OpcPackage {
  captureChartExParser(target, source);
  return target;
}

/** 传 null 恢复 Office 预览；默认入口不引入 ChartEx 实现。 */
export function setChartExParser(fn: ChartParser | null): void {
  extendedParser = fn;
}

export function supportsChartEx(namespace: string, source: object): boolean {
  return extendedSessions.has(source) && /^http:\/\/schemas.microsoft.com\/office\/drawing\/(2014|2015\/9\/8|2015\/10\/21|2016\/5\/(9|10|11|12|13|14|15))\/chartex$/.test(namespace);
}

/** 由 index.ts 在启动时注入真正的图表解析器 */
export function setChartParser(fn: ChartParser): void {
  parser = fn;
}

/** @deprecated 改用 {@link setChartParser} */
export const setChartRenderer = setChartParser;

export function getChartParser(extended = false, source?: object): ChartParser | null {
  return extended ? source ? extendedSessions.get(source) ?? null : extendedParser : parser;
}
