import type { DocumentExtensionPatch } from '../commands/types';
import type { SharedGroup } from './shared';
import type { WorkbookCellValue } from './workbook-read';
import { sharedRowPlanForCell } from './shared-rows';
import { decodeSharedCell } from './shared-cell';
import { assertChartName, MAX_CHART_CELLS } from './validation';
import { validateAddedSeries, validateAddedSeriesPatch } from './shared-added-records';
import { validateInsertedPatch, validateInsertedRows } from './shared-inserted-records';
import { insertedCellReference, validateInsertedCellReference } from './shared-inserted-cells';
import { validateXYPatch, validateXYRecords } from './shared-xy-records';

export function validateSharedPatch(shared: SharedGroup, patch: DocumentExtensionPatch,
  baseline: ReadonlyMap<string, WorkbookCellValue>): void {
  if (patch.path[4] === 'addedSeries') return validateAddedSeriesPatch(shared, patch);
  if (patch.path[4] === 'insertions') return validateInsertedPatch(shared, patch);
  if (patch.path[4] === 'xyRecords') return validateXYPatch(shared, patch);
  if (patch.path[4] === 'series') {
    const source = shared.charts.find(chart => chart.state.binding.chartPart === patch.path[5])?.state;
    if (patch.path.length !== 7 || !source || !/^(0|[1-9]\d*)$/.test(patch.path[6])
      || !Object.values(source.series)[Number(patch.path[6])] || patch.op === 'set' && patch.value !== true) {
      throw new Error('共享系列删除标记无效');
    }
    return;
  }
  if (patch.path[4] === 'rows') {
    if (patch.path.length !== 6) throw new Error('共享行删除路径无效');
    const plan = sharedRowPlanForCell(shared, patch.path[5], baseline);
    if (!plan.has(patch.path[5]) || patch.op === 'set' && JSON.stringify(plan.get(patch.path[5])) !== patch.value) {
      throw new Error('共享行删除范围与来源依赖不符');
    }
    return;
  }
  if (patch.path[4] === 'heads') {
    if (patch.path.length !== 7 || !shared.charts.some(chart => chart.fields.some(field => field.key === patch.path[6]
      && field.parent?.family === patch.path[5])) || patch.op === 'set' && typeof patch.value !== 'boolean') {
      throw new Error('共享类别组首标记无效');
    }
    return;
  }
  const fields = shared.charts.flatMap(chart => chart.fields).filter(field => field.key === patch.path[5]);
  if (patch.path.length !== 6 || patch.path[4] !== 'cells' || !fields.length) throw new Error('共享工作簿单元格不属于此编辑图');
  if (patch.op === 'del') return;
  const cell = decodeSharedCell(patch.value);
  if ('parent' in cell) {
    if (insertedCellReference(cell.parent)) return validateInsertedCellReference(shared, patch.path[5], cell.parent);
    const valid = shared.charts.some(chart => {
      const target = chart.fields.findIndex(field => field.key === patch.path[5] && field.parent);
      const parent = chart.fields.findIndex(field => field.key === cell.parent && field.parent);
      return parent >= 0 && target > parent && chart.fields[parent].parent?.level === chart.fields[target].parent?.level;
    });
    if (!valid) throw new Error('共享类别延续引用必须指向同一层级的前组');
    return;
  }
  if (fields.some(field => field.kind === 'number')
    && cell.value !== null && (typeof cell.value !== 'number' || !Number.isFinite(cell.value))) {
    throw new Error('共享工作簿单元格值类型无效');
  }
  if (typeof cell.value === 'string') assertChartName(cell.value, '共享工作簿文本');
}

function dictionary(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('共享覆盖容器无效');
  return value as Record<string, unknown>;
}

/** 恢复可先于按需扩展加载；投影和保存仍须校验完整覆盖，不能只信任在线补丁入口。 */
export function validateSharedOverrides(shared: SharedGroup, resource: unknown,
  baseline: ReadonlyMap<string, WorkbookCellValue>): void {
  let count = 0;
  const validate = (tail: readonly string[], value: unknown) => {
    if (++count > MAX_CHART_CELLS) throw new Error('共享覆盖单元数量超限');
    validateSharedPatch(shared, { op: 'set', origin: 'restore', value,
      path: ['document', 'extensions', 'chart-shared', shared.workbook, ...tail] }, baseline);
  };
  for (const [section, entries] of Object.entries(dictionary(resource))) {
    if (section === 'addedSeries') { validateAddedSeries(shared, entries); continue; }
    if (section === 'insertions') { validateInsertedRows(shared, entries); continue; }
    if (section === 'xyRecords') { validateXYRecords(shared, entries); continue; }
    if (!['cells', 'heads', 'rows', 'series'].includes(section)) throw new Error('共享覆盖包含未知字段');
    for (const [key, value] of Object.entries(dictionary(entries))) {
      if (section === 'heads' || section === 'series') {
        for (const [cell, head] of Object.entries(dictionary(value))) validate([section, key, cell], head);
      } else validate([section, key], value);
    }
  }
}
