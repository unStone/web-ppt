import { parseXmlTree } from '@web-ppt/edit-core/xml';
import type { WorkbookMap } from './workbook';
import { worksheetXml, xmlAttribute as attr, xmlContent as text } from './xml-data';

const { child, children } = worksheetXml;
export interface WorkbookCellValue {
  readonly kind: 'number' | 'string' | 'blank' | 'unsupported';
  readonly value: string | number | null;
}
export const workbookCellKey = (sheet: string, address: string): string => `${encodeURIComponent(sheet)}!${address}`;

export function readWorkbookCells(parts: Readonly<Record<string, Uint8Array>>, map: WorkbookMap): Map<string, WorkbookCellValue> {
  const shared = map.sharedStrings ? children(parseXmlTree(parts[map.sharedStrings]).root, 'si').map(text) : [];
  const result = new Map<string, WorkbookCellValue>();
  for (const [sheet, part] of map.sheets) {
    const root = parseXmlTree(parts[part]).root;
    for (const row of children(child(root, 'sheetData'), 'row')) for (const cell of children(row, 'c')) {
      const type = attr(cell, 't'), raw = text(child(cell, 'v'));
      let value: WorkbookCellValue = { kind: 'unsupported', value: null };
      if (child(cell, 'f')) value = { kind: 'unsupported', value: null };
      else if (!child(cell, 'v') && !child(cell, 'is')) value = { kind: 'blank', value: null };
      else if (type === 'inlineStr') value = { kind: 'string', value: text(child(cell, 'is')) };
      else if (type === 's' && /^\d+$/.test(raw) && Number(raw) < shared.length) value = { kind: 'string', value: shared[Number(raw)] };
      else if ((type === null || type === 'n') && raw.trim() && Number.isFinite(Number(raw))) value = { kind: 'number', value: Number(raw) };
      result.set(workbookCellKey(sheet, attr(cell, 'r')?.toUpperCase() ?? ''), value);
    }
  }
  return result;
}
