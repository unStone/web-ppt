import type { ChartDatasetState, ChartPointId } from './types';
import type { SharedGroup } from './shared';
import { sharedCategoryFields } from './shared-fields';
import { chartFormula, columnName, parseChartFormula } from './formula';
import { sharedCellAddress } from './shared-address';
import { sharedCategoryFamily } from './shared-family';
import type { SharedCategoryFamily } from './shared-family';
export { sharedCellAddress } from './shared-address';
import { workbookCellKey } from './workbook-read';
import type { WorkbookCellValue } from './workbook-read';
import { reconcileCategoryMatrix } from './category-matrix';
import { MAX_CHART_CELLS } from './limits';

export interface RemovedCell { readonly horizontal: boolean; readonly end: number }
export type RemovedCells = Readonly<Record<string, unknown>>;

export function removedCell(raw: unknown): RemovedCell {
  if (typeof raw !== 'string' || raw.length > 64) throw new Error('共享行删除标记无效');
  const value = JSON.parse(raw) as RemovedCell;
  if (!value || typeof value.horizontal !== 'boolean' || !Number.isInteger(value.end)
    || value.end < 1 || value.end > (value.horizontal ? 16_384 : 1_048_576)) throw new Error('共享行删除范围无效');
  return value;
}

/** 原地址是记录身份，删除范围只描述物理压紧区域；其后的编辑不按当前显示行号重新寻址。 */
export function sharedRowPlan(shared: SharedGroup, id: string, categoryId: string,
  baseline: ReadonlyMap<string, WorkbookCellValue>): Map<string, RemovedCell> {
  const target = shared.charts.find(chart => chart.id === id)!;
  const family = sharedCategoryFamily(shared, id);
  const point = sharedCategoryFields(target.state).find(field => field.path[0] === 'categories' && field.path[1] === categoryId);
  if (!point) throw new Error('共享类别没有来源单元格');
  const location = sharedCellAddress(point.key), position = family.horizontal ? location.column : location.row;
  return sharedRecordRemovalPlan(family, position, baseline);
}

export function sharedRecordRemovalPlan(family: SharedCategoryFamily, position: number,
  baseline: ReadonlyMap<string, WorkbookCellValue>): Map<string, RemovedCell> {
  const { sheet, horizontal, lanes, start, end, keys } = family;
  if (![...family.positions.values(), ...family.xyOwners.map(owner => owner.positions)].some(positions => [...positions.values()].includes(position))) {
    throw new Error('共享删除位置不是来源记录');
  }
  if ((end - start + 1) * lanes.size > MAX_CHART_CELLS) throw new Error('共享删行区域超过安全上限');
  const result = new Map<string, RemovedCell>();
  for (const lane of lanes) {
    for (let axis = start; axis <= end; axis++) {
      const key = workbookCellKey(sheet, `${columnName(horizontal ? axis : lane)}${horizontal ? lane : axis}`);
      const cell = baseline.get(key);
      if (!keys.has(key) && cell && (cell.kind === 'unsupported' || cell.value !== null)) {
        throw new Error(`共享删行区域 ${decodeURIComponent(key)} 被其他内容占用`);
      }
    }
    result.set(workbookCellKey(sheet, `${columnName(horizontal ? position : lane)}${horizontal ? lane : position}`), { horizontal, end });
  }
  return result;
}

export function sharedRowPlanForCell(shared: SharedGroup, key: string, baseline: ReadonlyMap<string, WorkbookCellValue>) {
  const cell = sharedCellAddress(key);
  for (const chart of shared.charts) {
    if (!Object.keys(chart.state.categories).length) continue;
    const family = sharedCategoryFamily(shared, chart.id);
    const position = family.horizontal ? cell.column : cell.row, lane = family.horizontal ? cell.row : cell.column;
    if (family.sheet === cell.sheet && family.lanes.has(lane) && position >= family.start && position <= family.end) {
      return sharedRecordRemovalPlan(family, position, baseline);
    }
  }
  throw new Error('共享行不属于图表来源');
}

export function shiftedCell(key: string, rows: RemovedCells, inclusive = false): string {
  const cell = sharedCellAddress(key);
  let row = cell.row, column = cell.column;
  for (const [removed, raw] of Object.entries(rows)) {
    const origin = sharedCellAddress(removed), { horizontal, end } = removedCell(raw);
    const axis = horizontal ? cell.column : cell.row, position = horizontal ? origin.column : origin.row;
    if (origin.sheet !== cell.sheet || (horizontal ? origin.row !== cell.row : origin.column !== cell.column)
      || axis > end || (inclusive ? axis < position : axis <= position)) continue;
    if (horizontal) column--; else row--;
  }
  return workbookCellKey(cell.sheet, `${columnName(Math.max(1, column))}${Math.max(1, row)}`);
}

export function projectSharedRows(state: ChartDatasetState, rows: RemovedCells | undefined): void {
  if (!rows) return;
  for (const field of sharedCategoryFields(state)) if (Object.prototype.hasOwnProperty.call(rows, field.key)) {
    const categoryId = field.path[0] === 'categories' ? field.path[1] : field.path[3];
    const category = state.categories[categoryId as ChartPointId];
    if (category) (category as { removed?: true }).removed = true;
  }
  reconcileCategoryMatrix(state);
  for (const series of Object.values(state.series)) for (const [name, binding] of Object.entries(series.bindings)) {
    if (name === 'name') continue;
    const range = parseChartFormula(binding?.formula ?? null);
    if (!range) continue;
    const start = sharedCellAddress(shiftedCell(workbookCellKey(range.sheet, `${columnName(range.startColumn)}${range.startRow}`), rows));
    const end = sharedCellAddress(shiftedCell(workbookCellKey(range.sheet, `${columnName(range.endColumn)}${range.endRow}`), rows, true));
    (series.bindings as Record<string, unknown>)[name] = { ...binding, formula: chartFormula({ ...range,
      startColumn: start.column, startRow: start.row, endColumn: Math.max(start.column, end.column), endRow: Math.max(start.row, end.row) }) };
  }
}
