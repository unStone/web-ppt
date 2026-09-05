import { initialFractionalIndex } from '@web-ppt/edit-core';
import type { EditDoc, ElementId } from '../types';
import { parseXmlTree } from '@web-ppt/edit-core/xml';
import { chartXml, xmlAttribute as attr, xmlContent as content } from './xml-data';
import { CHART_PLOTS as PLOTS } from './plot-kinds';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import type {
  ChartDataBinding, ChartDataset, ChartDatasetState, ChartFormulaBinding, ChartPlotKind,
  ChartPoint, ChartPointId, ChartSeries, ChartSeriesId,
} from './types';
import {
  assertChartDictionary, MAX_CHART_CELLS, MAX_CHART_POINTS, MAX_CHART_SERIES,
  validateMaterializedRecords,
} from './validation';
import { workbookCanSync } from './workbook';
import { readChartIdentityManifest } from './identity';
import { chartRelationships } from './context';
import { chartPartForElement } from './locator';
import { orderedChartRecords } from './ordering';
import {
  OFFICE_REL_NS, STRICT_CHART_NS, STRICT_OFFICE_REL_NS,
} from './xml-namespaces';

const { child, children } = chartXml;
const formula = (holder: XmlElement | null): string | null => {
  const ref = children(holder).find((item) => item.localName.endsWith('Ref'));
  return ref ? content(child(ref, 'f')).trim() || null : null;
};

function dataContainer(holder: XmlElement | null): XmlElement | null {
  for (const refName of ['numRef', 'strRef', 'multiLvlStrRef']) {
    const ref = child(holder, refName);
    if (ref) return children(ref).find((item) => item.localName.endsWith('Cache')) ?? null;
  }
  return child(holder, 'numLit') ?? child(holder, 'strLit');
}

function cacheKind(holder: XmlElement | null): ChartFormulaBinding['cache'] {
  const container = dataContainer(holder);
  if (!container) return 'missing';
  if (container.localName.endsWith('Lit')) return 'literal';
  return container.localName.startsWith('str') || container.localName.startsWith('multiLvl')
    ? 'string' : 'number';
}

function dataPointCount(holder: XmlElement | null): number {
  const container = dataContainer(holder);
  const declaredValue = attr(child(container, 'ptCount'), 'val');
  const declared = declaredValue === null ? Number.NaN : Number(declaredValue);
  let count = Number.isInteger(declared) && declared >= 0 ? declared : 0;
  let scanned = 0;
  for (const node of container?.children ?? []) {
    if (node.type !== 'element' || node.namespaceUri !== container?.namespaceUri
      || node.localName !== 'pt') continue;
    if (++scanned > MAX_CHART_POINTS) return MAX_CHART_POINTS + 1;
    const rawIndex = attr(node, 'idx');
    const index = rawIndex === null ? Number.NaN : Number(rawIndex);
    if (Number.isInteger(index) && index >= 0) count = Math.max(count, index + 1);
  }
  return count;
}

function cache(holder: XmlElement | null, numeric: boolean): Map<number, string | number | null> {
  const container = dataContainer(holder);
  const result = new Map<number, string | number | null>();
  if (!container) return result;
  let scanned = 0;
  for (const point of container.children) {
    if (point.type !== 'element' || point.namespaceUri !== container.namespaceUri
      || point.localName !== 'pt') continue;
    if (++scanned > MAX_CHART_POINTS) break;
    const rawIndex = attr(point, 'idx');
    const index = rawIndex === null ? Number.NaN : Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_CHART_POINTS) continue;
    const raw = content(child(point, 'v'));
    if (!numeric) result.set(index, raw);
    else if (!raw.trim()) result.set(index, null);
    else {
      const value = Number(raw);
      result.set(index, Number.isFinite(value) ? value : null);
    }
  }
  return result;
}

function binding(holder: XmlElement | null): ChartFormulaBinding {
  return { formula: formula(holder), cache: cacheKind(holder) };
}

function seriesName(holder: XmlElement | null): string {
  const values = cache(holder, false);
  if (values.has(0)) return String(values.get(0) ?? '');
  return content(child(holder, 'v'));
}

function workbookBinding(
  doc: EditDoc,
  chartId: ElementId,
  chartPart: string,
  root: XmlElement,
  categories: ChartDatasetState['categories'],
  series: ChartDatasetState['series'],
  unsupportedMultiLevel: boolean,
  inconsistentCategories: boolean,
  unsupportedScale: boolean,
): ChartDataBinding {
  if (unsupportedScale) {
    return { chartPart, workbookPart: null, mode: 'readonly', reason: '图表来源数据超过安全上限' };
  }
  if (unsupportedMultiLevel) {
    return { chartPart, workbookPart: null, mode: 'readonly', reason: '多级类别缓存暂不支持无损写回' };
  }
  if (inconsistentCategories) {
    return { chartPart, workbookPart: null, mode: 'readonly', reason: '不同系列的类别来源不一致，无法统一编辑' };
  }
  const external = children(root).flatMap((node) => node.localName === 'externalData' ? [node] : [])
    .concat(children(child(root, 'chart'), 'externalData'))[0] ?? null;
  const relationshipNamespace = root.namespaceUri === STRICT_CHART_NS
    ? STRICT_OFFICE_REL_NS : OFFICE_REL_NS;
  const relationshipId = external
    ? external.attributes.find((item) => item.localName === 'id'
      && item.namespaceUri === relationshipNamespace)?.value ?? null
    : null;
  const relationships = chartRelationships(doc, chartPart);
  const workbookPart = relationshipId ? relationships[relationshipId]?.target ?? null : null;
  const records = Object.values(doc.elements).filter((record) => record.id !== chartId);
  if (records.some((record) => chartPartForElement(doc, record.id) === chartPart)) {
    return { chartPart, workbookPart, mode: 'readonly', reason: '同一图表部件被多个框架共享，无法安全区分编辑来源' };
  }
  if (!workbookPart) {
    return { chartPart, workbookPart: null, mode: 'cache', reason: '图表没有可写的内嵌工作簿' };
  }
  if (records.some((record) => {
    const part = chartPartForElement(doc, record.id);
    return part && Object.values(chartRelationships(doc, part))
      .some((relationship) => relationship.target === workbookPart);
  })) {
    return { chartPart, workbookPart, mode: 'readonly', reason: '同一内嵌工作簿被多个图表共享，无法原子合并写回' };
  }
  const missingCache = Object.values(series).some((item) =>
    Object.values(item.bindings).some((itemBinding) =>
      itemBinding?.formula && itemBinding.cache === 'missing'));
  if (missingCache) {
    return { chartPart, workbookPart, mode: 'readonly', reason: '图表公式缺少缓存，不能把未知工作簿值当成空值覆盖' };
  }
  const workbook = doc.saveState.baselines[workbookPart] ?? doc.package?.parts[workbookPart];
  const sync = workbookCanSync(workbook, { categories, series });
  return sync.ok
    ? { chartPart, workbookPart, mode: 'workbook' }
    : { chartPart, workbookPart, mode: 'readonly', reason: sync.reason };
}

function sourceState(doc: EditDoc, chartId: ElementId): ChartDatasetState {
  const record = doc.elements[chartId];
  const part = record && chartPartForElement(doc, chartId);
  // 保存会替换当前 OPC 包，但编辑覆盖的基线必须像普通 record.src 一样保持不变，撤销才能回到打开时状态。
  const bytes = part && (doc.saveState.baselines[part] ?? doc.package?.parts[part]);
  if (!record || !part || !bytes) throw new Error(`元素 ${chartId} 不是可读取的经典图表`);
  const root = parseXmlTree(bytes).root;
  const identities = readChartIdentityManifest(root);
  const plotArea = child(child(root, 'chart'), 'plotArea');
  if (!plotArea) throw new Error(`图表 ${chartId} 缺少 plotArea`);
  const categories: ChartDatasetState['categories'] = Object.create(null);
  const series: ChartDatasetState['series'] = Object.create(null);
  let categorySource: Map<number, string | number | null> | null = null;
  let categoryCount = 0;
  let hasCategory = false;
  let hasXY = false;
  let unsupportedMultiLevel = false;
  let inconsistentCategories = false;
  let categorySignature: string | undefined;
  let unsupportedScale = false;
  let sourceCells = 0;
  const seenSeriesIds = new Map<string, number>();
  const sourceSeries: Array<{
    source: XmlElement;
    plotKind: ChartPlotKind;
    identity?: { id: ChartSeriesId; points: readonly ChartPointId[] };
    fallback: number;
    removed: boolean;
  }> = [];
  let physicalSequence = 0;
  const availableKinds = new Set<ChartPlotKind>();
  for (const plot of children(plotArea)) {
    const plotKind = PLOTS[plot.localName];
    if (!plotKind) continue;
    const xy = plotKind === 'scatter' || plotKind === 'bubble';
    availableKinds.add(plotKind);
    hasXY ||= xy;
    hasCategory ||= !xy;
    for (const source of children(plot, 'ser')) {
      sourceSeries.push({
        source, plotKind, identity: identities?.series[physicalSequence],
        fallback: physicalSequence, removed: false,
      });
      physicalSequence++;
    }
  }
  for (const template of identities?.templates ?? []) {
    if (!availableKinds.has(template.plotKind)) continue;
    sourceSeries.push({
      source: template.node, plotKind: template.plotKind, identity: template,
      fallback: template.sourceIndex, removed: true,
    });
  }
  for (const descriptor of sourceSeries) {
      if (Object.keys(series).length >= MAX_CHART_SERIES) { unsupportedScale = true; break; }
      const { source, plotKind } = descriptor;
      const xy = plotKind === 'scatter' || plotKind === 'bubble';
      const indexValue = attr(child(source, 'idx'), 'val');
      const rawIndex = indexValue === null ? Number.NaN : Number(indexValue);
      const sourceIndex = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex <= 0x7fffffff
        ? rawIndex : descriptor.fallback;
      const orderValue = attr(child(source, 'order'), 'val');
      const rawOrder = orderValue === null ? Number.NaN : Number(orderValue);
      const sourceOrder = Number.isInteger(rawOrder) && rawOrder >= 0 && rawOrder <= 0x7fffffff
        ? rawOrder : descriptor.fallback;
      const baseId = `${chartId}:s${sourceIndex}`;
      const occurrence = seenSeriesIds.get(baseId) ?? 0;
      seenSeriesIds.set(baseId, occurrence + 1);
      const id = descriptor.identity?.id
        ?? `${baseId}${occurrence ? `~${occurrence}` : ''}` as ChartSeriesId;
      const yHolder = child(source, xy ? 'yVal' : 'val');
      const y = cache(yHolder, true);
      const xHolder = xy ? child(source, 'xVal') : null;
      const x = cache(xHolder, true);
      const sizeHolder = plotKind === 'bubble' ? child(source, 'bubbleSize') : null;
      const sizes = cache(sizeHolder, true);
      const catHolder = xy ? null : child(source, 'cat');
      unsupportedMultiLevel ||= !!child(catHolder, 'multiLvlStrRef')
        || !!child(child(source, 'tx'), 'multiLvlStrRef');
      const seriesCategories = catHolder ? cache(catHolder, false) : new Map<number, string>();
      if (!categorySource && catHolder) categorySource = seriesCategories;
      const holderCounts = [
        dataPointCount(catHolder), dataPointCount(yHolder), dataPointCount(xHolder),
        dataPointCount(sizeHolder),
      ];
      if (!xy) {
        const signature = JSON.stringify([
          formula(catHolder), cacheKind(catHolder), holderCounts[0], [...seriesCategories],
        ]);
        if (categorySignature === undefined) categorySignature = signature;
        else inconsistentCategories ||= categorySignature !== signature;
      }
      if (holderCounts.some((count) => count > MAX_CHART_POINTS)) {
        unsupportedScale = true;
        break;
      }
      categoryCount = Math.max(categoryCount, holderCounts[0], identities?.categories.length ?? 0);
      const pointIndexes = new Set([
        ...y.keys(), ...x.keys(), ...sizes.keys(), ...seriesCategories.keys(),
      ]);
      const pointCount = Math.min(MAX_CHART_POINTS, Math.max(
        Math.max(0, ...pointIndexes, -1) + 1,
        holderCounts[1], holderCounts[2], holderCounts[3],
        xy ? descriptor.identity?.points.length ?? 0 : categoryCount,
      ));
      if (sourceCells + pointCount > MAX_CHART_CELLS) {
        unsupportedScale = true;
        break;
      }
      sourceCells += pointCount;
      const points: Record<ChartPointId, ChartPoint> = Object.create(null);
      for (let index = 0; index < pointCount; index++) {
        const pointId = (xy ? descriptor.identity?.points[index] : identities?.categories[index])
          ?? `${xy ? id : chartId}:p${index}` as ChartPointId;
        points[pointId] = {
          id: pointId,
          order: initialFractionalIndex(index),
          value: (y.get(index) as number | null | undefined) ?? null,
          ...(xy ? { x: (x.get(index) as number | null | undefined) ?? null } : {}),
          ...(plotKind === 'bubble'
            ? { size: (sizes.get(index) as number | null | undefined) ?? null } : {}),
        };
      }
      series[id] = {
        id, order: initialFractionalIndex(sourceOrder), sourceIndex, plotKind,
        name: seriesName(child(source, 'tx')),
        points,
        bindings: {
          name: binding(child(source, 'tx')),
          ...(xy ? { x: binding(xHolder), y: binding(yHolder) }
            : { categories: binding(catHolder), values: binding(yHolder) }),
          ...(plotKind === 'bubble' ? { size: binding(sizeHolder) } : {}),
        },
        ...(descriptor.removed ? { removed: true as const, sourceTemplate: true as const } : {}),
      };
  }
  for (let index = 0; index < categoryCount; index++) {
    const value = categorySource?.get(index) ?? null;
    const id = identities?.categories[index] ?? `${chartId}:p${index}` as ChartPointId;
    categories[id] = { id, order: initialFractionalIndex(index), label: String(value ?? '') };
  }
  return {
    kind: hasCategory && hasXY ? 'mixed' : hasXY ? 'xy' : 'category',
    categories,
    series,
    binding: workbookBinding(
      doc, chartId, part, root, categories, series,
      unsupportedMultiLevel, inconsistentCategories, unsupportedScale,
    ),
  };
}

function overlayState(target: Record<string, unknown>, sparse: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(sparse)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const current = target[key];
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        target[key] = Object.create(null) as Record<string, unknown>;
      }
      overlayState(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else target[key] = value;
  }
}

function sanitizeDatasetRoot(merged: ChartDatasetState, source: ChartDatasetState): boolean {
  const target = merged as unknown as Record<string, unknown>;
  let deferred = false;
  for (const key of Object.keys(target)) {
    if (['kind', 'binding', 'categories', 'series'].includes(key)) continue;
    delete target[key];
    deferred = true;
  }
  for (const key of ['kind', 'binding'] as const) {
    if (JSON.stringify(merged[key]) === JSON.stringify(source[key])) continue;
    target[key] = structuredClone(source[key]);
    deferred = true;
  }
  for (const key of ['categories', 'series'] as const) {
    try { assertChartDictionary(merged[key], `图表 ${key}`); } catch {
      target[key] = structuredClone(source[key]);
      deferred = true;
    }
  }
  return deferred;
}

function reconcileCategoryMatrix(state: ChartDatasetState): void {
  const categories = Object.values(state.categories);
  const active = categories.filter((item) => !item.removed);
  const activeSeries = Object.values(state.series).filter((series) => !series.removed);
  const categorySeries = activeSeries.filter((series) =>
    series.plotKind !== 'scatter' && series.plotKind !== 'bubble');
  const xyCells = activeSeries.filter((series) =>
    series.plotKind === 'scatter' || series.plotKind === 'bubble')
    .reduce((sum, series) => sum + Object.values(series.points).filter((point) => !point.removed).length, 0);
  if (active.length * categorySeries.length + xyCells > MAX_CHART_CELLS) {
    state.binding = { ...state.binding, mode: 'readonly', reason: '图表数据矩阵超过安全上限' };
    return;
  }
  for (const series of Object.values(state.series)) {
    if (series.removed) continue;
    if (series.plotKind === 'scatter' || series.plotKind === 'bubble') continue;
    for (const point of Object.values(series.points)) {
      const category = state.categories[point.id];
      if (!category || category.removed) (point as { removed?: true }).removed = true;
      else delete (point as { removed?: true }).removed;
    }
    for (const category of active) {
      if (series.points[category.id]) continue;
      series.points[category.id] = {
        id: category.id, order: category.order, value: null,
      };
    }
  }
}

function materializedState(
  doc: EditDoc, id: ElementId,
): { readonly state: ChartDatasetState; readonly deferred: boolean } {
  const source = sourceState(doc, id);
  const sparse = doc.elements[id]?.ovr.extensions?.['chart-data'];
  if (sparse === undefined) {
    reconcileCategoryMatrix(source);
    return { state: source, deferred: false };
  }
  if (!sparse || typeof sparse !== 'object' || Array.isArray(sparse)) {
    throw new Error(`图表 ${id} 的稀疏覆盖无效`);
  }
  const merged = structuredClone(source) as ChartDatasetState;
  overlayState(merged as unknown as Record<string, unknown>, sparse as Record<string, unknown>);
  for (const item of Object.values(merged.series) as Array<ChartDatasetState['series'][ChartSeriesId]
    & { pointsReady?: true }>) {
    if (item.pointsReady !== true) continue;
    item.points ??= Object.create(null) as Record<ChartPointId, ChartPoint>;
    delete item.pointsReady;
  }
  let deferred = sanitizeDatasetRoot(merged, source);
  deferred = validateMaterializedRecords(
    merged.categories, merged.series, source.categories, source.series,
  ) || deferred;
  reconcileCategoryMatrix(merged);
  if (merged.binding.mode === 'workbook' && merged.binding.workbookPart) {
    const workbook = doc.saveState.baselines[merged.binding.workbookPart]
      ?? doc.package?.parts[merged.binding.workbookPart];
    const sync = workbookCanSync(workbook, merged);
    if (!sync.ok) merged.binding = { ...merged.binding, mode: 'readonly', reason: sync.reason };
  }
  return { state: merged, deferred };
}

const stateOf = (doc: EditDoc, id: ElementId): ChartDatasetState => materializedState(doc, id).state;

function activeState(state: ChartDatasetState): ChartDatasetState {
  const result = structuredClone(state);
  for (const [id, category] of Object.entries(result.categories)) {
    if (category.removed) delete result.categories[id as ChartPointId];
  }
  for (const [id, series] of Object.entries(result.series)) {
    if (series.removed) {
      delete result.series[id as ChartSeriesId];
      continue;
    }
    for (const [pointId, point] of Object.entries(series.points)) {
      if (point.removed) delete series.points[pointId as ChartPointId];
    }
  }
  return result;
}

function comparableState(state: ChartDatasetState): unknown {
  const active = activeState(state);
  return {
    kind: active.kind,
    binding: active.binding,
    categories: orderedChartRecords(Object.values(active.categories)),
    series: orderedChartRecords(Object.values(active.series)).map((series) => ({
      ...series,
      points: orderedChartRecords(Object.values(series.points)),
    })),
  };
}

function comparableSource(doc: EditDoc, id: ElementId): unknown {
  const source = sourceState(doc, id);
  reconcileCategoryMatrix(source);
  return comparableState(source);
}

export function chartStateMatchesSource(doc: EditDoc, id: ElementId): boolean {
  const current = materializedState(doc, id);
  return !current.deferred
    && JSON.stringify(comparableState(current.state)) === JSON.stringify(comparableSource(doc, id));
}

export function chartStateHasEffectiveChanges(doc: EditDoc, id: ElementId): boolean {
  return JSON.stringify(comparableState(materializedState(doc, id).state))
    !== JSON.stringify(comparableSource(doc, id));
}

export function readChartDataset(doc: EditDoc, id: ElementId): ChartDataset {
  const state = stateOf(doc, id);
  const categories = orderedChartRecords(Object.values(state.categories).filter((item) => !item.removed))
    .map((item) => ({ ...item }));
  const series = orderedChartRecords(Object.values(state.series).filter((item) => !item.removed))
    .map((item): ChartSeries => ({
      ...item, bindings: structuredClone(item.bindings),
      points: orderedChartRecords(Object.values(item.points).filter((point) => !point.removed))
        .map((point) => ({ ...point })),
    }));
  const plotKinds = [...new Set(orderedChartRecords(Object.values(state.series))
    .map((item) => item.plotKind))];
  return { chartId: id, kind: state.kind, plotKinds, categories, series, binding: { ...state.binding } };
}

export function hydrateChartDataset(doc: EditDoc, id: ElementId): ChartDatasetState {
  return structuredClone(sourceState(doc, id));
}

export function currentChartDatasetState(doc: EditDoc, id: ElementId): ChartDatasetState {
  return stateOf(doc, id);
}

export function chartRecordIds(doc: EditDoc): ElementId[] {
  return Object.values(doc.elements).filter((record) => chartPartForElement(doc, record.id))
    .map((record) => record.id);
}
