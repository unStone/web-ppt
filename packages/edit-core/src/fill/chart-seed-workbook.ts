import { serializeXmlTreeBytes } from '@web-ppt/edit-core/xml';
import { createOpcPackage, disposeOpcPackage } from '../opc/patch';
import { chartFormula, columnName } from '../chart/formula';
import type { TemplateFillChart } from './types';
import { SEED_NS as NS, seedDocument, seedElement as element } from './chart-seed-xml';

export interface SeedSeriesReferences {
  readonly name: string;
  readonly values: string;
  readonly x?: string;
  readonly sizes?: string;
}

interface CellValue { readonly row: number; readonly column: number; readonly value: string | number | null }

function formula(column: number, count: number, row = 2): string {
  return chartFormula({ sheet: 'Sheet1', startColumn: column, endColumn: column,
    startRow: row, endRow: row + count - 1 });
}

function cell(source: CellValue) {
  const attributes: Record<string, string> = { r: `${columnName(source.column)}${source.row}` };
  if (source.value === null) return element('c', attributes);
  if (typeof source.value === 'number') return element('c', attributes, [element('v', {}, [String(source.value)])]);
  return element('c', { ...attributes, t: 'inlineStr' }, [element('is', {}, [
    element('t', /^\s|\s$/.test(source.value) ? { 'xml:space': 'preserve' } : {}, [source.value]),
  ])]);
}

export function seedChartWorkbook(chart: TemplateFillChart): {
  readonly bytes: Uint8Array;
  readonly categories: string;
  readonly series: readonly SeedSeriesReferences[];
} {
  const xy = chart.type === 'scatter' || chart.type === 'bubble';
  const cells: CellValue[] = [];
  const put = (column: number, row: number, value: CellValue['value']) => cells.push({ column, row, value });
  const writeColumn = (column: number, values: readonly CellValue['value'][]) =>
    values.forEach((value, index) => put(column, index + 2, value));
  if (!xy) {
    put(1, 1, 'Categories');
    writeColumn(1, chart.categories);
  }
  const series = chart.series.map((source, index): SeedSeriesReferences => {
    const base = xy ? index * (chart.type === 'bubble' ? 3 : 2) + 1 : index + 2;
    const values = xy ? base + 1 : base;
    put(values, 1, source.name);
    writeColumn(values, source.values);
    if (xy) {
      put(base, 1, `${source.name} X`);
      writeColumn(base, source.x!);
    }
    if (chart.type === 'bubble') {
      put(base + 2, 1, `${source.name} Size`);
      writeColumn(base + 2, source.sizes!);
    }
    return { name: formula(values, 1, 1), values: formula(values, source.values.length),
      ...(xy ? { x: formula(base, source.values.length) } : {}),
      ...(chart.type === 'bubble' ? { sizes: formula(base + 2, source.values.length) } : {}) };
  });
  const rows = new Map<number, CellValue[]>();
  for (const source of cells) {
    const row = rows.get(source.row) ?? [];
    row.push(source);
    rows.set(source.row, row);
  }
  const rowNodes = [...rows].sort(([left], [right]) => left - right).map(([row, contents]) =>
    element('row', { r: row }, contents.sort((left, right) => left.column - right.column).map(cell)));
  const parts = {
    '[Content_Types].xml': serializeXmlTreeBytes(seedDocument('Types', { '': NS.types }, [
      element('Default', { Extension: 'rels', ContentType: 'application/vnd.openxmlformats-package.relationships+xml' }),
      element('Default', { Extension: 'xml', ContentType: 'application/xml' }),
      element('Override', { PartName: '/xl/workbook.xml', ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml' }),
      element('Override', { PartName: '/xl/worksheets/sheet1.xml', ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml' }),
    ])),
    '_rels/.rels': serializeXmlTreeBytes(seedDocument('Relationships', { '': NS.relationships }, [
      element('Relationship', { Id: 'rId1', Type: `${NS.office}/officeDocument`, Target: 'xl/workbook.xml' }),
    ])),
    'xl/workbook.xml': serializeXmlTreeBytes(seedDocument('workbook', { '': NS.spreadsheet, r: NS.office }, [
      element('sheets', {}, [element('sheet', { name: 'Sheet1', sheetId: 1, 'r:id': 'rId1' })]),
      element('calcPr', { calcId: 191029 }),
    ])),
    'xl/_rels/workbook.xml.rels': serializeXmlTreeBytes(seedDocument('Relationships', { '': NS.relationships }, [
      element('Relationship', { Id: 'rId1', Type: `${NS.office}/worksheet`, Target: 'worksheets/sheet1.xml' }),
    ])),
    'xl/worksheets/sheet1.xml': serializeXmlTreeBytes(seedDocument('worksheet', { '': NS.spreadsheet }, [
      element('sheetData', {}, rowNodes),
    ])),
  };
  const packaged = createOpcPackage(parts);
  disposeOpcPackage(packaged.package);
  return { bytes: packaged.bytes, categories: xy ? '' : formula(1, chart.categories.length), series };
}
