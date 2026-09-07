import { unzipSync } from 'fflate';
import { patchOpcPackage, disposeOpcPackage } from '@web-ppt/edit-core/opc';
import { parseXmlTree, serializeXmlTreeBytes, setXmlAttribute, reorderXmlChildren as sortRows } from '@web-ppt/edit-core/xml';
import type { ChartExDataset } from '@web-ppt/core/chart-ex';
import { columnName, chartFormula } from '../chart/formula';
import { add, attr, child, children, R } from './xml';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relPart = (part: string) => part.replace(/([^/]+)$/, '_rels/$1.rels');
const resolve = (base: string, target: string) => {
  if (/[:\\?#]/.test(target)) throw new Error('工作簿关系必须指向包内文件');
  const path = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const item of target.split('/')) {
    if (item === '..') { if (!path.length) throw new Error('工作簿关系越界'); path.pop(); }
    else if (item && item !== '.') path.push(item);
  }
  return path.join('/');
};

/** 将修改数据放入独立工作表，原公式范围和其他图表的数据不会被行数变化覆盖。 */
export function chartExWorkbook(bytes: Uint8Array, datasets: ChartExDataset[]) {
  let total = 0, count = 0;
  if (bytes.length > 16 * 1024 * 1024) throw new Error('ChartEx 工作簿超限');
  const parts = unzipSync(bytes, { filter(file) {
    total += file.originalSize;
    if (total > 64 * 1024 * 1024 || ++count > 512) throw new Error('ChartEx 工作簿解压超限');
    return true;
  } });
  const rootRels = parseXmlTree(parts['_rels/.rels']).root;
  const main = children(rootRels, 'Relationship').filter((node) => attr(node, 'Type') === `${R}/officeDocument`
    && attr(node, 'TargetMode') !== 'External');
  if (main.length !== 1) throw new Error('ChartEx 工作簿入口不唯一');
  const mainPart = resolve('', attr(main[0], 'Target') ?? '');
  const workbook = parseXmlTree(parts[mainPart]), relsPart = relPart(mainPart);
  const rels = parts[relsPart] ? parseXmlTree(parts[relsPart]) : parseXmlTree(`<Relationships xmlns="${REL}"/>`);
  const types = parseXmlTree(parts['[Content_Types].xml']);
  const sheets = child(workbook.root, 'sheets'); if (!sheets) throw new Error('工作簿缺少 sheets');
  const names = new Set(children(sheets, 'sheet').map((node) => attr(node, 'name')?.toLowerCase()));
  const ids = new Set(children(sheets, 'sheet').map((node) => attr(node, 'sheetId')));
  const relIds = new Set(children(rels.root, 'Relationship').map((node) => attr(node, 'Id')));
  let index = 1;
  while (names.has(`webppt ${index}`) || ids.has(String(index)) || relIds.has(`webPpt${index}`)
    || parts[`web-ppt/chart-data${index}.xml`]) index++;
  const name = `WebPPT ${index}`, part = `web-ppt/chart-data${index}.xml`, rid = `webPpt${index}`;
  const node = add(sheets, 'sheet', [['name', name], ['sheetId', String(index)], ['xmlns:r', R], ['r:id', rid]]);
  setXmlAttribute(node, 'state', 'visible');
  for (const view of children(child(workbook.root, 'bookViews'), 'workbookView')) setXmlAttribute(view, 'activeTab', String(children(sheets, 'sheet').length - 1));
  add(rels.root, 'Relationship', [['Id', rid], ['Type', `${R}/worksheet`], ['Target', `/${part}`]]);
  add(types.root, 'Override', [['PartName', `/${part}`], ['ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml']]);
  const sheet = parseXmlTree(`<worksheet xmlns="${SS}"><sheetData/></worksheet>`), rows = new Map<number, ReturnType<typeof add>>();
  const formulas: string[][] = [];
  let col = 1;
  for (const dataset of datasets) {
    const references: string[] = []; formulas.push(references);
    for (const dimension of dataset.dimensions) {
      const levels = [...dimension.levels].reverse(), size = levels[0]?.length ?? 0;
      if (col + levels.length > 16385) throw new Error('ChartEx 数据列超限');
      if (!size) { references.push(''); continue; }
      references.push(chartFormula({ sheet: name, startColumn: col, endColumn: col + levels.length - 1, startRow: 1, endRow: size }));
      for (const values of levels) {
        for (const [at, value] of values.entries()) {
          if (value === null) continue;
          let row = rows.get(at); if (!row) { row = add(child(sheet.root, 'sheetData')!, 'row', [['r', String(at + 1)]]); rows.set(at, row); }
          const cell = add(row, 'c', [['r', `${columnName(col)}${at + 1}`], ...(dimension.numeric ? [] : [['t', 'inlineStr'] as const])]);
          if (dimension.numeric) add(cell, 'v', [], String(value));
          else add(add(cell, 'is'), 't', [['xml:space', 'preserve']], String(value));
        }
        col++;
      }
    }
  }
  // 稀疏列可能先遇到靠后的行；Worksheet 要求行按坐标顺序排列。
  const data = child(sheet.root, 'sheetData')!;
  const ordered = [...rows].sort(([a], [b]) => a - b).map(([, row]) => row);
  // 复用 XML 树的排序机制，保留行内单元格的既有顺序。
  sortRows(data, ordered);
  const borrowed = { format: 'pptx' as const, bytes, parts, assets: {}, disposed: false };
  const result = patchOpcPackage(borrowed, { [part]: serializeXmlTreeBytes(sheet),
    [mainPart]: serializeXmlTreeBytes(workbook), [relsPart]: serializeXmlTreeBytes(rels), '[Content_Types].xml': serializeXmlTreeBytes(types) });
  const saved = result.bytes.slice(); if (result.package !== borrowed) disposeOpcPackage(result.package);
  return { bytes: saved, formula: (data: number, dimension: number) => formulas[data][dimension] || undefined };
}
