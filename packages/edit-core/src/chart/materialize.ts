import {
  cloneXmlNode, cloneXmlNodeWithNamespaceClosure, parseXmlTree,
  removeXmlChild, serializeXmlTree, setXmlAttribute,
} from '@web-ppt/edit-core/xml';
import type { XmlDocument, XmlElement, XmlNode } from '@web-ppt/edit-core/xml';
import type {
  ChartDatasetState, ChartFormulaBinding, ChartPlotKind, ChartPointId, ChartSeriesId,
} from './types';
import { resizedChartFormula } from './formula';
import { readChartIdentityManifest, writeChartIdentityManifest } from './identity';
import type { ChartIdentityTemplate } from './identity';
import { orderedChartRecords } from './ordering';
import { MAX_CHART_POINTS } from './validation';
import { canonicalNumericCategories } from './category-value';
import {
  CHART_NS, DRAWING_NS, STRICT_CHART_NS, STRICT_DRAWING_NS,
} from './xml-namespaces';
import {
  chartXml, xmlAttribute as attr, appendXml as append, makeDataElement as make, setDataText as setText,
} from './xml-data';
import { CHART_PLOTS as PLOTS } from './plot-kinds';

const { child, children } = chartXml;

function ensure(parent: XmlElement, name: string, before: XmlNode | null = null): XmlElement {
  const current = child(parent, name);
  if (current) return current;
  const created = make(parent, name);
  append(parent, created, before);
  return created;
}

function replaceElement(parent: XmlElement, current: XmlElement, name: string): XmlElement {
  const index = parent.children.indexOf(current);
  const before = index < 0 ? null : parent.children[index + 1] ?? null;
  const replacement = make(parent, name,
    current.attributes.map((item) => [item.name, item.value] as const));
  for (const node of [...current.children]) {
    removeXmlChild(current, node);
    append(replacement, node);
  }
  removeXmlChild(parent, current);
  append(parent, replacement, before);
  return replacement;
}

const CATEGORY_SERIES_ORDER = [
  'idx', 'order', 'tx', 'spPr', 'invertIfNegative', 'pictureOptions', 'explosion', 'marker',
  'dPt', 'dLbls', 'trendline', 'errBars', 'cat', 'val', 'shape', 'smooth', 'extLst',
] as const;
const XY_SERIES_ORDER = [
  'idx', 'order', 'tx', 'spPr', 'invertIfNegative', 'marker', 'dPt', 'dLbls', 'trendline',
  'errBars', 'xVal', 'yVal', 'bubbleSize', 'bubble3D', 'smooth', 'extLst',
] as const;

function ensureSeriesChild(
  series: XmlElement, name: string, plotKind: ChartPlotKind,
): XmlElement {
  const sequence: readonly string[] = plotKind === 'scatter' || plotKind === 'bubble'
    ? XY_SERIES_ORDER : CATEGORY_SERIES_ORDER;
  const rank = (localName: string): number => {
    const index = sequence.indexOf(localName);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  let current = child(series, name);
  const elements = children(series);
  const targetRank = rank(name);
  const currentIndex = current ? elements.indexOf(current) : -1;
  const misplaced = currentIndex >= 0 && (elements.slice(0, currentIndex)
    .some((item) => rank(item.localName) > targetRank)
    || elements.slice(currentIndex + 1).some((item) => rank(item.localName) < targetRank));
  if (current && misplaced) removeXmlChild(series, current);
  const before = children(series).find((item) => rank(item.localName) > targetRank) ?? null;
  if (!current) {
    current = make(series, name);
    append(series, current, before);
  } else if (misplaced) {
    append(series, current, before);
  }
  return current;
}

function containerOf(holder: XmlElement): { ref: XmlElement | null; data: XmlElement | null } {
  for (const refName of ['numRef', 'strRef', 'multiLvlStrRef']) {
    const ref = child(holder, refName);
    if (ref) return {
      ref,
      data: children(ref).find((item) => item.localName.endsWith('Cache')) ?? null,
    };
  }
  return { ref: null, data: child(holder, 'numLit') ?? child(holder, 'strLit') };
}

function referenceToLiteral(
  holder: XmlElement, ref: XmlElement, data: XmlElement | null, numeric: boolean,
): XmlElement {
  const before = holder.children[holder.children.indexOf(ref) + 1] ?? null;
  const literal = make(holder, numeric ? 'numLit' : 'strLit',
    data?.attributes.map((item) => [item.name, item.value] as const) ?? []);
  if (data) for (const node of [...data.children]) {
    removeXmlChild(data, node);
    append(literal, node);
  }
  const refExtension = child(ref, 'extLst');
  if (refExtension) {
    const literalExtension = child(literal, 'extLst');
    if (literalExtension) for (const node of [...refExtension.children]) {
      removeXmlChild(refExtension, node);
      append(literalExtension, node);
    }
    else {
      removeXmlChild(ref, refExtension);
      append(literal, refExtension);
    }
  }
  removeXmlChild(holder, ref);
  append(holder, literal, before);
  return literal;
}

function writeData(
  holder: XmlElement,
  values: readonly (string | number | null)[],
  numeric: boolean,
  sourceBinding: ChartFormulaBinding,
): void {
  let { ref, data } = containerOf(holder);
  if (ref) {
    const expected = numeric ? 'numRef' : 'strRef';
    if (ref.localName !== expected) ref = replaceElement(holder, ref, expected);
    data = children(ref).find((item) => item.localName.endsWith('Cache')) ?? null;
  }
  if (data) {
    const expected = ref ? numeric ? 'numCache' : 'strCache' : numeric ? 'numLit' : 'strLit';
    if (data.localName !== expected) data = replaceElement(ref ?? holder, data, expected);
  }
  if (ref && sourceBinding.formula === null) {
    data = referenceToLiteral(holder, ref, data, numeric);
    ref = null;
  }
  if (!data) {
    data = make(ref ?? holder, ref
      ? numeric ? 'numCache' : 'strCache'
      : numeric ? 'numLit' : 'strLit');
    append(ref ?? holder, data, child(ref ?? holder, 'extLst'));
  }
  if (!numeric) {
    const format = child(data, 'formatCode');
    if (format) removeXmlChild(data, format);
  }
  if (ref) {
    const existingFormula = child(ref, 'f');
    const nextFormula = resizedChartFormula(sourceBinding.formula, values.length);
    if (nextFormula) setText(existingFormula ?? ensure(ref, 'f', data), nextFormula);
    else if (existingFormula) removeXmlChild(ref, existingFormula);
  }
  for (const point of children(data, 'pt')) removeXmlChild(data, point);
  if (numeric && !child(data, 'formatCode')) {
    const format = make(data, 'formatCode');
    setText(format, 'General');
    append(data, format, children(data).find((item) =>
      ['ptCount', 'pt', 'extLst'].includes(item.localName)) ?? null);
  }
  const count = ensure(data, 'ptCount', children(data).find((item) =>
    ['pt', 'extLst'].includes(item.localName)) ?? null);
  setXmlAttribute(count, 'val', String(values.length));
  values.forEach((value, index) => {
    if (value === null) return;
    const point = make(data!, 'pt', [['idx', String(index)]]);
    const text = make(point, 'v');
    setText(text, String(value));
    append(point, text);
    append(data!, point, child(data!, 'extLst'));
  });
}

function writeSeriesName(holder: XmlElement, name: string, binding: ChartFormulaBinding): void {
  const { ref, data } = containerOf(holder);
  if (ref && binding.formula) writeData(holder, [name], false, binding);
  else {
    // CT_SerTx 只接受 strRef 或 v；类别使用的 strLit 会让 Office 删除整张图表。
    if (ref || data) removeXmlChild(holder, (ref ?? data)!);
    setText(ensure(holder, 'v'), name);
  }
}

function numericCategoryContainer(holder: XmlElement): boolean {
  const { ref, data } = containerOf(holder);
  return ref?.localName === 'numRef' || data?.localName === 'numLit';
}

interface SourceSeriesNode {
  readonly node: XmlElement;
  readonly pointIds: readonly ChartPointId[];
  readonly id: ChartSeriesId;
  readonly plotKind: ChartPlotKind;
  readonly sourceIndex: number;
}

function dataPointCount(holder: XmlElement | null): number {
  const data = holder ? containerOf(holder).data : null;
  const declaredValue = attr(child(data, 'ptCount'), 'val');
  const declared = declaredValue === null ? Number.NaN : Number(declaredValue);
  let count = Number.isInteger(declared) && declared >= 0 ? declared : 0;
  let scanned = 0;
  for (const node of data?.children ?? []) {
    if (node.type !== 'element' || node.namespaceUri !== data?.namespaceUri
      || node.localName !== 'pt') continue;
    if (++scanned > MAX_CHART_POINTS) break;
    const rawIndex = attr(node, 'idx');
    const index = rawIndex === null ? Number.NaN : Number(rawIndex);
    if (Number.isInteger(index) && index >= 0 && index < MAX_CHART_POINTS) {
      count = Math.max(count, index + 1);
    }
  }
  return Math.min(MAX_CHART_POINTS, count);
}

function sourceSeriesIds(
  root: XmlElement, plotArea: XmlElement, chartId: string,
): Map<ChartSeriesId, SourceSeriesNode> {
  const result = new Map<ChartSeriesId, SourceSeriesNode>();
  const identities = readChartIdentityManifest(root);
  const seen = new Map<string, number>();
  let fallback = 0;
  for (const plot of children(plotArea)) {
    const plotKind = PLOTS[plot.localName];
    if (!plotKind) continue;
    for (const series of children(plot, 'ser')) {
      const indexValue = attr(child(series, 'idx'), 'val');
      const raw = indexValue === null ? Number.NaN : Number(indexValue);
      const index = Number.isInteger(raw) && raw >= 0 && raw <= 0x7fffffff ? raw : fallback;
      const base = `${chartId}:s${index}`;
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      const id = identities?.series[fallback]?.id
        ?? `${base}${occurrence ? `~${occurrence}` : ''}` as ChartSeriesId;
      const xy = plotKind === 'scatter' || plotKind === 'bubble';
      const holders = xy
        ? [child(series, 'xVal'), child(series, 'yVal'), child(series, 'bubbleSize')]
        : [child(series, 'cat'), child(series, 'val')];
      const persisted = xy ? identities?.series[fallback]?.points : identities?.categories;
      const count = Math.max(persisted?.length ?? 0, ...holders.map(dataPointCount));
      const pointIds = Array.from({ length: count }, (_, pointIndex) => persisted?.[pointIndex]
        ?? `${xy ? id : chartId}:p${pointIndex}` as ChartPointId);
      result.set(id, { node: series, pointIds, id, plotKind, sourceIndex: index });
      fallback++;
    }
  }
  return result;
}

function plotParent(plotArea: XmlElement, series: XmlElement): XmlElement | null {
  return children(plotArea).find((plot) => children(plot, 'ser').includes(series)) ?? null;
}

function cloneSeries(
  plotArea: XmlElement, plotKind: ChartPlotKind,
  templates: ReadonlyMap<ChartPlotKind, SourceSeriesNode>,
): SourceSeriesNode {
  const plot = children(plotArea).find((candidate) => PLOTS[candidate.localName] === plotKind);
  if (!plot) throw new Error(`来源图表没有 ${plotKind} 绘图区，不能在保存时伪造图种`);
  const template = templates.get(plotKind);
  if (!template) throw new Error(`${plotKind} 绘图区没有可继承样式的系列`);
  const clone = cloneXmlNode(template.node);
  const before = children(plot).find((item) => !'barDir grouping varyColors scatterStyle radarStyle ofPieType wireframe ser'.split(' ').includes(item.localName)) ?? null;
  append(plot, clone, before);
  return { ...template, node: clone };
}

function remapPointIndexes(
  node: XmlElement, sourcePointIds: readonly ChartPointId[],
  series: ChartDatasetState['series'][ChartSeriesId],
): void {
  const current = new Map(orderedChartRecords(Object.values(series.points)
    .filter((point) => !point.removed)).map((point, index) => [point.id, index]));
  const remap = (parent: XmlElement, item: XmlElement): void => {
    const indexNode = child(item, 'idx');
    const rawIndex = attr(indexNode, 'val');
    const index = rawIndex === null ? Number.NaN : Number(rawIndex);
    const pointId = Number.isInteger(index) && index >= 0 ? sourcePointIds[index] : undefined;
    const next = pointId === undefined ? undefined : current.get(pointId);
    if (next === undefined) removeXmlChild(parent, item);
    else setXmlAttribute(indexNode!, 'val', String(next));
  };
  for (const point of [...children(node, 'dPt')]) remap(node, point);
  const labels = child(node, 'dLbls');
  if (labels) for (const label of [...children(labels, 'dLbl')]) remap(labels, label);
}

function writeSeries(
  node: XmlElement,
  series: ChartDatasetState['series'][ChartSeriesId],
  categories: readonly string[],
  order: number,
  sourceIndex: number,
): void {
  setXmlAttribute(ensureSeriesChild(node, 'idx', series.plotKind), 'val', String(sourceIndex));
  setXmlAttribute(ensureSeriesChild(node, 'order', series.plotKind), 'val', String(order));
  writeSeriesName(ensureSeriesChild(node, 'tx', series.plotKind), series.name, series.bindings.name);
  const points = orderedChartRecords(Object.values(series.points).filter((point) => !point.removed));
  const xy = series.plotKind === 'scatter' || series.plotKind === 'bubble';
  if (xy) {
    writeData(ensureSeriesChild(node, 'xVal', series.plotKind),
      points.map((point) => point.x ?? null), true, series.bindings.x!);
    writeData(ensureSeriesChild(node, 'yVal', series.plotKind),
      points.map((point) => point.value), true, series.bindings.y!);
    if (series.plotKind === 'bubble') {
      writeData(ensureSeriesChild(node, 'bubbleSize', series.plotKind),
        points.map((point) => point.size ?? null), true,
        series.bindings.size!);
    }
  } else {
    const categoryHolder = ensureSeriesChild(node, 'cat', series.plotKind);
    // 日期轴也以数值序列保存；只有标签真正变成非数值时才切换为字符串缓存。
    const numericCategories = canonicalNumericCategories(categories) !== null
      && (series.bindings.categories?.cache === 'number' || numericCategoryContainer(categoryHolder));
    writeData(categoryHolder, categories, numericCategories, series.bindings.categories!);
    writeData(ensureSeriesChild(node, 'val', series.plotKind),
      points.map((point) => point.value), true, series.bindings.values!);
  }
}

export function materializeChartTree(
  source: string | Uint8Array, chartId: string, state: ChartDatasetState,
): XmlDocument {
  const tree = parseXmlTree(source);
  const plotArea = child(child(tree.root, 'chart'), 'plotArea');
  if (!plotArea) throw new Error(`图表 ${chartId} 缺少 plotArea`);
  const sourceById = sourceSeriesIds(tree.root, plotArea, chartId);
  const templates = new Map<ChartPlotKind, SourceSeriesNode>();
  for (const template of readChartIdentityManifest(tree.root)?.templates ?? []) {
    templates.set(template.plotKind, {
      node: template.node, pointIds: template.points, id: template.id,
      plotKind: template.plotKind, sourceIndex: template.sourceIndex,
    });
  }
  for (const plot of children(plotArea)) {
    const kind = PLOTS[plot.localName];
    const series = children(plot, 'ser')[0];
    const source = series && [...sourceById.values()].find((item) => item.node === series);
    if (kind && source) {
      templates.set(kind, { ...source, node: cloneXmlNodeWithNamespaceClosure(series) });
    }
  }
  for (const [id, source] of sourceById) {
    if (state.series[id]?.removed || !state.series[id]) {
      const parent = plotParent(plotArea, source.node);
      if (parent) removeXmlChild(parent, source.node);
    }
  }
  const categories = orderedChartRecords(Object.values(state.categories).filter((item) => !item.removed))
    .map((item) => item.label);
  const visible = orderedChartRecords(Object.values(state.series).filter((series) => !series.removed));
  const reserved = new Set(visible.filter((series) => sourceById.has(series.id))
    .map((series) => series.sourceIndex));
  const usedNew = new Set<number>();
  const writtenIds = new Map<XmlElement, ChartSeriesId>();
  let nextSourceIndex = 0;
  visible.forEach((series, order) => {
    const sourceNode = sourceById.get(series.id);
    const target = sourceNode ?? cloneSeries(plotArea, series.plotKind, templates);
    let sourceIndex = series.sourceIndex;
    if (!sourceNode && (reserved.has(sourceIndex) || usedNew.has(sourceIndex))) {
      while (usedNew.has(nextSourceIndex) || reserved.has(nextSourceIndex)) nextSourceIndex++;
      sourceIndex = nextSourceIndex++;
    }
    if (!sourceNode) usedNew.add(sourceIndex);
    remapPointIndexes(target.node, target.pointIds, series);
    writeSeries(target.node, series, categories, order, sourceIndex);
    writtenIds.set(target.node, series.id);
  });
  const physicalSeriesOrder = children(plotArea).flatMap((plot) => children(plot, 'ser'))
    .flatMap((node) => writtenIds.has(node) ? [writtenIds.get(node)!] : []);
  const activeKinds = new Set(visible.map((series) => series.plotKind));
  const retainedTemplates: ChartIdentityTemplate[] = [];
  for (const [plotKind, template] of templates) {
    if (activeKinds.has(plotKind)) continue;
    const series = state.series[template.id]
      ?? Object.values(state.series).find((item) => item.plotKind === plotKind);
    if (!series) continue;
    const node = cloneXmlNodeWithNamespaceClosure(template.node);
    const emptySeries = { ...series, name: '', points: Object.create(null) };
    remapPointIndexes(node, template.pointIds, emptySeries);
    writeSeries(node, emptySeries, categories, 0, series.sourceIndex);
    retainedTemplates.push({
      id: series.id, plotKind, sourceIndex: series.sourceIndex, points: [], node,
    });
  }
  writeChartIdentityManifest(tree.root, state, physicalSeriesOrder, retainedTemplates);
  return tree;
}

export function materializeChartXml(
  source: string | Uint8Array, chartId: string, state: ChartDatasetState,
): string {
  return serializeXmlTree(materializeChartTree(source, chartId, state));
}

function sanitizeProjectionTree(parent: XmlElement, allowed: ReadonlySet<string>): void {
  for (const node of [...parent.children]) {
    if (node.type !== 'element') continue;
    if (!node.namespaceUri || !allowed.has(node.namespaceUri)) removeXmlChild(parent, node);
    else sanitizeProjectionTree(node, allowed);
  }
}

/** 编辑投影只消费当前图表方言；未知扩展仍原样保存，但不能以同名节点劫持屏幕数据。 */
export function materializeChartProjectionXml(
  source: string | Uint8Array, chartId: string, state: ChartDatasetState,
): string {
  const tree = materializeChartTree(source, chartId, state);
  const allowed = tree.root.namespaceUri === STRICT_CHART_NS
    ? new Set([STRICT_CHART_NS, STRICT_DRAWING_NS])
    : new Set([CHART_NS, DRAWING_NS]);
  sanitizeProjectionTree(tree.root, allowed);
  return serializeXmlTree(tree);
}
