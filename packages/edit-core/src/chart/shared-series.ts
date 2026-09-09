import type { EditDoc } from '../types';
import type { ChartDatasetState } from './types';
import { sharedCellFields } from './shared-fields';
import { sharedGroupForWorkbook } from './shared-graph';
import { projectSharedDataset } from './shared';

export type SharedSeriesRemovals = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export function projectSharedSeries(state: ChartDatasetState, removals: SharedSeriesRemovals | undefined): void {
  const part = removals?.[state.binding.chartPart];
  Object.values(state.series).forEach((series, index) => {
    if (part?.[String(index)] === true) (series as { removed?: true }).removed = true;
  });
}

/** 删除的是图表中的系列；只有全部原生视图都释放的单元格才可清空。 */
export function unusedSharedCells(doc: EditDoc, workbook: string): Set<string> {
  const owned = new Set<string>(), live = new Set<string>();
  const group = sharedGroupForWorkbook(doc, workbook);
  if (!group) return owned;
  for (const { state: source } of group.charts) {
    const current = projectSharedDataset(doc, group, structuredClone(source));
    const paths = new Set(sharedCellFields(current).map(field => JSON.stringify(field.path)));
    for (const field of sharedCellFields(source)) {
      owned.add(field.key);
      if (paths.has(JSON.stringify(field.path))) live.add(field.key);
    }
  }
  return new Set([...owned].filter(key => !live.has(key)));
}
