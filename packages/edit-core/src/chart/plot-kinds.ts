import type { ChartPlotKind } from './types';

export const CHART_PLOTS: Readonly<Record<string, ChartPlotKind>> = {
  barChart: 'bar', bar3DChart: 'bar', lineChart: 'line', line3DChart: 'line',
  pieChart: 'pie', pie3DChart: 'pie', doughnutChart: 'doughnut',
  areaChart: 'area', area3DChart: 'area', scatterChart: 'scatter', bubbleChart: 'bubble',
  radarChart: 'radar', stockChart: 'stock', ofPieChart: 'ofPie',
  surfaceChart: 'surface', surface3DChart: 'surface',
};
