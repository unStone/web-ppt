import type { SlideId } from '../types';

/** ECMA-376 全部 16 种经典绘图类型（plotArea 图组标签一一对应） */
export const CLASSIC_CHART_KINDS = [
  'area',
  'area3D',
  'bar',
  'bar3D',
  'bubble',
  'doughnut',
  'line',
  'line3D',
  'ofPie',
  'pie',
  'pie3D',
  'radar',
  'scatter',
  'stock',
  'surface',
  'surface3D',
] as const;
export type ClassicChartKind = (typeof CLASSIC_CHART_KINDS)[number];

/** ChartEx 七类（cx:series layoutId 一一对应） */
export const CHARTEX_KINDS = ['boxWhisker', 'funnel', 'histogram', 'paretoLine', 'sunburst', 'treemap', 'waterfall'] as const;
export type ChartExKind = (typeof CHARTEX_KINDS)[number];

export type ChartKind = ClassicChartKind | ChartExKind;

/** XY 图的系列带 x 值；气泡再带 sizes */
export interface AddChartSeries {
  readonly name: string;
  readonly values: readonly (number | null)[];
  readonly x?: readonly (number | null)[];
  readonly sizes?: readonly (number | null)[];
}

export interface AddChartData {
  kind: ChartKind;
  title?: string;
  /** sunburst / treemap 用「/」分隔层级路径（A/B/C），其余图组是平铺类目 */
  categories: readonly string[];
  series: readonly AddChartSeries[];
  /** 柱 / 条方向（bar / bar3D） */
  barDir?: 'col' | 'bar';
  /** bar / bar3D / area / area3D 的分组 */
  grouping?: 'clustered' | 'stacked' | 'percentStacked' | 'standard';
  /** 复合饼的次图形态 */
  ofPieType?: 'pie' | 'bar';
}

export interface AddChartCommand {
  readonly type: 'AddChart';
  readonly slideId: SlideId;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly chart: AddChartData;
}
