import type { SlideElement } from '../types';
import type { ColorCtx } from '../pptx/color';
import type { ThemeFonts } from '../pptx/text';

export interface ChartEnv {
  ctx: ColorCtx;
  fonts: ThemeFonts;
  rels: Record<string, { type: string; target: string }>;
}

export type ChartRenderer = (chartRoot: Element, w: number, h: number, env: ChartEnv) => SlideElement[];

let renderer: ChartRenderer | null = null;

/** 由 index.ts 在启动时注入真正的图表渲染器，保持解析器与图表模块解耦 */
export function setChartRenderer(fn: ChartRenderer): void {
  renderer = fn;
}

export function getChartRenderer(): ChartRenderer | null {
  return renderer;
}
