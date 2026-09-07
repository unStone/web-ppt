import type { ChartEnv } from '../chart/hook';
import { attr, parseXml } from '../xml';
import { child, children, CX, integer, readDimension } from './data';
import type { Dimension } from './data';
import { workbookResolver } from './workbook';

export interface ChartExDataset {
  id: string;
  dimensions: Dimension[];
}

/** 缓存和工作簿通过渲染器同一入口读取，编辑器不会把缺失点、空串和零混为一谈。 */
export function readChartExData(xml: string, env: ChartEnv): ChartExDataset[] {
  const root = parseXml(xml);
  if (root.namespaceURI !== CX || root.localName !== 'chartSpace') throw new Error('非 ChartEx 数据');
  const resolve = workbookResolver(root, env), seen = new Set<string>();
  return children(child(root, 'chartData'), 'data').map((data) => {
    const id = attr(data, 'id'); integer(id, 0xffff_ffff);
    if (seen.has(id!)) throw new Error('ChartEx 数据身份重复');
    seen.add(id!);
    return { id: id!, dimensions: Array.from(data.children)
      .filter((node) => node.namespaceURI === CX && ['strDim', 'numDim'].includes(node.localName))
      .map((node) => readDimension(node, resolve)) };
  });
}
