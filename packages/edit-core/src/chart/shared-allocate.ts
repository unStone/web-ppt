import { chartFormula, columnName } from './formula';
import type { ChartFormulaBinding } from './types';
import { sharedCellAddress } from './shared-rows';
import { workbookCellKey } from './workbook-read';
import type { WorkbookCellValue } from './workbook-read';
import { MAX_CHART_CELLS } from './limits';

/** 单次规划共享全部预约和搜索额度，避免不同图表各自认领同一块空白。 */
export function sharedSeriesAllocator(reserved: Set<string>, baseline: ReadonlyMap<string, WorkbookCellValue>) {
  let visited = 0;
  return (sheet: string, horizontal: boolean, start: number, count: number) => {
    const header = start > 1 ? start - 1 : start + count;
    const occupied = [...reserved].map(sharedCellAddress).filter(cell => cell.sheet === sheet);
    let lane = occupied.reduce((max, cell) => Math.max(max, horizontal ? cell.row : cell.column), 0) + 1;
    const key = (axis: number) => workbookCellKey(sheet, `${columnName(horizontal ? axis : lane)}${horizontal ? lane : axis}`);
    const axes = [header, ...Array.from({ length: count }, (_, index) => start + index)];
    const available = () => {
      for (const axis of axes) {
        if (++visited > MAX_CHART_CELLS) throw new Error('共享新增系列区域搜索超过安全上限');
        const address = key(axis), cell = baseline.get(address);
        if (reserved.has(address) || cell && (cell.kind === 'unsupported' || cell.value !== null)) return false;
      }
      return true;
    };
    while (lane <= (horizontal ? 1_048_576 : 16_384) && !available()) lane++;
    if (lane > (horizontal ? 1_048_576 : 16_384)) throw new Error('工作簿没有可分配的共享系列区域');
    for (const axis of axes) reserved.add(key(axis));
    const binding = (firstAxis: number, lastAxis: number, cache: 'string' | 'number'): ChartFormulaBinding => {
      const first = sharedCellAddress(key(firstAxis)), last = sharedCellAddress(key(lastAxis));
      return { cache, formula: chartFormula({ sheet, startColumn: first.column, startRow: first.row,
        endColumn: last.column, endRow: last.row }) };
    };
    return { name: binding(header, header, 'string'), data: binding(start, start + count - 1, 'number') };
  };
}
