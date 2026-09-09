import { allocateElementId, compareFractionalIndex, fractionalIndexBetween, isLegacyExtensionReplay } from '@web-ppt/edit-core';
import type { ExtensionCommand, ExtensionPatch } from '../commands/types';
import type { Editor } from '../editor';
import { registerEditExtension } from '../extension-runtime';
import { validatePatchAgainstState } from './patch-validation';
import type { EditDoc, ElementId, FractionalIndex } from '../types';
import { projectChartElement } from './projection';
import { saveChartDatasets } from './save';
import {
  chartStateMatchesSource, currentChartDatasetState, hydrateChartDataset,
} from './source';
import type {
  ChartCategory, ChartDatasetState, ChartPlotKind, ChartPoint, ChartPointId,
  ChartSeriesId,
} from './types';
import {
  assertChartCategoryRecord, assertChartDictionary, assertChartIdentity, assertChartName,
  assertChartNumber, assertChartPointRecord, assertChartSeriesRecord, assertCategoryLevels,
  CHART_PLOT_KINDS, MAX_CHART_CELLS, MAX_CHART_POINTS, MAX_CHART_SERIES,
} from './validation';
import { chartPartForElement } from './locator';
import { orderedChartRecords } from './ordering';
import { categoryCommandPatches, assertCategoryCapacity } from './category-commands';
import type { CategoryPayload } from './category-commands';
import { sharedChartRuntime, sharedDatasetState } from './shared-runtime';
import { categoryHierarchyBinding } from './category-binding';

const NS = 'chart-data';

type Payload =
  | { op: 'set-series-name'; seriesId: ChartSeriesId; name: string }
  | CategoryPayload
  | { op: 'set-point'; seriesId: ChartSeriesId; pointId: ChartPointId;
    value?: number | null; x?: number | null; size?: number | null }
  | { op: 'add-series'; series: ChartDatasetState['series'][ChartSeriesId] }
  | { op: 'remove-series'; seriesId: ChartSeriesId }
  | { op: 'add-category'; category: ChartDatasetState['categories'][ChartPointId]; points: Record<ChartSeriesId, ChartPoint> }
  | { op: 'remove-category'; pointId: ChartPointId }
  | { op: 'add-point'; seriesId: ChartSeriesId; point: ChartPoint }
  | { op: 'remove-point'; seriesId: ChartSeriesId; pointId: ChartPointId };

type Editable = Pick<Editor, 'doc' | 'exec'>;

const own = (object: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

function assertChartRecordTarget(doc: EditDoc, id: ElementId): void {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改图表数据');
  const record = doc.elements[id];
  if (!record || !chartPartForElement(doc, id) || record.meta.editable !== 'frame') {
    throw new Error(`元素 ${id} 不是可编辑数据的经典图表`);
  }
}

function assertChart(doc: EditDoc, id: ElementId): ChartDatasetState {
  assertChartRecordTarget(doc, id);
  const state = currentChartDatasetState(doc, id);
  if (state.binding.mode === 'readonly') throw new Error(state.binding.reason ?? '图表数据只读');
  return state;
}

function assertChartPatchTarget(doc: EditDoc, id: ElementId): ChartDatasetState {
  assertChartRecordTarget(doc, id);
  const source = hydrateChartDataset(doc, id);
  const legacy = isLegacyExtensionReplay(doc, id, NS);
  // hydrate 已返回独立状态；会投影共享数据的路径在下方拒绝，普通字段校验无需再复制一份。
  const binding = (legacy ? source : sharedDatasetState(doc, id, source)).binding;
  if (binding.mode === 'readonly') throw new Error(binding.reason ?? '图表数据只读');
  if (!legacy && sharedChartRuntime()?.owns(doc, id)) throw new Error('共享图表需使用文档级补丁');
  return source;
}

function patch(
  id: ElementId, path: readonly string[], value: unknown, origin: string,
): ExtensionPatch {
  return { op: 'set', path: ['elements', id, 'ovr', 'extensions', NS, ...path], value, origin };
}

function del(id: ElementId, path: readonly string[], origin: string): ExtensionPatch {
  return { op: 'del', path: ['elements', id, 'ovr', 'extensions', NS, ...path], origin };
}

function inverseFor(
  id: ElementId, path: readonly string[], current: unknown, origin: string,
): ExtensionPatch {
  return current === undefined ? del(id, path, origin) : patch(id, path, current, origin);
}

function pair(
  id: ElementId, path: readonly string[], value: unknown, current: unknown, origin: string,
) {
  return { forward: [patch(id, path, value, origin)], inverse: [inverseFor(id, path, current, origin)] };
}

function recordLeaves(
  id: ElementId, path: readonly string[], value: object, origin: string,
): ExtensionPatch[] {
  const result: ExtensionPatch[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') {
      result.push(...recordLeaves(id, [...path, key], child as Record<string, unknown>, origin));
    } else result.push(patch(id, [...path, key], child, origin));
  }
  return result;
}

function recordIdentity(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}身份无效`);
  assertChartIdentity(value, value, label);
  return value;
}

function assertAddedSeries(value: unknown): asserts value is ChartDatasetState['series'][ChartSeriesId] {
  assertChartDictionary(value, '新增图表系列');
  const id = recordIdentity(value.id, '新增图表系列');
  assertChartSeriesRecord(value, id, '新增图表系列', true);
}

function assertAddedCategory(value: unknown): asserts value is ChartCategory {
  assertChartDictionary(value, '新增图表类别');
  const id = recordIdentity(value.id, '新增图表类别');
  assertChartCategoryRecord(value, id, '新增图表类别');
}

function assertAddedPoint(value: unknown, id: string, plotKind: ChartPlotKind): asserts value is ChartPoint {
  assertChartPointRecord(value, id, '新增图表数据点');
  if ((plotKind !== 'scatter' && plotKind !== 'bubble' && (own(value, 'x') || own(value, 'size')))
    || (plotKind === 'scatter' && own(value, 'size'))) {
    throw new Error('新增图表数据点与图种不匹配');
  }
}

function payloadOf(command: ExtensionCommand): Payload {
  const payload = command.payload as Partial<Payload> | null;
  if (!payload || typeof payload !== 'object' || typeof payload.op !== 'string') {
    throw new Error('图表数据命令无效');
  }
  return payload as Payload;
}

function commandPatches(doc: EditDoc, command: ExtensionCommand, origin: string) {
  const state = assertChart(doc, command.id);
  const payload = payloadOf(command);
  if (payload.op === 'set-series-name') {
    assertChartName(payload.name, '系列名称');
    const series = state.series[payload.seriesId];
    if (!series || series.removed) throw new Error(`图表系列不存在：${payload.seriesId}`);
    return pair(command.id, ['series', payload.seriesId, 'name'], payload.name, series.name, origin);
  }
  if (payload.op === 'set-category-label' || payload.op === 'set-category-path') {
    return categoryCommandPatches(doc, command.id, state, payload, origin);
  }
  if (payload.op === 'set-point') {
    const series = state.series[payload.seriesId];
    const point = series?.points[payload.pointId];
    if (!series || series.removed || !point || point.removed) throw new Error('图表数据点不存在');
    const fields = (['value', 'x', 'size'] as const).filter((field) => own(payload, field));
    if (!fields.length) throw new Error('图表数据点命令没有修改字段');
    const xy = series.plotKind === 'scatter' || series.plotKind === 'bubble';
    if (fields.includes('x') && !xy) throw new Error('只有散点或气泡图可以写 X 值');
    if (fields.includes('size') && series.plotKind !== 'bubble') {
      throw new Error('只有气泡图可以写大小');
    }
    const forward: ExtensionPatch[] = [];
    const inverse: ExtensionPatch[] = [];
    for (const field of fields) {
      assertChartNumber(payload[field], `数据点 ${field}`);
      const path = ['series', payload.seriesId, 'points', payload.pointId, field];
      forward.push(patch(command.id, path, payload[field], origin));
      inverse.unshift(inverseFor(command.id, path, point[field], origin));
    }
    return { forward, inverse };
  }
  if (payload.op === 'add-series') {
    assertAddedSeries(payload.series);
    if (Object.keys(state.series).length >= MAX_CHART_SERIES) throw new Error('图表系列数量已达上限');
    if (storedChartCells(state) + Object.keys(payload.series.points ?? {}).length > MAX_CHART_CELLS) {
      throw new Error('图表数据单元数量已达上限');
    }
    if (state.series[payload.series.id]) throw new Error(`图表系列身份重复：${payload.series.id}`);
    return {
      // 创建也拆成叶字段，乱序协同时后到的旧创建消息不会覆盖更新后的子字段。
      forward: [
        ...recordLeaves(command.id, ['series', payload.series.id], payload.series, origin),
        patch(command.id, ['series', payload.series.id, 'pointsReady'], true, origin),
        del(command.id, ['series', payload.series.id, 'removed'], origin),
      ],
      inverse: [patch(command.id, ['series', payload.series.id, 'removed'], true, origin)],
    };
  }
  if (payload.op === 'remove-series') {
    const series = state.series[payload.seriesId];
    if (!series || series.removed) throw new Error(`图表系列不存在：${payload.seriesId}`);
    return pair(command.id, ['series', payload.seriesId, 'removed'], true, series.removed, origin);
  }
  if (payload.op === 'add-category') {
    assertCategoryCapacity(state);
    assertAddedCategory(payload.category);
    const depth = categoryHierarchyBinding(state.series)?.hierarchy?.levels;
    if (payload.category.levels) {
      if (!depth) throw new Error('此图表没有多级类别');
      assertCategoryLevels(payload.category.levels, depth);
      if ((payload.category.levels[depth - 1] ?? '') !== payload.category.label) throw new Error('类别名称与叶级标签不一致');
    }
    assertChartDictionary(payload.points, '新增类别数据点');
    if (state.kind === 'xy') throw new Error('纯 XY 图不能新增类别');
    if (Object.keys(state.categories).length >= MAX_CHART_POINTS) throw new Error('图表类别数量已达上限');
    if (storedChartCells(state) + Object.keys(payload.points).length > MAX_CHART_CELLS) {
      throw new Error('图表数据单元数量已达上限');
    }
    if (state.categories[payload.category.id]) throw new Error(`图表类别身份重复：${payload.category.id}`);
    const categorySeries = orderedChartRecords(Object.values(state.series).filter((item) => !item.removed
      && item.plotKind !== 'scatter' && item.plotKind !== 'bubble'));
    const expected = new Set(categorySeries.map((item) => item.id));
    if (Object.keys(payload.points).length !== expected.size
      || Object.keys(payload.points).some((seriesId) => !expected.has(seriesId as ChartSeriesId))) {
      throw new Error('新增类别数据点没有覆盖全部类别系列');
    }
    for (const [seriesId, point] of Object.entries(payload.points)) {
      assertAddedPoint(point, payload.category.id, state.series[seriesId as ChartSeriesId].plotKind);
    }
    const forward = recordLeaves(
      command.id, ['categories', payload.category.id], payload.category, origin,
    );
    forward.push(del(command.id, ['categories', payload.category.id, 'removed'], origin));
    for (const [seriesId, point] of Object.entries(payload.points)) {
      forward.push(...recordLeaves(
        command.id, ['series', seriesId, 'points', point.id], point, origin,
      ));
      forward.push(del(command.id, ['series', seriesId, 'points', point.id, 'removed'], origin));
    }
    const inverse = [...Object.entries(payload.points).map(([seriesId, point]) => patch(
      command.id, ['series', seriesId, 'points', point.id, 'removed'], true, origin,
    )), patch(command.id, ['categories', payload.category.id, 'removed'], true, origin)];
    return { forward, inverse };
  }
  if (payload.op === 'remove-category') {
    if (state.kind === 'xy') throw new Error('纯 XY 图没有可删除类别');
    const category = state.categories[payload.pointId];
    if (!category || category.removed) throw new Error(`图表类别不存在：${payload.pointId}`);
    const forward = [patch(command.id, ['categories', payload.pointId, 'removed'], true, origin)];
    const inverse: ExtensionPatch[] = [];
    for (const series of orderedChartRecords(Object.values(state.series))) {
      if (series.points[payload.pointId]) {
        forward.push(patch(command.id, ['series', series.id, 'points', payload.pointId, 'removed'], true, origin));
        inverse.unshift(del(command.id, ['series', series.id, 'points', payload.pointId, 'removed'], origin));
      }
    }
    inverse.push(del(command.id, ['categories', payload.pointId, 'removed'], origin));
    return { forward, inverse };
  }
  if (payload.op === 'add-point') {
    const series = state.series[payload.seriesId];
    if (series) assertAddedPoint(payload.point, recordIdentity(payload.point?.id, '新增图表数据点'), series.plotKind);
    if (!series || series.removed || series.points[payload.point.id]) throw new Error('图表数据点身份无效');
    if (Object.keys(series.points).length >= MAX_CHART_POINTS) throw new Error('图表数据点数量已达上限');
    if (storedChartCells(state) >= MAX_CHART_CELLS) throw new Error('图表数据单元数量已达上限');
    return {
      forward: [
        ...recordLeaves(command.id, ['series', payload.seriesId, 'points', payload.point.id],
          payload.point, origin),
        del(command.id, ['series', payload.seriesId, 'points', payload.point.id, 'removed'], origin),
      ],
      inverse: [patch(command.id,
        ['series', payload.seriesId, 'points', payload.point.id, 'removed'], true, origin)],
    };
  }
  const series = state.series[payload.seriesId];
  const point = series?.points[payload.pointId];
  if (!series || series.removed || !point || point.removed) throw new Error('图表数据点不存在');
  if (series.plotKind !== 'scatter' && series.plotKind !== 'bubble') {
    throw new Error('只有散点或气泡系列可以独立删除数据点');
  }
  return pair(command.id, ['series', payload.seriesId, 'points', payload.pointId, 'removed'],
    true, point.removed, origin);
}


function validatePatch(doc: EditDoc, patchValue: ExtensionPatch, index: number): void {
  validatePatchAgainstState(assertChartPatchTarget(doc, patchValue.path[1]), patchValue, index);
}

function validatePatches(
  doc: EditDoc,
  patches: readonly { readonly patch: ExtensionPatch; readonly index: number }[],
): void {
  const states = new Map<ElementId, ChartDatasetState>();
  for (const { patch: patchValue, index } of patches) {
    const id = patchValue.path[1];
    let state = states.get(id);
    if (!state) {
      state = assertChartPatchTarget(doc, id);
      states.set(id, state);
    }
    validatePatchAgainstState(state, patchValue, index);
  }
}

function generateParts(doc: EditDoc, parts: Record<string, Uint8Array>): void {
  const plan = saveChartDatasets(doc); if (!plan) return;
  for (const [part, bytes] of Object.entries(plan.changes)) if (bytes) parts[part] = bytes;
}

registerEditExtension(NS, {
  command: (doc, command, origin) => {
    const local = commandPatches(doc, command, origin);
    return sharedChartRuntime()?.command(doc, command.id, local, origin) ?? local;
  },
  validatePatch,
  validatePatches,
  prune: (doc, id) => chartStateMatchesSource(doc, id),
  project: projectChartElement,
  beforeSave: saveChartDatasets,
  generateParts,
  copyParts: generateParts,
});

function lastOrder(values: readonly { order: FractionalIndex }[]): FractionalIndex | null {
  return values.reduce<FractionalIndex | null>((last, item) =>
    last === null || compareFractionalIndex(last, item.order) < 0 ? item.order : last, null);
}

function storedChartCells(state: ChartDatasetState): number {
  return Object.values(state.series)
    .reduce((sum, series) => sum + Object.keys(series.points).length, 0);
}

function exec(editor: Editable, id: ElementId, payload: Payload): void {
  editor.exec({ type: 'Extension', namespace: NS, id, payload });
}

export interface ChartDataEditor {
  setSeriesName(chartId: ElementId, seriesId: ChartSeriesId, name: string): void;
  setCategoryLabel(chartId: ElementId, pointId: ChartPointId, label: string): void;
  setCategoryPath(chartId: ElementId, pointId: ChartPointId, levels: readonly (string | null)[]): void;
  setCategoryLevel(chartId: ElementId, pointId: ChartPointId, level: number, value: string | null): void;
  setValue(chartId: ElementId, seriesId: ChartSeriesId, pointId: ChartPointId, value: number | null): void;
  setPoint(chartId: ElementId, seriesId: ChartSeriesId, pointId: ChartPointId,
    value: { value?: number | null; x?: number | null; size?: number | null }): void;
  addSeries(chartId: ElementId, name: string, plotKind?: ChartPlotKind): ChartSeriesId;
  removeSeries(chartId: ElementId, seriesId: ChartSeriesId): void;
  addCategory(chartId: ElementId, labelOrPath: string | readonly (string | null)[]): ChartPointId;
  removeCategory(chartId: ElementId, pointId: ChartPointId): void;
  addPoint(chartId: ElementId, seriesId: ChartSeriesId,
    value: { value: number | null; x?: number | null; size?: number | null }): ChartPointId;
  removePoint(chartId: ElementId, seriesId: ChartSeriesId, pointId: ChartPointId): void;
}

export function chartDataEditor(editor: Editable): ChartDataEditor {
  return {
    setSeriesName: (chartId, seriesId, name) => exec(editor, chartId,
      { op: 'set-series-name', seriesId, name }),
    setCategoryLabel: (chartId, pointId, label) => exec(editor, chartId,
      { op: 'set-category-label', pointId, label }),
    setCategoryPath: (chartId, pointId, levels) => exec(editor, chartId,
      { op: 'set-category-path', pointId, levels }),
    setCategoryLevel: (chartId, pointId, level, value) => {
      const category = assertChart(editor.doc, chartId).categories[pointId];
      if (!category?.levels || !Number.isInteger(level) || level < 0 || level >= category.levels.length) {
        throw new Error('图表类别层级索引无效');
      }
      const levels = [...category.levels]; levels[level] = value;
      exec(editor, chartId, { op: 'set-category-path', pointId, levels });
    },
    setValue: (chartId, seriesId, pointId, value) => exec(editor, chartId,
      { op: 'set-point', seriesId, pointId, value }),
    setPoint: (chartId, seriesId, pointId, value) => exec(editor, chartId,
      { op: 'set-point', seriesId, pointId, ...value }),
    addSeries: (chartId, name, plotKind) => {
      assertChartName(name, '系列名称');
      const state = assertChart(editor.doc, chartId);
      const known = orderedChartRecords(Object.values(state.series));
      if (known.length >= MAX_CHART_SERIES) throw new Error('图表系列数量已达上限');
      const visible = known.filter((series) => !series.removed);
      const mode = plotKind ?? visible[0]?.plotKind ?? known[0]?.plotKind ?? 'bar';
      if (!CHART_PLOT_KINDS.has(mode) || !known.some((series) => series.plotKind === mode)) {
        throw new Error(`来源图表没有 ${mode} 绘图区，不能新增该图种系列`);
      }
      const addedCells = mode === 'scatter' || mode === 'bubble' ? 0
        : Object.values(state.categories).filter((item) => !item.removed).length;
      if (storedChartCells(state) + addedCells > MAX_CHART_CELLS) {
        throw new Error('图表数据单元数量已达上限');
      }
      const id = `${allocateElementId(editor.doc)}:series` as ChartSeriesId;
      const xy = mode === 'scatter' || mode === 'bubble';
      const points: Record<ChartPointId, ChartPoint> = Object.create(null);
      // 类别矩阵由稳定类别身份确定性补全，避免一次新增系列广播数万叶补丁。
      const usedSourceIndices = new Set(visible.map((series) => series.sourceIndex));
      let sourceIndex = 0;
      while (usedSourceIndices.has(sourceIndex)) sourceIndex++;
      const series: ChartDatasetState['series'][ChartSeriesId] = {
        id, order: fractionalIndexBetween(lastOrder(visible), null), sourceIndex, plotKind: mode,
        name, points,
        bindings: { name: { formula: null, cache: 'literal' },
          ...(xy ? { x: { formula: null, cache: 'literal' }, y: { formula: null, cache: 'literal' } }
            : { categories: { formula: null, cache: 'literal' }, values: { formula: null, cache: 'literal' } }),
          ...(mode === 'bubble' ? { size: { formula: null, cache: 'literal' } } : {}) },
      };
      exec(editor, chartId, { op: 'add-series', series });
      return id;
    },
    removeSeries: (chartId, seriesId) => exec(editor, chartId, { op: 'remove-series', seriesId }),
    addCategory: (chartId, labelOrPath) => {
      const state = assertChart(editor.doc, chartId);
      assertCategoryCapacity(state);
      const depth = categoryHierarchyBinding(state.series)?.hierarchy?.levels;
      if (typeof labelOrPath !== 'string') {
        if (!depth) throw new Error('此图表没有多级类别');
        assertCategoryLevels(labelOrPath, depth);
      }
      const label = typeof labelOrPath === 'string' ? labelOrPath : labelOrPath[labelOrPath.length - 1] ?? '';
      assertChartName(label, '类别名称');
      const levels = depth ? typeof labelOrPath === 'string'
        ? [...Array<string | null>(depth - 1).fill(null), label] : [...labelOrPath] : undefined;
      if (state.kind === 'xy') throw new Error('纯 XY 图不能新增类别');
      if (Object.keys(state.categories).length >= MAX_CHART_POINTS) throw new Error('图表类别数量已达上限');
      const addedCells = Object.values(state.series).filter((item) => !item.removed
        && item.plotKind !== 'scatter' && item.plotKind !== 'bubble').length;
      if (storedChartCells(state) + addedCells > MAX_CHART_CELLS) {
        throw new Error('图表数据单元数量已达上限');
      }
      const visible = orderedChartRecords(Object.values(state.categories).filter((item) => !item.removed));
      const id = `${allocateElementId(editor.doc)}:category` as ChartPointId;
      const order = fractionalIndexBetween(lastOrder(visible), null);
      const points: Record<ChartSeriesId, ChartPoint> = Object.create(null);
      for (const series of orderedChartRecords(Object.values(state.series).filter((item) => !item.removed
        && item.plotKind !== 'scatter' && item.plotKind !== 'bubble'))) {
        points[series.id] = { id, order, value: null };
      }
      exec(editor, chartId, { op: 'add-category', category: { id, order, label,
        ...(levels ? { levels, levelParent: visible[visible.length - 1]?.id ?? null } : {}) }, points });
      return id;
    },
    removeCategory: (chartId, pointId) => exec(editor, chartId, { op: 'remove-category', pointId }),
    addPoint: (chartId, seriesId, value) => {
      assertChartNumber(value.value, '数据点 value');
      const state = assertChart(editor.doc, chartId);
      const series = state.series[seriesId];
      if (!series || (series.plotKind !== 'scatter' && series.plotKind !== 'bubble')) {
        throw new Error('只有散点或气泡系列可以独立新增数据点');
      }
      if (Object.keys(series.points).length >= MAX_CHART_POINTS) throw new Error('图表数据点数量已达上限');
      if (storedChartCells(state) >= MAX_CHART_CELLS) throw new Error('图表数据单元数量已达上限');
      if (own(value, 'x')) assertChartNumber(value.x, '数据点 x');
      if (own(value, 'size')) assertChartNumber(value.size, '数据点 size');
      if (own(value, 'size') && series.plotKind !== 'bubble') throw new Error('只有气泡图可以写大小');
      const visible = orderedChartRecords(Object.values(series.points).filter((point) => !point.removed));
      const id = `${allocateElementId(editor.doc)}:point` as ChartPointId;
      const point: ChartPoint = {
        id, order: fractionalIndexBetween(lastOrder(visible), null), value: value.value,
        ...(own(value, 'x') ? { x: value.x } : {}),
        ...(own(value, 'size') ? { size: value.size } : {}),
      };
      exec(editor, chartId, { op: 'add-point', seriesId, point });
      return id;
    },
    removePoint: (chartId, seriesId, pointId) => exec(editor, chartId,
      { op: 'remove-point', seriesId, pointId }),
  };
}
