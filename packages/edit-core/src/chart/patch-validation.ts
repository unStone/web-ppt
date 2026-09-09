import type { ExtensionPatch } from '../commands/types';
import type { ChartDatasetState, ChartPlotKind } from './types';
import { assertChartIdentity, assertChartName, assertChartNumber, assertChartOrder, CHART_PLOT_KINDS } from './validation';
import { categoryHierarchyBinding } from './category-binding';

function recordIdentity(value: unknown, label: string): void {
  assertChartIdentity(value, value as string, label);
}

export function validatePatchAgainstState(
  state: ChartDatasetState, patchValue: ExtensionPatch, index: number,
): void {
  if (patchValue.path[4] !== 'chart-data') throw new Error(`Patch ${index} 的图表命名空间无效`);
  const path = patchValue.path.slice(5);
  const category = path[0] === 'categories' && path.length === 3
    && ['id', 'order', 'label', 'levelParent', 'removed'].includes(path[2]);
  const level = path[0] === 'categories' && path.length === 4 && ['levels', 'levelClears'].includes(path[2]);
  if (level) {
    const depth = categoryHierarchyBinding(state.series)?.hierarchy?.levels;
    if (!depth || !/^(0|[1-9]\d*)$/.test(path[3]) || Number(path[3]) >= depth) throw new Error('图表类别层级索引无效');
    if (patchValue.op === 'set' && path[2] === 'levelClears' && patchValue.value !== null) recordIdentity(patchValue.value, '类别层级清空前驱');
    if (patchValue.op === 'set' && path[2] === 'levels' && patchValue.value !== null) assertChartName(patchValue.value, '类别层级');
  }
  const series = path[0] === 'series' && path.length === 3
    && ['id', 'order', 'sourceIndex', 'plotKind', 'name', 'pointsReady', 'removed'].includes(path[2]);
  const point = path[0] === 'series' && path.length === 5 && path[2] === 'points'
    && ['id', 'order', 'value', 'x', 'size', 'removed'].includes(path[4]);
  const binding = path[0] === 'series' && path.length === 5 && path[2] === 'bindings'
    && ['name', 'categories', 'values', 'x', 'y', 'size'].includes(path[3])
    && ['formula', 'cache'].includes(path[4]);
  if (!(patchValue.op === 'del' && path.length === 0) && !category && !level && !series && !point && !binding) {
    throw new Error(`Patch ${index} 的图表路径不受支持`);
  }
  if (category && state.kind === 'xy') throw new Error(`Patch ${index} 的纯 XY 图不能包含类别`);
  if (patchValue.op === 'set') {
    const leaf = path[path.length - 1];
    if (leaf === 'id') assertChartIdentity(
      patchValue.value, point ? path[3] : path[1], `Patch ${index} 的身份`,
    );
    if (leaf === 'order') assertChartOrder(patchValue.value, `Patch ${index} 的顺序`);
    if (leaf === 'levelParent' && patchValue.value !== null) recordIdentity(patchValue.value, '类别前驱');
    if (leaf === 'name' || leaf === 'label') assertChartName(patchValue.value, `Patch ${index} 的名称`);
    if (leaf === 'removed' && patchValue.value !== true) throw new Error(`Patch ${index} 的删除标记无效`);
    if (leaf === 'sourceIndex' && (!Number.isInteger(patchValue.value)
      || Number(patchValue.value) < 0 || Number(patchValue.value) > 0x7fff_ffff)) {
      throw new Error(`Patch ${index} 的系列索引无效`);
    }
    if (leaf === 'plotKind' && !CHART_PLOT_KINDS.has(patchValue.value as ChartPlotKind)) {
      throw new Error(`Patch ${index} 的图种无效`);
    }
    if (leaf === 'plotKind' && !Object.values(state.series)
      .some((item) => item.plotKind === patchValue.value)) {
      throw new Error(`Patch ${index} 的图种没有可继承的来源绘图区`);
    }
    if (leaf === 'pointsReady' && patchValue.value !== true) {
      throw new Error(`Patch ${index} 的空数据点标记无效`);
    }
    if (leaf === 'formula' && patchValue.value !== null) throw new Error(`Patch ${index} 不能注入来源公式`);
    if (leaf === 'cache' && patchValue.value !== 'literal') throw new Error(`Patch ${index} 的缓存类型无效`);
    if (leaf === 'value' || leaf === 'x' || leaf === 'size') {
      assertChartNumber(patchValue.value, `Patch ${index} 的 ${leaf}`);
      // 图种叶与点叶可乱序到达；最终物化统一隔离不适用字段，校验不能依赖瞬时到达顺序。
    }
  }
}
