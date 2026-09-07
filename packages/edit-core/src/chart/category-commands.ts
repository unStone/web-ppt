import type { ExtensionPatch } from '../commands/types';
import type { ChartCategory, ChartDatasetState, ChartPointId } from './types';
import type { EditDoc } from '../types';
import { MAX_CHART_CELLS } from './limits';
import { orderedChartRecords } from './ordering';
import { assertCategoryLevels, assertChartName } from './validation';

export type CategoryPayload =
  | { op: 'set-category-label'; pointId: ChartPointId; label: string }
  | { op: 'set-category-path'; pointId: ChartPointId; levels: readonly (string | null)[] };

export function categoryCommandPatches(doc: EditDoc, id: string, state: ChartDatasetState, payload: CategoryPayload, origin: string) {
  if (state.kind === 'xy') throw new Error('纯 XY 图没有可编辑类别');
  const category = state.categories[payload.pointId];
  if (!category || category.removed) throw new Error(`图表类别不存在：${payload.pointId}`);
  if (payload.op === 'set-category-path') {
    if (!category.levels) throw new Error('此图表没有多级类别');
    assertCategoryLevels(payload.levels, category.levels.length);
    return categoryLevelPatches(doc, id, category, payload.levels, origin, previousCategoryId(state, category.id));
  }
  assertChartName(payload.label, '类别名称');
  if (category.levels) return categoryLevelPatches(doc, id, category,
    [...category.levels.slice(0, -1), payload.label], origin);
  const path = ['elements', id, 'ovr', 'extensions', 'chart-data', 'categories', category.id, 'label'] as const;
  return { forward: [{ op: 'set', path, value: payload.label, origin } as ExtensionPatch],
    inverse: [{ op: 'set', path, value: category.label, origin } as ExtensionPatch] };
}

export function previousCategoryId(state: ChartDatasetState, id: ChartPointId): ChartPointId | null {
  const categories = orderedChartRecords(Object.values(state.categories).filter(category => !category.removed));
  return categories[categories.findIndex(category => category.id === id) - 1]?.id ?? null;
}

export function assertCategoryCapacity(state: ChartDatasetState): void {
  const depth = Object.values(state.series).find(series => series.bindings.categories?.hierarchy)?.bindings.categories?.hierarchy?.levels;
  if (depth && (Object.keys(state.categories).length + 1) * depth > MAX_CHART_CELLS) {
    throw new Error('图表类别层级单元数量已达上限');
  }
}

export function categoryLevelOverride(doc: EditDoc, id: string, categoryId: string, level: number): string | null | undefined {
  const state = doc.elements[id]?.ovr.extensions?.['chart-data'] as {
    categories?: Record<string, { levels?: Record<string, unknown> }>;
  } | undefined;
  const value = state?.categories?.[categoryId]?.levels?.[level];
  return value === null || typeof value === 'string' ? value : undefined;
}

function categoryLevelCleared(doc: EditDoc, id: string, categoryId: string, level: number): string | null | undefined {
  const state = doc.elements[id]?.ovr.extensions?.['chart-data'] as {
    categories?: Record<string, { levelClears?: Record<string, unknown> }>;
  } | undefined;
  const value = state?.categories?.[categoryId]?.levelClears?.[level];
  return value === null || typeof value === 'string' ? value : undefined;
}

export function categoryLevelPatches(
  doc: EditDoc, id: string, category: ChartCategory, levels: readonly (string | null)[], origin: string,
  previousId: ChartPointId | null = null,
) {
  const forward: ExtensionPatch[] = [], inverse: ExtensionPatch[] = [];
  levels.forEach((value, index) => {
    const current = category.levels?.[index];
    if (value === current) return;
    const path = ['elements', id, 'ovr', 'extensions', 'chart-data', 'categories', category.id, 'levels', String(index)] as const;
    forward.push({ op: 'set', path, value, origin });
    // 自动提升的组首不是覆盖值；撤销必须恢复原覆盖，不能把提升结果固定成另一个组。
    const previous = categoryLevelOverride(doc, id, category.id, index);
    inverse.unshift(previous === undefined ? { op: 'del', path, origin } : { op: 'set', path, value: previous, origin });
    const cleared = categoryLevelCleared(doc, id, category.id, index);
    if (index < levels.length - 1 && (value === null || cleared !== undefined)) {
      const clearPath = ['elements', id, 'ovr', 'extensions', 'chart-data', 'categories', category.id, 'levelClears', String(index)] as const;
      forward.push(value === null ? { op: 'set', path: clearPath, value: previousId, origin } : { op: 'del', path: clearPath, origin });
      inverse.unshift(cleared !== undefined ? { op: 'set', path: clearPath, value: cleared, origin } : { op: 'del', path: clearPath, origin });
    }
  });
  return { forward, inverse };
}
