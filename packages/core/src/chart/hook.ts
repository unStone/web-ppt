import type { SlideElement } from '../types';
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
}

/** 读 chart XML，产出统一 Schema 的元素 —— 这是解析，不是渲染 */
export type ChartParser = (chartRoot: Element, w: number, h: number, env: ChartEnv) => SlideElement[];

/** @deprecated 名不副实：它产出 Schema 而非 SVG。改用 {@link ChartParser} */
export type ChartRenderer = ChartParser;

let parser: ChartParser | null = null;

/** 由 index.ts 在启动时注入真正的图表解析器 */
export function setChartParser(fn: ChartParser): void {
  parser = fn;
}

/** @deprecated 改用 {@link setChartParser} */
export const setChartRenderer = setChartParser;

export function getChartParser(): ChartParser | null {
  return parser;
}
