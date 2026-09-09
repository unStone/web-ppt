import type { ChartDatasetState, ChartPoint, ChartPointId, ChartSeriesId } from './types';
import { assertChartDictionary, validateMaterializedRecords } from './validation';
import { reconcileCategoryMatrix } from './category-matrix';

function overlayState(target: Record<string, unknown>, sparse: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(sparse)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const current = target[key];
      if (key === 'levels') {
        target[key] = Object.assign(Array.isArray(current) ? [...current] : [], value);
        continue;
      }
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


export function mergeChartDatasetState(source: ChartDatasetState, sparse: unknown) {
  if (sparse === undefined) {
    reconcileCategoryMatrix(source);
    return { state: source, deferred: false };
  }
  if (!sparse || typeof sparse !== 'object' || Array.isArray(sparse)) {
    throw new Error('图表的稀疏覆盖无效');
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
  return { state: merged, deferred };
}
