import type { ChartDatasetState } from './types';
import type { WorkbookMap } from './workbook';
import type { SharedCellEdit } from './shared-cell';
import type { SharedCellField } from './shared-fields';
import { sharedCellFields } from './shared-fields';
import { categoryWorkbookWrites } from './category-workbook';
import { workbookCellKey } from './workbook-read';

function groupHeads(fields: readonly SharedCellField[]): Map<string, string | undefined> {
  const result = new Map<string, string | undefined>(), heads: Array<string | undefined> = [];
  for (const field of fields) if (field.parent) {
    const { raw, level } = field.parent;
    if (raw !== null) { heads.fill(undefined, level + 1); heads[level] = field.key; }
    result.set(field.key, heads[level]);
  }
  return result;
}

export function sharedCategoryEdits(
  source: ChartDatasetState, before: ChartDatasetState, after: ChartDatasetState,
  parts: Readonly<Record<string, Uint8Array>>, map: WorkbookMap, touched: ReadonlySet<string>,
): Map<string, SharedCellEdit> {
  const result = new Map<string, SharedCellEdit>();
  const old = categoryWorkbookWrites(source, before, parts, map), current = categoryWorkbookWrites(source, after, parts, map);
  if (!current) return result;
  const beforeFields = sharedCellFields(before), afterFields = sharedCellFields(after);
  const oldHeads = groupHeads(beforeFields), newHeads = groupHeads(afterFields);
  const parentKeys = new Set(afterFields.filter(field => field.parent).map(field => field.key));
  for (const [address, cell] of current.cells) {
    const key = workbookCellKey(current.sheet, address), head = newHeads.get(key);
    const groupChanged = parentKeys.has(key) && (head !== oldHeads.get(key) || head !== undefined && touched.has(head));
    if (groupChanged || JSON.stringify(cell) !== JSON.stringify(old?.cells.get(address))) {
      result.set(key, cell.value !== null && parentKeys.has(key) && head && head !== key
        ? { parent: head } : { value: cell.value });
    }
  }
  return result;
}
