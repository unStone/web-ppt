import { parseChart } from './chart';
import type { ChartEnv } from './chart';
import type { SlideElement } from './types';
import { parseXml } from './xml';

/** 按需图表编辑入口用现有解析器重建投影，不把 XML 入口加入默认 core。 */
export function renderChartXml(
  xml: string, width: number, height: number, env: ChartEnv,
): SlideElement[] {
  return parseChart(parseXml(xml), width, height, env);
}
