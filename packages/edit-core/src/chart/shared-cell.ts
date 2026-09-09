import type { WorkbookCellValue } from './workbook-read';
import { MAX_CHART_NAME, MAX_CHART_CELLS } from './limits';

export type SharedCellEdit = { readonly value: string | number | null } | { readonly parent: string };

export function decodeSharedCell(raw: unknown): SharedCellEdit {
  if (typeof raw !== 'string' || raw.length > MAX_CHART_NAME * 6 + 64) throw new Error('共享单元格覆盖无效');
  let cell: Partial<SharedCellEdit>;
  try { cell = JSON.parse(raw) as Partial<SharedCellEdit>; } catch { throw new Error('共享单元格覆盖无效'); }
  if (!cell || typeof cell !== 'object' || Array.isArray(cell) || Object.keys(cell).length !== 1) throw new Error('共享单元格覆盖无效');
  if ('parent' in cell && typeof cell.parent === 'string' && cell.parent.length <= 1024) return { parent: cell.parent };
  if ('value' in cell && (cell.value === null || typeof cell.value === 'string' && cell.value.length <= MAX_CHART_NAME
    || typeof cell.value === 'number' && Number.isFinite(cell.value))) return { value: cell.value };
  throw new Error('共享单元格覆盖无效');
}

/** 延续组保存为对组首的引用；并发改名因此不会把旧标签复制成第二份真值。 */
export function sharedCellValue(key: string, overrides: Readonly<Record<string, unknown>>, baseline: ReadonlyMap<string, WorkbookCellValue>): string | number | null {
  const visited = new Set<string>();
  while (Object.prototype.hasOwnProperty.call(overrides, key)) {
    if (visited.has(key) || visited.size >= MAX_CHART_CELLS) throw new Error('共享类别分组引用循环或超限');
    visited.add(key);
    const cell = decodeSharedCell(overrides[key]);
    if ('value' in cell) return cell.value;
    key = cell.parent;
  }
  return baseline.get(key)?.value ?? null;
}
