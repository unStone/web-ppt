export const CHART_TYPES = ['bar', 'line', 'area', 'pie', 'doughnut', 'radar', 'scatter', 'bubble'] as const;
export type ChartType = typeof CHART_TYPES[number];
export interface ChartDesign {
  type?: ChartType;
  horizontal?: boolean;
  grouping?: 'standard' | 'stacked' | 'percentStacked';
  palette?: readonly string[];
  legend?: 'none' | 'left' | 'right' | 'top' | 'bottom';
  labels?: boolean;
  title?: string;
}
