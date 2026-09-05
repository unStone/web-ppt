import { assertFractionalIndex } from '@web-ppt/edit-core';
import type { FractionalIndex } from '../types';
import type {
  ChartCategory, ChartPlotKind, ChartPoint, ChartSeries, ChartSeriesId,
} from './types';

export const MAX_CHART_NAME = 32_767;
export const MAX_CHART_IDENTITY = 512;
export const MAX_CHART_POINTS = 20_000;
export const MAX_CHART_SERIES = 1_024;
export const MAX_CHART_CELLS = 100_000;
export const CHART_PLOT_KINDS = new Set<ChartPlotKind>([
  'bar', 'line', 'pie', 'doughnut', 'area', 'scatter', 'radar',
  'bubble', 'stock', 'ofPie', 'surface', 'other',
]);

const own = (object: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);
const INVALID_XML_10 = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u;

function isXml10Text(value: string): boolean {
  return !INVALID_XML_10.test(value);
}

export function assertChartName(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length > MAX_CHART_NAME || !isXml10Text(value)) {
    throw new Error(`${label}无效`);
  }
}

export function assertChartNumber(value: unknown, label: string): asserts value is number | null {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${label}必须是有限数字或 null`);
  }
}

export function assertChartDictionary(
  value: unknown, label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}无效`);
  if (Object.keys(value).some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))) {
    throw new Error(`${label}含危险字段`);
  }
}

export function assertChartRecord(
  value: unknown, keys: readonly string[], label: string,
): asserts value is Record<string, unknown> {
  assertChartDictionary(value, label);
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`${label}含未知字段`);
}

export function assertChartIdentity(
  value: unknown, expected: string, label: string,
): asserts value is string {
  if (value !== expected || value.length > MAX_CHART_IDENTITY || !isXml10Text(value) || /\x7f/.test(value)
    || ['__proto__', 'prototype', 'constructor'].includes(value)) {
    throw new Error(`${label}身份无效`);
  }
}

export function assertChartOrder(value: unknown, label: string): asserts value is FractionalIndex {
  if (typeof value !== 'string' || value.length > 1_024) throw new Error(`${label}顺序无效`);
  try { assertFractionalIndex(value); } catch { throw new Error(`${label}顺序无效`); }
}

function assertBinding(value: unknown, label: string, literalOnly: boolean): void {
  assertChartRecord(value, ['formula', 'cache'], label);
  if (value.formula !== null && (typeof value.formula !== 'string' || value.formula.length > 32_767)) {
    throw new Error(`${label}公式无效`);
  }
  if (!['number', 'string', 'literal', 'missing'].includes(String(value.cache))) {
    throw new Error(`${label}缓存类型无效`);
  }
  if (literalOnly && (value.formula !== null || value.cache !== 'literal')) {
    throw new Error(`${label}不能注入来源公式`);
  }
}

export function assertChartPointRecord(
  value: unknown, expectedId: string, label: string,
): asserts value is ChartPoint {
  assertChartRecord(value, ['id', 'order', 'value', 'x', 'size', 'removed'], label);
  assertChartIdentity(value.id, expectedId, label);
  assertChartOrder(value.order, label);
  assertChartNumber(value.value, `${label} value`);
  if (own(value, 'x')) assertChartNumber(value.x, `${label} x`);
  if (own(value, 'size')) assertChartNumber(value.size, `${label} size`);
  if (value.removed !== undefined && value.removed !== true) throw new Error(`${label}删除标记无效`);
}

export function assertChartCategoryRecord(
  value: unknown, expectedId: string, label: string,
): asserts value is ChartCategory {
  assertChartRecord(value, ['id', 'order', 'label', 'removed'], label);
  assertChartIdentity(value.id, expectedId, label);
  assertChartOrder(value.order, label);
  assertChartName(value.label, label);
  if (value.removed !== undefined && value.removed !== true) throw new Error(`${label}删除标记无效`);
}

export function assertChartSeriesRecord(
  value: unknown, expectedId: string, label: string, literalOnly = false,
): asserts value is Omit<ChartSeries, 'points'> & { points: Record<string, ChartPoint> } {
  assertChartRecord(value, [
    'id', 'order', 'sourceIndex', 'plotKind', 'name', 'points', 'bindings', 'removed',
  ], label);
  assertChartIdentity(value.id, expectedId, label);
  assertChartOrder(value.order, label);
  if (!Number.isInteger(value.sourceIndex) || Number(value.sourceIndex) < 0
    || Number(value.sourceIndex) > 0x7fff_ffff || !CHART_PLOT_KINDS.has(value.plotKind as ChartPlotKind)) {
    throw new Error(`${label}图种或索引无效`);
  }
  assertChartName(value.name, label);
  assertChartDictionary(value.points, `${label}数据点`);
  const points = Object.entries(value.points);
  if (points.length > MAX_CHART_POINTS) throw new Error(`${label}数据点过多`);
  const xy = value.plotKind === 'scatter' || value.plotKind === 'bubble';
  points.forEach(([id, point]) => {
    assertChartPointRecord(point, id, `${label}数据点`);
    if ((!xy && (own(point, 'x') || own(point, 'size')))
      || (value.plotKind === 'scatter' && own(point, 'size'))) {
      throw new Error(`${label}数据点与图种不匹配`);
    }
  });
  assertChartRecord(value.bindings, ['name', 'categories', 'values', 'x', 'y', 'size'], `${label}绑定`);
  assertBinding(value.bindings.name, `${label}名称绑定`, literalOnly);
  if (xy) {
    if (own(value.bindings, 'categories') || own(value.bindings, 'values')) {
      throw new Error(`${label}绑定与图种不匹配`);
    }
    assertBinding(value.bindings.x, `${label} X 绑定`, literalOnly);
    assertBinding(value.bindings.y, `${label} Y 绑定`, literalOnly);
    if (value.plotKind === 'bubble') assertBinding(value.bindings.size, `${label}大小绑定`, literalOnly);
    else if (own(value.bindings, 'size')) throw new Error(`${label}绑定与图种不匹配`);
  } else {
    if (own(value.bindings, 'x') || own(value.bindings, 'y') || own(value.bindings, 'size')) {
      throw new Error(`${label}绑定与图种不匹配`);
    }
    assertBinding(value.bindings.categories, `${label}类别绑定`, literalOnly);
    assertBinding(value.bindings.values, `${label}数值绑定`, literalOnly);
  }
  if (value.removed !== undefined && value.removed !== true) throw new Error(`${label}删除标记无效`);
}

type StoredSeries = Omit<ChartSeries, 'points'> & {
  points: Record<string, ChartPoint>;
  sourceTemplate?: true;
};
type MutableRecord = Record<string, unknown>;

function removeUnknown(target: MutableRecord, allowed: readonly string[]): boolean {
  let changed = false;
  for (const key of Object.keys(target)) {
    if (allowed.includes(key)) continue;
    delete target[key];
    changed = true;
  }
  return changed;
}

function restoreField(target: MutableRecord, source: object, key: string): void {
  if (own(source, key)) target[key] = structuredClone((source as MutableRecord)[key]);
  else delete target[key];
}

function quarantineInvalid(
  target: MutableRecord, source: object, key: string, validate: (value: unknown) => void,
): boolean {
  try { validate(target[key]); return false; } catch {
    restoreField(target, source, key);
    return true;
  }
}

function sanitizeSourceCategory(
  category: ChartCategory, source: ChartCategory, id: string,
): boolean {
  const target = category as unknown as MutableRecord;
  let deferred = removeUnknown(target, ['id', 'order', 'label', 'removed']);
  deferred = quarantineInvalid(target, source, 'id', (value) =>
    assertChartIdentity(value, id, `图表类别 ${id}`)) || deferred;
  deferred = quarantineInvalid(target, source, 'order', (value) =>
    assertChartOrder(value, `图表类别 ${id}`)) || deferred;
  deferred = quarantineInvalid(target, source, 'label', (value) =>
    assertChartName(value, `图表类别 ${id}`)) || deferred;
  if (target.removed !== undefined && target.removed !== true) {
    restoreField(target, source, 'removed');
    deferred = true;
  }
  return deferred;
}

function assertPointForPlot(point: unknown, id: string, plotKind: ChartPlotKind): void {
  assertChartPointRecord(point, id, `图表数据点 ${id}`);
  const xy = plotKind === 'scatter' || plotKind === 'bubble';
  if ((!xy && (own(point, 'x') || own(point, 'size')))
    || (plotKind === 'scatter' && own(point, 'size'))) {
    throw new Error(`图表数据点 ${id} 与图种不匹配`);
  }
}

function sanitizeSourcePoint(
  point: ChartPoint, source: ChartPoint, id: string, plotKind: ChartPlotKind,
): boolean {
  const target = point as unknown as MutableRecord;
  const allowed = ['id', 'order', 'value', 'removed',
    ...(plotKind === 'scatter' || plotKind === 'bubble' ? ['x'] : []),
    ...(plotKind === 'bubble' ? ['size'] : [])];
  let deferred = removeUnknown(target, allowed);
  deferred = quarantineInvalid(target, source, 'id', (value) =>
    assertChartIdentity(value, id, `图表数据点 ${id}`)) || deferred;
  deferred = quarantineInvalid(target, source, 'order', (value) =>
    assertChartOrder(value, `图表数据点 ${id}`)) || deferred;
  for (const key of ['value', ...(allowed.includes('x') ? ['x'] : []),
    ...(allowed.includes('size') ? ['size'] : [])]) {
    deferred = quarantineInvalid(target, source, key, (value) =>
      assertChartNumber(value, `图表数据点 ${id} ${key}`)) || deferred;
  }
  if (target.removed !== undefined && target.removed !== true) {
    restoreField(target, source, 'removed');
    deferred = true;
  }
  return deferred;
}

function sanitizeSourceSeries(item: StoredSeries, source: StoredSeries, id: string): boolean {
  const target = item as unknown as MutableRecord;
  let deferred = removeUnknown(target, [
    'id', 'order', 'sourceIndex', 'plotKind', 'name', 'points', 'bindings', 'removed', 'sourceTemplate',
  ]);
  deferred = quarantineInvalid(target, source, 'id', (value) =>
    assertChartIdentity(value, id, `图表系列 ${id}`)) || deferred;
  deferred = quarantineInvalid(target, source, 'order', (value) =>
    assertChartOrder(value, `图表系列 ${id}`)) || deferred;
  deferred = quarantineInvalid(target, source, 'name', (value) =>
    assertChartName(value, `图表系列 ${id}`)) || deferred;
  for (const key of ['sourceIndex', 'plotKind', 'bindings', 'sourceTemplate']) {
    if (JSON.stringify(target[key]) === JSON.stringify((source as unknown as MutableRecord)[key])) continue;
    restoreField(target, source, key);
    deferred = true;
  }
  if (target.removed !== undefined && target.removed !== true) {
    restoreField(target, source, 'removed');
    deferred = true;
  }
  if (!target.points || typeof target.points !== 'object' || Array.isArray(target.points)) {
    restoreField(target, source, 'points');
    return true;
  }
  for (const [pointId, point] of Object.entries(item.points)) {
    const sourcePoint = source.points[pointId];
    if (sourcePoint) {
      if (point && typeof point === 'object' && !Array.isArray(point)) {
        deferred = sanitizeSourcePoint(point, sourcePoint, pointId, item.plotKind) || deferred;
      } else {
        item.points[pointId] = structuredClone(sourcePoint);
        deferred = true;
      }
      continue;
    }
    try { assertPointForPlot(point, pointId, item.plotKind); } catch {
      delete item.points[pointId];
      deferred = true;
    }
  }
  const addedPoints = Object.keys(item.points).filter((pointId) => !source.points[pointId]).sort();
  const allowedAdded = Math.max(0, MAX_CHART_POINTS - Object.keys(source.points).length);
  for (const pointId of addedPoints.slice(allowedAdded)) {
    delete item.points[pointId];
    deferred = true;
  }
  return deferred;
}

function sanitizeAddedSeries(
  item: StoredSeries, id: string, categories: Readonly<Record<string, ChartCategory>>,
): {
  readonly valid: boolean; readonly deferred: boolean;
} {
  const target = item as unknown as MutableRecord;
  let deferred = removeUnknown(target, [
    'id', 'order', 'sourceIndex', 'plotKind', 'name', 'points', 'bindings', 'removed',
  ]);
  if (!CHART_PLOT_KINDS.has(item.plotKind) || !item.points
    || typeof item.points !== 'object' || Array.isArray(item.points)) {
    return { valid: false, deferred: true };
  }
  const xy = item.plotKind === 'scatter' || item.plotKind === 'bubble';
  const allowed = ['id', 'order', 'value', 'removed', ...(xy ? ['x'] : []),
    ...(item.plotKind === 'bubble' ? ['size'] : [])];
  for (const [pointId, point] of Object.entries(item.points)) {
    if (!point || typeof point !== 'object' || Array.isArray(point)) {
      delete item.points[pointId];
      deferred = true;
      continue;
    }
    const category = !xy ? categories[pointId] : undefined;
    if (category) {
      const targetPoint = point as unknown as MutableRecord;
      if (!own(targetPoint, 'id')) targetPoint.id = pointId;
      if (!own(targetPoint, 'order')) targetPoint.order = category.order;
      if (!own(targetPoint, 'value')) targetPoint.value = null;
    }
    deferred = removeUnknown(point as unknown as MutableRecord, allowed) || deferred;
    try { assertPointForPlot(point, pointId, item.plotKind); } catch {
      delete item.points[pointId];
      deferred = true;
    }
  }
  try { assertChartSeriesRecord(item, id, `图表系列 ${id}`, true); } catch {
    return { valid: false, deferred: true };
  }
  return { valid: true, deferred };
}

function trimAddedRecords<T>(
  target: Record<string, T>, source: Readonly<Record<string, unknown>>, limit: number,
): boolean {
  const added = Object.keys(target).filter((id) => !own(source, id)).sort();
  const allowed = Math.max(0, limit - Object.keys(source).length);
  for (const id of added.slice(allowed)) delete target[id];
  return added.length > allowed;
}

export function validateMaterializedRecords(
  categories: Record<string, ChartCategory>,
  series: Record<ChartSeriesId, Omit<ChartSeries, 'points'> & {
    points: Record<string, ChartPoint>; sourceTemplate?: true;
  }>,
  sourceCategories: Readonly<Record<string, ChartCategory>>,
  sourceSeries: Readonly<Record<string, StoredSeries>>,
): boolean {
  const sourcePlotKinds = new Set(Object.values(sourceSeries).map((item) => item.plotKind));
  let deferred = trimAddedRecords(categories, sourceCategories, MAX_CHART_POINTS);
  deferred = trimAddedRecords(series, sourceSeries, MAX_CHART_SERIES) || deferred;
  for (const [id, category] of Object.entries(categories)) {
    const source = sourceCategories[id];
    if (source) {
      if (category && typeof category === 'object' && !Array.isArray(category)) {
        deferred = sanitizeSourceCategory(category, source, id) || deferred;
      } else {
        categories[id] = structuredClone(source);
        deferred = true;
      }
      continue;
    }
    try { assertChartCategoryRecord(category, id, `图表类别 ${id}`); } catch {
      delete categories[id];
      deferred = true;
    }
  }
  for (const [id, item] of Object.entries(series)) {
    const source = sourceSeries[id];
    if (source) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        deferred = sanitizeSourceSeries(item, source, id) || deferred;
      } else {
        series[id as ChartSeriesId] = structuredClone(source);
        deferred = true;
      }
      continue;
    }
    if (!sourcePlotKinds.has(item?.plotKind)) {
      delete series[id as ChartSeriesId];
      deferred = true;
      continue;
    }
    const added = item && typeof item === 'object' && !Array.isArray(item)
      ? sanitizeAddedSeries(item, id, categories) : { valid: false, deferred: true };
    deferred = added.deferred || deferred;
    if (!added.valid) {
      // 先到达的后代字段显式保持 deferred；创建批次补齐全部叶字段后才进入语义数据集。
      delete series[id as ChartSeriesId];
    }
  }
  let cells = Object.values(series).reduce((sum, item) => sum + Object.keys(item.points).length, 0);
  if (cells > MAX_CHART_CELLS) {
    const added = Object.entries(series).flatMap(([seriesId, item]) =>
      Object.keys(item.points).filter((pointId) => !sourceSeries[seriesId]?.points[pointId])
        .map((pointId) => ({ seriesId, pointId })))
      .sort((left, right) => left.seriesId === right.seriesId
        ? left.pointId < right.pointId ? 1 : left.pointId > right.pointId ? -1 : 0
        : left.seriesId < right.seriesId ? 1 : left.seriesId > right.seriesId ? -1 : 0);
    for (const item of added) {
      if (cells <= MAX_CHART_CELLS) break;
      delete series[item.seriesId as ChartSeriesId].points[item.pointId];
      cells--;
      deferred = true;
    }
  }
  return deferred;
}
