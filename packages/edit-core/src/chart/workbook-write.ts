import type { OpcPackage } from '@web-ppt/core';
import { disposeOpcPackage, patchOpcPackage } from '@web-ppt/edit-core/opc';
import {
  parseXmlTree, removeXmlAttribute, removeXmlChild, serializeXmlTreeBytes, setXmlAttribute,
} from '@web-ppt/edit-core/xml';
import type { XmlDocument, XmlElement, XmlNode } from '@web-ppt/edit-core/xml';
import { columnName, parseChartFormula } from './formula';
import { orderedChartRecords } from './ordering';
import type { ChartDatasetState } from './types';
import type { WorkbookMap } from './workbook';
import {
  worksheetXml, xmlAttribute as attr, xmlContent as text,
  appendXml as append, makeDataElement as make, setDataText as setText,
} from './xml-data';
import { addressParts, rangeCells, worksheetRangeBounds } from './workbook-range';
import { canonicalNumericCategories } from './category-value';

type CellValue = { readonly kind: 'string' | 'number'; readonly value: string | number | null };

const { child, children } = worksheetXml;

function setStringText(node: XmlElement, value: string): void {
  setText(node, value);
  if (/^\s|\s$/.test(value)) setXmlAttribute(node, 'xml:space', 'preserve');
  else removeXmlAttribute(node, 'xml:space');
}

function ensure(parent: XmlElement, name: string, before: XmlNode | null = null): XmlElement {
  const current = child(parent, name);
  if (current) return current;
  const created = make(parent, name);
  append(parent, created, before);
  return created;
}

function writeRange(
  writes: Map<string, Map<string, CellValue>>, formula: string | null,
  values: readonly (string | number | null)[], kind: CellValue['kind'], clearOnly = false,
): void {
  const range = parseChartFormula(formula);
  if (!range) return;
  let sheet = writes.get(range.sheet);
  if (!sheet) { sheet = new Map(); writes.set(range.sheet, sheet); }
  rangeCells(formula).forEach((cell, index) => {
    sheet!.set(cell, { kind, value: clearOnly ? null : values[index] ?? null });
  });
}

function workbookWrites(
  source: ChartDatasetState, planned: ChartDatasetState,
): Map<string, Map<string, CellValue>> {
  const writes = new Map<string, Map<string, CellValue>>();
  for (const series of orderedChartRecords(Object.values(source.series))) {
    writeRange(writes, series.bindings.name.formula, [], 'string', true);
    writeRange(writes, series.bindings.categories?.formula ?? null, [], 'string', true);
    for (const field of ['values', 'x', 'y', 'size'] as const) {
      writeRange(writes, series.bindings[field]?.formula ?? null, [], 'number', true);
    }
  }
  const categories = orderedChartRecords(Object.values(planned.categories).filter((item) => !item.removed));
  const categoryBinding = orderedChartRecords(Object.values(planned.series)).find((series) => !series.removed
    && series.bindings.categories?.formula)?.bindings.categories;
  const categoryNumbers = canonicalNumericCategories(categories.map((item) => item.label));
  const numericCategories = categoryBinding?.cache === 'number' && categoryNumbers !== null;
  writeRange(writes, categoryBinding?.formula ?? null,
    numericCategories ? categoryNumbers : categories.map((item) => item.label),
    numericCategories ? 'number' : 'string');
  for (const series of orderedChartRecords(Object.values(planned.series).filter((item) => !item.removed))) {
    const points = orderedChartRecords(Object.values(series.points).filter((item) => !item.removed));
    writeRange(writes, series.bindings.name.formula, [series.name], 'string');
    writeRange(writes, series.bindings.values?.formula ?? series.bindings.y?.formula ?? null,
      points.map((point) => point.value), 'number');
    writeRange(writes, series.bindings.x?.formula ?? null, points.map((point) => point.x ?? null), 'number');
    writeRange(writes, series.bindings.size?.formula ?? null, points.map((point) => point.size ?? null), 'number');
  }
  return writes;
}

class SharedStrings {
  readonly tree: XmlDocument | null;
  private readonly values = new Map<string, number>();

  constructor(bytes: Uint8Array | undefined) {
    this.tree = bytes ? parseXmlTree(bytes) : null;
    children(this.tree?.root ?? null, 'si').forEach((item, index) => this.values.set(text(item), index));
  }

  index(value: string): number | null {
    if (!this.tree) return null;
    const current = this.values.get(value);
    if (current !== undefined) return current;
    const index = children(this.tree.root, 'si').length;
    const item = make(this.tree.root, 'si');
    const valueNode = make(item, 't');
    setStringText(valueNode, value);
    append(item, valueNode);
    append(this.tree.root, item, child(this.tree.root, 'extLst'));
    this.values.set(value, index);
    // count 是全工作簿引用数；不扫描所有 worksheet 就不能诚实维护，省略比写假元数据安全。
    removeXmlAttribute(this.tree.root, 'count');
    removeXmlAttribute(this.tree.root, 'uniqueCount');
    return index;
  }
}

function cellOf(sheet: XmlDocument, address: string): XmlElement {
  const data = ensure(sheet.root, 'sheetData', child(sheet.root, 'extLst'));
  const wanted = addressParts(address);
  let row = children(data, 'row').find((item) => Number(attr(item, 'r')) === wanted.row);
  if (!row) {
    row = make(data, 'row', [['r', String(wanted.row)]]);
    const before = children(data, 'row').find((item) => Number(attr(item, 'r')) > wanted.row) ?? null;
    append(data, row, before);
  }
  let cell = children(row, 'c').find((item) => attr(item, 'r') === address);
  if (!cell) {
    cell = make(row, 'c', [['r', address]]);
    const before = children(row, 'c').find((item) =>
      addressParts(attr(item, 'r') ?? 'A1').column > wanted.column) ?? null;
    append(row, cell, before);
  }
  return cell;
}

function clearCell(cell: XmlElement): void {
  for (const node of [...children(cell)].filter((item) => ['f', 'v', 'is'].includes(item.localName))) {
    removeXmlChild(cell, node);
  }
  removeXmlAttribute(cell, 't');
}

function setCell(cell: XmlElement, value: CellValue, shared: SharedStrings): void {
  const sharedCell = attr(cell, 't') === 's';
  clearCell(cell);
  if (value.value === null) return;
  if (value.kind === 'number') {
    const number = Number(value.value);
    if (!Number.isFinite(number)) throw new Error('工作簿数值必须是有限数字');
    const node = make(cell, 'v');
    setText(node, String(number));
    append(cell, node, child(cell, 'extLst'));
    return;
  }
  const string = String(value.value);
  const index = sharedCell ? shared.index(string) : null;
  if (index !== null) {
    setXmlAttribute(cell, 't', 's');
    const node = make(cell, 'v');
    setText(node, String(index));
    append(cell, node, child(cell, 'extLst'));
    return;
  }
  setXmlAttribute(cell, 't', 'inlineStr');
  const inline = make(cell, 'is');
  const node = make(inline, 't');
  setStringText(node, string);
  append(inline, node);
  append(cell, inline, child(cell, 'extLst'));
}

function expandWorksheetDimension(sheet: XmlDocument): void {
  const existing = child(sheet.root, 'dimension');
  let minColumn = Number.POSITIVE_INFINITY;
  let minRow = Number.POSITIVE_INFINITY;
  let maxColumn = 0;
  let maxRow = 0;
  const include = (point: { column: number; row: number }): void => {
    minColumn = Math.min(minColumn, point.column);
    minRow = Math.min(minRow, point.row);
    maxColumn = Math.max(maxColumn, point.column);
    maxRow = Math.max(maxRow, point.row);
  };
  const reference = attr(existing, 'ref');
  if (reference) {
    const current = worksheetRangeBounds(reference);
    include(current.start);
    include(current.end);
  }
  const data = child(sheet.root, 'sheetData');
  for (const row of children(data, 'row')) for (const cell of children(row, 'c')) {
    const address = attr(cell, 'r');
    if (address) include(addressParts(address.toUpperCase()));
  }
  if (!Number.isFinite(minColumn)) return;
  const dimension = existing ?? ensure(sheet.root, 'dimension',
    children(sheet.root).find((item) => item.localName !== 'sheetPr') ?? null);
  const first = `${columnName(minColumn)}${minRow}`;
  const last = `${columnName(maxColumn)}${maxRow}`;
  setXmlAttribute(dimension, 'ref', first === last ? first : `${first}:${last}`);
}

export function writeChartWorkbook(
  sourceBytes: Uint8Array,
  parts: Readonly<Record<string, Uint8Array>>,
  map: WorkbookMap,
  source: ChartDatasetState,
  planned: ChartDatasetState,
): Uint8Array {
  const shared = new SharedStrings(map.sharedStrings ? parts[map.sharedStrings] : undefined);
  const changes: Record<string, Uint8Array> = Object.create(null);
  for (const [sheetName, cells] of workbookWrites(source, planned)) {
    const part = map.sheets.get(sheetName);
    if (!part || !parts[part]) throw new Error(`工作簿缺少公式工作表：${sheetName}`);
    const tree = parseXmlTree(parts[part]);
    for (const [address, value] of cells) setCell(cellOf(tree, address), value, shared);
    expandWorksheetDimension(tree);
    changes[part] = serializeXmlTreeBytes(tree);
  }
  if (map.sharedStrings && shared.tree) {
    // t=s 引用既可能新增也可能被清空；不扫描所有工作表时，删除可选计数才不会留下伪精确值。
    removeXmlAttribute(shared.tree.root, 'count');
    removeXmlAttribute(shared.tree.root, 'uniqueCount');
    changes[map.sharedStrings] = serializeXmlTreeBytes(shared.tree);
  }
  const borrowed: OpcPackage = {
    format: 'pptx', bytes: sourceBytes, parts, assets: Object.freeze({}), disposed: false,
  };
  const result = patchOpcPackage(borrowed, changes);
  const bytes = result.bytes.slice();
  if (result.package !== borrowed) disposeOpcPackage(result.package);
  return bytes;
}
