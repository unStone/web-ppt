import type { EditDoc, ElementId } from '../types';
import type { CommandPatches, DocumentExtensionPatch } from '../commands/types';
import type { ChartDatasetState } from './types';
import { hydrateChartDataset } from './source';
import { chartPartForElement } from './locator';
import { chartSourceBytes } from './context';
import { workbookCanSync } from './workbook';
import type { WorkbookCellValue } from './workbook-read';
import { sharedCellFields as fields } from './shared-fields';
import { currentChartDatasetState } from './source';
import { sharedCellValue } from './shared-cell';
import type { SharedCellEdit } from './shared-cell';
import { sharedCategoryEdits } from './shared-category';
import { projectSharedRows } from './shared-rows';
import { removeSharedRecord } from './shared-record-remove';
import { validateSharedPatch, validateSharedOverrides } from './shared-validation';
import { projectSharedSeries } from './shared-series';
import type { SharedSeriesRemovals } from './shared-series';
import { sharedGroupForFrame as group, sharedGroupForWorkbook } from './shared-graph';
import type { SharedGroup } from './shared-graph';
import { sharedCacheSource, sharedCacheOverrides, validateSharedCachePatch } from './shared-cache';
import { sharedWorkbookSource } from './shared-workbook-source';
import { addedSeriesCommand, decodeAddedSeries } from './shared-added-records';
import type { AddedSeries } from './shared-added-records';
import { planAddedSeries } from './shared-added-plan';
import { mergeChartDatasetState } from './dataset-merge';
import { stageSharedRecords } from './shared-record-stage';
import { insertedCategoryCommand } from './shared-inserted-command';
import { projectInsertedCategories } from './shared-inserted-project';
import type { InsertedRows } from './shared-inserted-records';
import { insertedCellOverrides, insertedCellKey } from './shared-inserted-cells';
import { sharedCategoryFamily } from './shared-family';
import { insertedCellLane } from './shared-inserted-project';
import { sharedXYCommand } from './shared-xy-command';
import { projectSharedXY } from './shared-xy-project';
import type { SharedXYRecords } from './shared-xy-records';
import { assertSharedGrowthSpace } from './shared-growth-space';
export type { SharedGroup } from './shared-graph';
const NS = 'chart-shared';
interface SharedOverrides {
  cells?: Record<string, unknown>;
  rows?: Record<string, unknown>;
  series?: SharedSeriesRemovals;
  heads?: Record<string, Record<string, unknown>>;
  addedSeries?: AddedSeries;
  insertions?: InsertedRows;
  xyRecords?: SharedXYRecords;
}

function overrides(doc: EditDoc, workbook: string): SharedOverrides | undefined {
  return (doc.extensions?.[NS] as Record<string, SharedOverrides> | undefined)?.[workbook];
}

export const ownsSharedChart = (doc: EditDoc, id: ElementId): boolean => !!group(doc, id);

function cells(doc: EditDoc, workbook: string): Record<string, unknown> | undefined {
  return overrides(doc, workbook)?.cells;
}

function assign(state: ChartDatasetState, path: readonly string[], value: unknown): void {
  let target = state as unknown as Record<string, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[path[path.length - 1]] = value;
}

const sourceReasons = new WeakMap<SharedGroup, string | undefined>();
function sharedSourceReason(shared: SharedGroup, baseline: ReadonlyMap<string, WorkbookCellValue>, bytes: Uint8Array): string | undefined {
  if (sourceReasons.has(shared)) return sourceReasons.get(shared);
  const reason = readSharedSourceReason(shared, baseline, bytes);
  sourceReasons.set(shared, reason);
  return reason;
}

function readSharedSourceReason(shared: SharedGroup, baseline: ReadonlyMap<string, WorkbookCellValue>, bytes: Uint8Array): string | undefined {
  if (shared.reason) return shared.reason;
  const sources = shared.charts.map(chart => chart.state);
  for (const source of sources) {
    const sync = workbookCanSync(bytes, source, true, sources);
    if (!sync.ok) return sync.reason;
  }
  for (const chart of shared.charts) for (const field of chart.fields) {
    const cell = baseline.get(field.key) ?? { kind: 'blank', value: null };
    if (field.parent?.raw === null && cell.value === null && cell.kind !== 'unsupported') continue;
    const value = field.kind === 'text' ? cell.value === null && field.nullable ? null : String(cell.value ?? '') : cell.value;
    if (cell.kind === 'unsupported' || value !== field.value) return `共享单元格 ${decodeURIComponent(field.key)} 缓存与工作簿不一致`;
  }
}

/** 单元格覆盖只有一份，图表缓存始终由同一份覆盖投影，避免并发编辑留下两套真值。 */
export function sharedDatasetState(doc: EditDoc, id: ElementId, state: ChartDatasetState): ChartDatasetState {
  const shared = group(doc, id);
  if (!shared) return state;
  return projectSharedDataset(doc, shared, state);
}

export function projectSharedDataset(doc: EditDoc, shared: SharedGroup, state: ChartDatasetState): ChartDatasetState {
  const invalid = shared.charts.find(chart => chart.state.binding.mode !== 'workbook');
  if (invalid) {
    state.binding = { ...state.binding, mode: 'readonly', reason: `关联图表 ${invalid.id} 无法同步：${invalid.state.binding.reason}` };
    return state;
  }
  const { baseline } = sharedWorkbookSource(doc, shared.workbook);
  const reason = sharedSourceReason(shared, baseline, chartSourceBytes(doc, shared.workbook)!);
  if (reason) {
    state.binding = { ...state.binding, mode: 'readonly', reason };
    return state;
  }
  const resource = overrides(doc, shared.workbook);
  if (!resource) return state;
  const original = structuredClone(state);
  try {
    validateSharedOverrides(shared, resource, baseline);
    assertSharedGrowthSpace(shared, resource);
    const values = insertedCellOverrides(shared, resource);
    const heads = overrides(doc, shared.workbook)?.heads;
    const parents: Array<string | null> = [];
    for (const field of fields(state)) {
      if (field.parent) {
        const { level, raw } = field.parent;
        const head = heads?.[field.parent.family]?.[field.key];
        const changed = sharedCellValue(field.key, values, baseline);
        const replacement = Object.prototype.hasOwnProperty.call(values, field.key)
          ? changed === null ? null : String(changed) : head === true && raw === null ? String(field.value ?? '') : raw;
        const inherited = (head === false || head === undefined && raw === null)
          && (replacement === null || replacement === parents[level]);
        const value = inherited ? null : replacement;
        assign(state, field.path, value);
        if (value !== null) { parents.fill(null, level + 1); parents[level] = value; }
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(values, field.key)) continue;
      const changed = sharedCellValue(field.key, values, baseline);
      const value = field.kind === 'text' ? changed === null && field.nullable ? null : String(changed ?? '') : changed;
      assign(state, field.path, value);
      if (field.path[0] === 'categories' && field.path[2] === 'levels') {
        assign(state, ['categories', field.path[1], 'label'], String(value ?? ''));
      }
    }
    projectSharedRows(state, overrides(doc, shared.workbook)?.rows);
    projectSharedSeries(state, resource.series);
    projectInsertedCategories(shared, state, original, resource, baseline);
    projectSharedXY(shared, state, original, resource, baseline);
    if (resource.addedSeries) {
      state = mergeChartDatasetState(state, decodeAddedSeries(original, resource.addedSeries)).state;
      for (const plan of planAddedSeries(shared, resource, baseline)) {
        if (plan.part === state.binding.chartPart && state.series[plan.id]) {
          state.series[plan.id] = { ...state.series[plan.id], bindings: plan.state.series[plan.id].bindings };
        }
      }
    }
    return state;
  } catch (error) {
    original.binding = { ...original.binding, mode: 'readonly',
      reason: `共享覆盖无效：${error instanceof Error ? error.message : String(error)}` };
    return original;
  }
}

export function sharedCommandPatches(doc: EditDoc, id: ElementId, local: CommandPatches, origin: string): CommandPatches {
  const shared = group(doc, id);
  if (!shared) return local;
  const xy = sharedXYCommand(doc, shared, id, local, origin, overrides(doc, shared.workbook) ?? {},
    sharedWorkbookSource(doc, shared.workbook).baseline);
  if (xy) return xy;
  const inserted = insertedCategoryCommand(doc, shared, id, local, origin, overrides(doc, shared.workbook) ?? {},
    sharedWorkbookSource(doc, shared.workbook).baseline);
  if (inserted) return inserted;
  const added = addedSeriesCommand(shared.charts.find(chart => chart.id === id)!.state, shared.workbook, local);
  if (added) {
    const resource = overrides(doc, shared.workbook);
    const next = stageSharedRecords(resource?.addedSeries, added.forward as DocumentExtensionPatch[]);
    planAddedSeries(shared, { ...resource, addedSeries: next }, sharedWorkbookSource(doc, shared.workbook).baseline);
    return added;
  }
  const bindings = shared.charts.find(chart => chart.id === id)!.fields;
  const forward: DocumentExtensionPatch[] = [], inverse: DocumentExtensionPatch[] = [];
  const previous = cells(doc, shared.workbook) ?? {};
  const previousHeads = overrides(doc, shared.workbook)?.heads;
  const updates = new Map<string, SharedCellEdit>();
  if (local.forward.length === 1 && local.forward[0].path[5] === 'series' && local.forward[0].path[7] === 'removed') {
    const source = shared.charts.find(chart => chart.id === id)!.state;
    const index = Object.keys(source.series).indexOf(String(local.forward[0].path[6]));
    if (index < 0) throw new Error('共享系列没有来源身份');
    const part = source.binding.chartPart, key = String(index);
    const path = ['document', 'extensions', NS, shared.workbook, 'series', part, key] as const;
    const old = overrides(doc, shared.workbook)?.series?.[part]?.[key];
    return { forward: [{ op: 'set', path, value: true, origin }],
      inverse: [old === undefined ? { op: 'del', path, origin } : { op: 'set', path, value: old, origin }] };
  }
  if (local.forward.some(patch => patch.path[5] === 'categories' && patch.path[7] === 'removed')) {
    const removed = local.forward.find(patch => patch.path[5] === 'categories' && patch.path[7] === 'removed')!;
    const categoryId = String(removed.path[6]);
    const family = sharedCategoryFamily(shared, id), position = family.positions.get(id)?.get(categoryId);
    if (position === undefined) throw new Error('共享类别缺少来源记录位置');
    return removeSharedRecord(doc, shared, family, position, origin, overrides(doc, shared.workbook) ?? {},
      sharedWorkbookSource(doc, shared.workbook).baseline);
  }
  const categoryPatches = local.forward.filter(patch => patch.path[5] === 'categories');
  if (categoryPatches.length) {
    const source = shared.charts.find(chart => chart.id === id)!.state;
    const before = currentChartDatasetState(doc, id), after = structuredClone(before);
    for (const patch of categoryPatches) {
      if (patch.path[7] === 'levelClears') continue;
      if (patch.op !== 'set' || !bindings.some(field => JSON.stringify(field.path) === JSON.stringify(patch.path.slice(5)))) {
        throw new Error('共享工作簿的此类结构编辑尚未实现');
      }
      assign(after, patch.path.slice(5).map(String), patch.value);
    }
    const { parts, map } = sharedWorkbookSource(doc, shared.workbook);
    const touched = new Set(categoryPatches.flatMap(patch => bindings.filter(field => field.parent
      && JSON.stringify(field.path) === JSON.stringify(patch.path.slice(5))).map(field => field.key)));
    const addresses = new Map(fields(before).flatMap(field => {
      const original = bindings.find(binding => JSON.stringify(binding.path) === JSON.stringify(field.path));
      return original ? [[field.key, original.key] as const] : [];
    }));
    const virtual = new Map(fields(before).filter(field => field.path[0] === 'categories' && !(field.path[1] in source.categories))
      .map(field => [field.key, insertedCellKey(field.path[1], insertedCellLane(sharedCategoryFamily(shared, id), field.key))]));
    const currentTouched = new Set([...addresses].filter(([, original]) => touched.has(original)).map(([current]) => current));
    for (const [key, value] of sharedCategoryEdits(source, before, after, parts, map, currentTouched)) {
      // 新行从稳定父引用派生，来源组改名不能把派生值反写成另一份单元格覆盖。
      if (!addresses.has(key)) continue;
      updates.set(addresses.get(key) ?? key, 'parent' in value ? { parent: addresses.get(value.parent) ?? virtual.get(value.parent) ?? value.parent } : value);
    }
  }
  for (const patch of local.forward) {
    if (patch.path[5] === 'categories' && patch.path[7] === 'levelClears') continue;
    const field = bindings.find(field => JSON.stringify(field.path) === JSON.stringify(patch.path.slice(5)));
    if (!field || patch.op !== 'set') throw new Error('共享工作簿的此类结构编辑尚未实现');
    if (!field.parent) {
      const previous = updates.get(field.key);
      if (patch.path[7] === 'points' && previous && 'value' in previous && previous.value !== patch.value) {
        throw new Error('同一共享 XY 单元格不能同时写入不同数值');
      }
      if (!updates.has(field.key)) updates.set(field.key, { value: patch.value as string | number | null });
    }
    else {
      const path = ['document', 'extensions', NS, shared.workbook, 'heads', field.parent.family, field.key] as const;
      const old = previousHeads?.[field.parent.family]?.[field.key];
      forward.push({ op: 'set', path, value: patch.value !== null, origin });
      inverse.unshift(old === undefined ? { op: 'del', path, origin } : { op: 'set', path, value: old, origin });
    }
  }
  for (const [key, value] of updates) {
    const path = ['document', 'extensions', NS, shared.workbook, 'cells', key] as const;
    forward.push({ op: 'set', path, value: JSON.stringify(value), origin });
    inverse.unshift(Object.prototype.hasOwnProperty.call(previous, key)
      ? { op: 'set', path, value: previous[key], origin } : { op: 'del', path, origin });
  }
  return { forward, inverse };
}

export function sharedChartElements(doc: EditDoc, patch?: DocumentExtensionPatch): ElementId[] {
  if (!patch) return Object.values(doc.elements).filter(record => chartPartForElement(doc, record.id)).map(record => record.id);
  const workbooks = [patch.path[3]];
  return Object.values(doc.elements).filter(record => chartPartForElement(doc, record.id)
    && (workbooks.includes(chartPartForElement(doc, record.id)!)
      || workbooks.includes(hydrateChartDataset(doc, record.id, true).binding.workbookPart ?? ''))).map(record => record.id);
}

export function validateSharedChartPatch(doc: EditDoc, patch: DocumentExtensionPatch): void {
    if (patch.path[4] === 'dataset') return validateSharedCachePatch(doc, patch);
    const shared = sharedGroupForWorkbook(doc, patch.path[3]);
    if (!shared) throw new Error('图表没有共享工作簿绑定');
    const invalid = shared.charts.find(chart => chart.state.binding.mode !== 'workbook');
    if (invalid) throw new Error(`关联图表 ${invalid.id} 无法同步：${invalid.state.binding.reason}`);
    const { baseline } = sharedWorkbookSource(doc, shared.workbook);
    const sourceReason = sharedSourceReason(shared, baseline, chartSourceBytes(doc, shared.workbook)!);
    if (sourceReason) throw new Error(sourceReason);
    validateSharedPatch(shared, patch, baseline);
}

export function validateSharedDocument(doc: EditDoc): void {
  const resources = doc.extensions?.[NS];
  if (resources === undefined) return;
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) throw new Error('共享覆盖容器无效');
  for (const [workbook, resource] of Object.entries(resources)) {
    const cache = sharedCacheSource(doc, workbook);
    if (cache) { sharedCacheOverrides(doc, cache); continue; }
    const shared = sharedGroupForWorkbook(doc, workbook);
    if (!shared) throw new Error(`共享工作簿没有可校验的图表依赖：${workbook}`);
    validateSharedOverrides(shared, resource, sharedWorkbookSource(doc, workbook).baseline);
  }
}
