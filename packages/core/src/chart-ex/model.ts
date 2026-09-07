import type { ChartEnv } from '../chart/hook';
import { accentColor, parseFill, themeColor } from '../chart/util';
import type { Fill } from '../types';
import { attr, boolAttr, kid, kids, numAttr } from '../xml';
import { child, children, CX, integer, number, readDimension } from './data';
import type { Dimension } from './data';
import { workbookResolver } from './workbook';
export type Kind = 'treemap' | 'sunburst' | 'histogram' | 'pareto' | 'boxWhisker' | 'waterfall' | 'funnel' | 'regionMap';
export interface Series {
  index: number;
  name: string;
  values: (number | null)[];
  entities?: (string | null)[];
  colorCategories?: (string | null)[];
  categories: (string | null)[][];
  fill: Fill;
  points: Map<number, Fill>;
  parentLabels: 'none' | 'banner' | 'overlapping';
  totals: Set<number>;
  quartile: 'inclusive' | 'exclusive';
  outliers: boolean;
  innerPoints: boolean;
  meanMarker: boolean;
  meanLine: boolean;
  labels: boolean;
  binning: {
    size?: number;
    count?: number;
    underflow?: number;
    overflow?: number;
    closed: 'l' | 'r';
    aggregation: boolean;
  };
}
export interface ChartExModel {
  kind: Kind;
  series: Series[];
  title: string;
  background: Fill;
  textColor: string;
  fonts: string[];
  size: number;
  legend: 't' | 'b' | 'l' | 'r' | null;
}
function text(node: Element | null): string {
  const rich = child(node, 'rich');
  if (rich)
    return kids(rich, 'p').map((p) => kids(p, 'r').map((r) => kid(r, 't')?.textContent ?? '').join('')).join('\n');
  return child(child(node, 'txData'), 'v')?.textContent ?? '';
}
export function readModel(root: Element, env: ChartEnv): ChartExModel {
  if (root.namespaceURI !== CX || root.localName !== 'chartSpace')
    throw new Error('非 ChartEx');
  const chart = child(root, 'chart'), plot = child(chart, 'plotArea'), region = child(plot, 'plotAreaRegion');
  const all = children(region, 'series');
  const active = all.map((node, index) => ({ node, index })).filter(({ node }) => !boolAttr(node, 'hidden'));
  const primary = active.filter(({ node }) => attr(node, 'layoutId') !== 'paretoLine');
  const layout = primary.map(({ node }) => attr(node, 'layoutId'));
  if (!layout.length || layout.some((kind) => kind !== layout[0]))
    throw new Error('ChartEx 混合布局不支持');
  const pareto = active.filter(({ node }) => attr(node, 'layoutId') === 'paretoLine');
  if (pareto.length && (pareto.length !== 1 || primary.length !== 1 || integer(attr(pareto[0].node, 'ownerIdx')) !== primary[0].index)) {
    throw new Error('ChartEx Pareto 归属不明');
  }
  const kind = layout[0] === 'clusteredColumn' ? pareto.length ? 'pareto' : 'histogram' : layout[0];
  if (!['treemap', 'sunburst', 'histogram', 'pareto', 'boxWhisker', 'waterfall', 'funnel', 'regionMap'].includes(kind ?? '')) {
    throw new Error('ChartEx 布局不支持');
  }
  if (primary.length !== 1 && kind !== 'boxWhisker')
    throw new Error('ChartEx 可见系列不唯一');
  const resolver = workbookResolver(root, env);
  const datasets = children(child(root, 'chartData'), 'data');
  const ids = datasets.map((node) => attr(node, 'id'));
  if (new Set(ids).size !== ids.length)
    throw new Error('ChartEx dataId 重复');
  const series = primary.map(({ node, index }): Series => {
    const dataId = attr(child(node, 'dataId'), 'val');
    if (dataId === null)
      throw new Error('ChartEx dataId 缺失');
    const data = datasets.find((d) => attr(d, 'id') === dataId);
    if (!data)
      throw new Error('ChartEx 数据不存在');
    const dims = [...children(data, 'strDim'), ...children(data, 'numDim')].map((d) => readDimension(d, resolver));
    const dimension = (type: string, required = true): Dimension | undefined => {
      const matches = dims.filter((d) => d.type === type);
      if (matches.length > 1 || required && matches.length !== 1)
        throw new Error('ChartEx 维度歧义');
      return matches[0];
    };
    const values = kind === 'regionMap' ? dimension('colorVal', false) ?? dimension('val', false) ?? dimension('colorStr')! : dimension(kind === 'treemap' || kind === 'sunburst' ? 'size' : 'val')!;
    const entities = kind === 'regionMap' ? dimension('entityId', false) : undefined;
    const cat = dimension('cat', false);
    if (!values.numeric && !(kind === 'regionMap' && values.type === 'colorStr') || values.levels.length !== 1 || cat?.numeric)
      throw new Error('ChartEx 数据类型不匹配');
    const colorCategories = !values.numeric ? values.levels[0] as (string | null)[] : undefined;
    const palette = [...new Set(colorCategories?.filter((v) => v !== null))];
    const nums = colorCategories ? colorCategories.map((v) => v === null ? null : palette.indexOf(v)) : values.levels[0] as (number | null)[];
    if (cat?.levels.some((level) => level.length !== nums.length))
      throw new Error('ChartEx 类别与数值错位');
    const props = child(node, 'layoutPr'), bins = child(props, 'binning'), stats = child(props, 'statistics');
    const visibility = child(props, 'visibility');
    const binNumber = (name: string): number | undefined => {
      const raw = attr(bins, name);
      return raw === null || raw === 'auto' ? undefined : number(raw);
    };
    const binSize = child(bins, 'binSize'), binCount = child(bins, 'binCount');
    if (binSize && binCount)
      throw new Error('ChartEx 分箱配置冲突');
    const quartile = attr(stats, 'quartileMethod') ?? 'exclusive';
    const parentLabels = attr(child(props, 'parentLabelLayout'), 'val') ?? 'overlapping';
    const closed = attr(bins, 'intervalClosed') ?? 'r';
    if (!['inclusive', 'exclusive'].includes(quartile) || !['none', 'banner', 'overlapping'].includes(parentLabels) || !['l', 'r'].includes(closed)) {
      throw new Error('ChartEx 布局参数无效');
    }
    const color = accentColor(env.ctx, numAttr(node, 'formatIdx') ?? index);
    const fill = parseFill(child(node, 'spPr'), env.ctx) ?? { type: 'solid', color };
    const points = new Map<number, Fill>();
    for (const point of children(node, 'dataPt')) {
      const at = integer(attr(point, 'idx'));
      if (at >= nums.length || points.has(at))
        throw new Error('ChartEx 点格式越界');
      points.set(at, parseFill(child(point, 'spPr'), env.ctx) ?? fill);
    }
    const totals = new Set(children(child(props, 'subtotals'), 'idx').map((n) => integer(attr(n, 'val'))));
    if ([...totals].some((i) => i >= nums.length))
      throw new Error('ChartEx 小计索引越界');
    return { index, name: text(child(node, 'tx')), values: nums,
      ...(entities ? { entities: entities.levels[0] as (string | null)[] } : {}), ...(colorCategories ? { colorCategories } : {}),
      categories: cat?.levels as (string | null)[][] ?? [], fill, points, totals,
      parentLabels: parentLabels as Series['parentLabels'], quartile: quartile as Series['quartile'],
      outliers: boolAttr(visibility, 'outliers', true), innerPoints: boolAttr(visibility, 'nonoutliers'),
      meanMarker: boolAttr(visibility, 'meanMarker', true), meanLine: boolAttr(visibility, 'meanLine'),
      labels: child(node, 'dataLabels') !== null,
      binning: { size: binSize ? number(binSize.textContent) : undefined,
        count: binCount ? integer(binCount.textContent, 1000) : undefined,
        underflow: binNumber('underflow'), overflow: binNumber('overflow'), closed: closed as 'l' | 'r',
        aggregation: child(props, 'aggregation') !== null },
    };
  });
  const fontSize = numAttr(kid(kid(kid(child(root, 'txPr'), 'p'), 'pPr'), 'defRPr'), 'sz');
  return { kind: kind as Kind, series, title: text(child(child(chart, 'title'), 'tx')),
    background: parseFill(child(root, 'spPr'), env.ctx) ?? { type: 'solid', color: '#ffffff' },
    textColor: themeColor(env.ctx, 'tx1'), fonts: [env.fonts.minor.latin, env.fonts.minor.ea].filter((f): f is string => !!f),
    size: fontSize && fontSize > 0 ? fontSize / 75 : 14,
    legend: child(chart, 'legend') ? (attr(child(chart, 'legend'), 'pos') ?? 'b') as ChartExModel['legend'] : null };
}
