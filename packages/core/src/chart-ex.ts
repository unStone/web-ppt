import type { ChartEnv, ChartParser } from './chart/hook';
import { parseXml } from './xml';
import { readModel } from './chart-ex/model';
import { drawRegionMap } from './chart-ex/map';
import { draw } from './chart-ex/draw';
export { readChartExData } from './chart-ex/edit-data';
export type { ChartExDataset } from './chart-ex/edit-data';

/** 用 setChartExParser(parseChartEx) 显式启用；失败返回空结果，宿主逐对象采用 Office 回退。 */
export const parseChartEx: ChartParser = (root, width, height, env) => {
  try { const model = readModel(root, env); return model.kind === 'regionMap' ? drawRegionMap(root, model, width, height, env) : draw(model, width, height, env); } catch { return []; }
};

/** 独立 XML 入口适用于 Worker 和诊断工具，不接触 DOM 或联网。 */
export function renderChartExXml(xml: string, width: number, height: number, env: ChartEnv): ReturnType<ChartParser> {
  try { return parseChartEx(parseXml(xml), width, height, env); } catch { return []; }
}
