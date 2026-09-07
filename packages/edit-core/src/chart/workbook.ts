import { unzipSync } from 'fflate';
import {
  parseXmlTree, xmlElementChildren,
} from '@web-ppt/edit-core/xml';
import { chartFormula, parseChartFormula, resizedChartFormula } from './formula';
import type {
  ChartDatasetState, ChartFormulaBinding, ChartSeries,
} from './types';
import { orderedChartRecords } from './ordering';
import { writeChartWorkbook } from './workbook-write';
import {
  OFFICE_REL_NS, PACKAGE_REL_NS, SPREADSHEET_NS,
  STRICT_OFFICE_REL_NS, STRICT_SPREADSHEET_NS,
} from './xml-namespaces';
import { addressParts, rangeCells, worksheetRangeCells } from './workbook-range';
import { worksheetXml, xmlAttribute as attr } from './xml-data';
import { resizedCategoryFormula } from './category-levels';
import { assertCategoryWorkbookSource } from './category-workbook';

const MAX_WORKBOOK_BYTES = 16 * 1024 * 1024;
const MAX_WORKBOOK_PARTS = 512;
const MAX_WORKBOOK_PART_BYTES = 32 * 1024 * 1024;
const MAX_WORKBOOK_TOTAL_BYTES = 64 * 1024 * 1024;
type MutableBindings = {
  -readonly [Key in keyof ChartSeries['bindings']]: ChartSeries['bindings'][Key];
};

const { child, children } = worksheetXml;
function unzipWorkbook(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.length > MAX_WORKBOOK_BYTES) throw new Error('内嵌工作簿压缩包超过安全上限');
  let count = 0;
  let total = 0;
  return unzipSync(bytes, { filter: (file) => {
    count++;
    total += file.originalSize;
    if (count > MAX_WORKBOOK_PARTS || file.originalSize > MAX_WORKBOOK_PART_BYTES
      || total > MAX_WORKBOOK_TOTAL_BYTES) throw new Error('内嵌工作簿解压规模超过安全上限');
    return true;
  } });
}

function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const stack = base.slice(0, base.lastIndexOf('/') + 1).split('/').filter(Boolean);
  for (const part of target.split('/')) {
    if (part === '..') stack.pop();
    else if (part && part !== '.') stack.push(part);
  }
  return stack.join('/');
}

export interface WorkbookMap {
  readonly sheets: Map<string, string>;
  readonly sharedStrings: string | null;
}

type DatasetValues = Pick<ChartDatasetState, 'categories' | 'series'>;

function workbookMap(parts: Readonly<Record<string, Uint8Array>>): WorkbookMap {
  const workbookPart = 'xl/workbook.xml';
  const workbook = parts[workbookPart];
  const relsBytes = parts['xl/_rels/workbook.xml.rels'];
  if (!workbook || !relsBytes) throw new Error('内嵌工作簿缺少 workbook 关系');
  const rels = parseXmlTree(relsBytes).root;
  const relationships = xmlElementChildren(rels, {
    localName: 'Relationship', namespaceUri: PACKAGE_REL_NS,
  });
  const targets = new Map<string, { type: string; target: string; external: boolean }>();
  for (const relationship of relationships) {
    const id = attr(relationship, 'Id');
    if (!id || targets.has(id)) throw new Error('内嵌工作簿存在空或重复关系身份');
    targets.set(id, {
      type: attr(relationship, 'Type') ?? '', target: attr(relationship, 'Target') ?? '',
      external: attr(relationship, 'TargetMode') === 'External',
    });
  }
  const workbookRoot = parseXmlTree(workbook).root;
  const relationshipNamespace = workbookRoot.namespaceUri === STRICT_SPREADSHEET_NS
    ? STRICT_OFFICE_REL_NS
    : workbookRoot.namespaceUri === SPREADSHEET_NS ? OFFICE_REL_NS : null;
  const sheets = new Map<string, string>();
  const sheetNames = new Set<string>();
  const sheetIds = new Set<string>();
  const sheetRelationships = new Set<string>();
  const sheetTargets = new Set<string>();
  for (const sheet of children(child(workbookRoot, 'sheets'), 'sheet')) {
    const name = attr(sheet, 'name');
    const sheetId = attr(sheet, 'sheetId');
    const relationshipId = sheet.attributes.find((item) => item.localName === 'id'
      && item.namespaceUri === relationshipNamespace)?.value ?? '';
    const relationship = targets.get(relationshipId);
    const normalizedName = name?.toUpperCase() ?? '';
    if (!name || !sheetId || !relationshipId || sheetNames.has(normalizedName)
      || sheetIds.has(sheetId) || sheetRelationships.has(relationshipId)
      || !relationship?.type.endsWith('/worksheet') || !relationship.target || relationship.external) {
      throw new Error('内嵌工作簿的工作表绑定存在歧义');
    }
    const target = resolvePart(workbookPart, relationship.target);
    if (!parts[target] || sheetTargets.has(target)) throw new Error(`内嵌工作簿工作表目标无效：${target}`);
    sheetNames.add(normalizedName);
    sheetIds.add(sheetId);
    sheetRelationships.add(relationshipId);
    sheetTargets.add(target);
    sheets.set(name, target);
  }
  const sharedRelations = [...targets.values()].filter((item) => item.type.endsWith('/sharedStrings'));
  if (sharedRelations.length > 1) throw new Error('内嵌工作簿存在多个共享字符串关系');
  const shared = sharedRelations[0];
  if (shared?.external) throw new Error('共享字符串不能指向外部目标');
  const sharedStrings = shared?.target ? resolvePart(workbookPart, shared.target) : null;
  if (sharedStrings && !parts[sharedStrings]) throw new Error(`内嵌工作簿缺少共享字符串：${sharedStrings}`);
  return { sheets, sharedStrings };
}

function bindingFormula(binding: ChartFormulaBinding | undefined): string | null {
  return binding?.formula ?? null;
}

function stateFormulaBindings(
  state: Pick<ChartDatasetState, 'series'>, includeTemplates = true,
): Array<{ field: keyof ChartSeries['bindings']; formula: string; hierarchy?: ChartFormulaBinding['hierarchy'] }> {
  return orderedChartRecords(Object.values(state.series))
    .filter((series) => includeTemplates || !series.sourceTemplate)
    .flatMap((series) =>
    (Object.entries(series.bindings) as Array<[
      keyof ChartSeries['bindings'], ChartFormulaBinding | undefined,
    ]>).flatMap(([field, binding]) => {
      const formula = bindingFormula(binding);
      return formula ? [{ field, formula, hierarchy: binding?.hierarchy }] : [];
    }));
}

function stateFormulas(state: Pick<ChartDatasetState, 'series'>): string[] {
  return stateFormulaBindings(state).map((item) => item.formula);
}

function assertFormulaOwnership(state: Pick<ChartDatasetState, 'series'>): void {
  const ranges = stateFormulaBindings(state).flatMap((item) => {
    const range = parseChartFormula(item.formula);
    return range ? [{ field: item.field, range }] : [];
  });
  for (let index = 0; index < ranges.length; index++) {
    for (let peer = 0; peer < index; peer++) {
      const left = ranges[index];
      const right = ranges[peer];
      if (left.field === 'categories' && right.field === 'categories') {
        if (JSON.stringify(left.range) !== JSON.stringify(right.range)) {
          throw new Error('同一图表的类别公式没有共享同一范围');
        }
        continue;
      }
      if (left.range.sheet === right.range.sheet
        && left.range.startColumn <= right.range.endColumn
        && right.range.startColumn <= left.range.endColumn
        && left.range.startRow <= right.range.endRow
        && right.range.startRow <= left.range.endRow) {
        throw new Error('图表公式存在重叠写入');
      }
    }
  }
}

export function workbookCanSync(
  workbook: Uint8Array | undefined, state: DatasetValues, verifyCache = false,
): { ok: true } | { ok: false; reason: string } {
  if (!workbook) return { ok: false, reason: '图表关系指向的内嵌工作簿不存在' };
  let map: WorkbookMap;
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipWorkbook(workbook);
    map = workbookMap(parts);
  } catch { return { ok: false, reason: '内嵌工作簿结构无法安全读取' }; }
  const formulas = stateFormulaBindings(state);
  if (!formulas.length) return { ok: false, reason: '内嵌工作簿没有可写的数据公式' };
  for (const item of formulas) {
    const range = parseChartFormula(item.formula);
    if (!range || !map.sheets.has(range.sheet)) {
      return { ok: false, reason: `图表公式无法无歧义写回：${item.formula}` };
    }
    const columns = range.endColumn - range.startColumn + 1;
    const rows = range.endRow - range.startRow + 1;
    const hierarchy = item.field === 'categories' ? item.hierarchy : undefined;
    if (hierarchy ? (hierarchy.orientation === 'rows' ? columns : rows) !== hierarchy.levels
      : item.field === 'name' ? columns * rows !== 1 : columns > 1 && rows > 1) {
      return { ok: false, reason: `图表公式不是可安全改写的一维范围：${item.formula}` };
    }
  }
  try { assertFormulaOwnership(state); } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '图表公式存在重叠写入' };
  }
  try {
    if (verifyCache) assertCategoryWorkbookSource(state, parts, map);
    plannedState(state, parts, map);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '工作簿写入区域无法安全规划' };
  }
  return { ok: true };
}

function nextColumn(state: Pick<ChartDatasetState, 'series'>, sheet: string): number {
  return Math.max(0, ...stateFormulas(state).map(parseChartFormula)
    .filter((range) => range?.sheet === sheet).map((range) => range!.endColumn)) + 1;
}

function nextRow(state: Pick<ChartDatasetState, 'series'>, sheet: string): number {
  return Math.max(0, ...stateFormulas(state).map(parseChartFormula)
    .filter((range) => range?.sheet === sheet).map((range) => range!.endRow)) + 1;
}

function bindingWithFormula(source: ChartFormulaBinding | undefined, formula: string): ChartFormulaBinding {
  return { ...source, formula, cache: source?.cache ?? 'number' };
}

interface WorkbookOccupancy {
  readonly occupied: Map<string, Set<string>>;
  readonly merged: Map<string, Set<string>>;
  readonly unsafe: Map<string, Set<string>>;
}

interface WorkbookBlocks {
  readonly byRow: Map<string, Map<number, Set<number>>>;
  readonly byColumn: Map<string, Map<number, Set<number>>>;
}

function occupiedCells(
  parts: Readonly<Record<string, Uint8Array>>, map: WorkbookMap,
): WorkbookOccupancy {
  const occupiedBySheet = new Map<string, Set<string>>();
  const mergedBySheet = new Map<string, Set<string>>();
  const unsafeBySheet = new Map<string, Set<string>>();
  for (const [name, part] of map.sheets) {
    const bytes = parts[part];
    if (!bytes) continue;
    const root = parseXmlTree(bytes).root;
    const occupied = new Set<string>();
    const unsafe = new Set<string>();
    const data = child(root, 'sheetData');
    const seenRows = new Set<number>();
    const seenCells = new Set<string>();
    for (const row of children(data, 'row')) {
      const rowValue = attr(row, 'r');
      const rowNumber = rowValue === null ? Number.NaN : Number(rowValue);
      if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > 1_048_576
        || seenRows.has(rowNumber)) throw new Error('工作表存在歧义行定位');
      seenRows.add(rowNumber);
      for (const cell of children(row, 'c')) {
        const address = attr(cell, 'r');
        if (!address) throw new Error('工作表存在无法定位的单元格');
        const normalized = address.toUpperCase();
        const point = addressParts(normalized);
        if (point.row !== rowNumber || seenCells.has(normalized)) {
          throw new Error('工作表存在歧义单元格定位');
        }
        seenCells.add(normalized);
        const allChildren = xmlElementChildren(cell);
        const unknownAttribute = cell.attributes.some((item) => item.namespaceUri !== null
          || !['r', 's', 't', 'cm', 'vm'].includes(item.localName));
        // 只有无子节点、无批注/值元数据的空 c 才是可复用墓碑；扩展数据同样属于未知占用。
        if (allChildren.length || attr(cell, 'cm') !== null || attr(cell, 'vm') !== null
          || unknownAttribute) {
          occupied.add(normalized);
          if (attr(cell, 'cm') !== null || attr(cell, 'vm') !== null || unknownAttribute
            || allChildren.some((item) => item.namespaceUri !== cell.namespaceUri
              || !['v', 'is'].includes(item.localName))) unsafe.add(normalized);
        }
        for (const formula of allChildren.filter((item) => item.namespaceUri === cell.namespaceUri
          && item.localName === 'f')) {
          const reference = attr(formula, 'ref');
          if (reference) worksheetRangeCells(reference).forEach((item) => unsafe.add(item));
        }
      }
    }
    const merged = new Set<string>();
    for (const merge of children(child(root, 'mergeCells'), 'mergeCell')) {
      const reference = attr(merge, 'ref');
      if (!reference) throw new Error('合并单元格缺少范围');
      worksheetRangeCells(reference).forEach((address) => merged.add(address));
    }
    occupiedBySheet.set(name, occupied);
    mergedBySheet.set(name, merged);
    unsafeBySheet.set(name, unsafe);
  }
  return { occupied: occupiedBySheet, merged: mergedBySheet, unsafe: unsafeBySheet };
}

function controlledCells(state: DatasetValues): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const formula of stateFormulaBindings(state, false).map((item) => item.formula)) {
    const range = parseChartFormula(formula);
    if (!range) continue;
    const cells = result.get(range.sheet) ?? new Set<string>();
    rangeCells(formula).forEach((cell) => cells.add(cell));
    result.set(range.sheet, cells);
  }
  return result;
}

function blockedAxes(
  occupancy: WorkbookOccupancy, controlled: ReadonlyMap<string, Set<string>>,
): WorkbookBlocks {
  const byRow = new Map<string, Map<number, Set<number>>>();
  const byColumn = new Map<string, Map<number, Set<number>>>();
  const sheets = new Set([
    ...occupancy.occupied.keys(), ...occupancy.merged.keys(), ...occupancy.unsafe.keys(),
  ]);
  for (const sheet of sheets) {
    const blocked = new Set([
      ...(occupancy.merged.get(sheet) ?? []),
      ...(occupancy.unsafe.get(sheet) ?? []),
    ]);
    for (const address of occupancy.occupied.get(sheet) ?? []) {
      if (!controlled.get(sheet)?.has(address)) blocked.add(address);
    }
    const rows = new Map<number, Set<number>>();
    const columns = new Map<number, Set<number>>();
    for (const address of blocked) {
      const point = addressParts(address);
      const row = rows.get(point.row) ?? new Set<number>();
      row.add(point.column);
      rows.set(point.row, row);
      const column = columns.get(point.column) ?? new Set<number>();
      column.add(point.row);
      columns.set(point.column, column);
    }
    byRow.set(sheet, rows);
    byColumn.set(sheet, columns);
  }
  return { byRow, byColumn };
}

function nextFreeColumn(
  start: number, sheet: string, rows: readonly number[], blocks: WorkbookBlocks,
): number {
  const forbidden = new Set<number>();
  const index = blocks.byRow.get(sheet);
  for (const row of new Set(rows)) for (const column of index?.get(row) ?? []) forbidden.add(column);
  let column = start;
  while (forbidden.has(column)) column++;
  if (column <= 16_384) return column;
  throw new Error('工作簿没有可证明为空的新系列区域');
}

function nextFreeRow(
  start: number, sheet: string, columns: readonly number[], blocks: WorkbookBlocks,
): number {
  const forbidden = new Set<number>();
  const index = blocks.byColumn.get(sheet);
  for (const column of new Set(columns)) for (const row of index?.get(column) ?? []) forbidden.add(row);
  let row = start;
  while (forbidden.has(row)) row++;
  if (row <= 1_048_576) return row;
  throw new Error('工作簿没有可证明为空的新系列区域');
}

/** 新系列只分配到真实空白列；既有范围扩展也不能吞掉未知单元格。 */
function plannedState<T extends DatasetValues>(
  source: T, parts: Readonly<Record<string, Uint8Array>>, map: WorkbookMap,
): T {
  const state = structuredClone(source);
  const formulaBindings = stateFormulaBindings(state);
  const existingRange = formulaBindings.filter((item) => item.field !== 'name')
    .map((item) => parseChartFormula(item.formula)).find(Boolean);
  if (!existingRange) throw new Error('内嵌工作簿没有可作为新增数据锚点的安全公式');
  const categoryBinding = orderedChartRecords(Object.values(state.series))
    .map((series) => series.bindings.categories)
    .find((binding) => parseChartFormula(bindingFormula(binding)));
  const categoryRange = parseChartFormula(bindingFormula(categoryBinding)) ?? existingRange;
  let column = nextColumn(state, existingRange.sheet);
  let row = nextRow(state, existingRange.sheet);
  const categories = orderedChartRecords(Object.values(state.categories).filter((item) => !item.removed));
  const count = Math.max(1, categories.length);
  const occupancy = occupiedCells(parts, map);
  const controlled = controlledCells(source);
  const blocks = blockedAxes(occupancy, controlled);
  const dataRows = Array.from({ length: count }, (_, index) => categoryRange.startRow + index);
  const dataColumns = Array.from({ length: count }, (_, index) => categoryRange.startColumn + index);
  const existingNameRange = formulaBindings.filter((item) => item.field === 'name')
    .map((item) => parseChartFormula(item.formula))
    .find((range) => range?.sheet === existingRange.sheet) ?? null;
  const nameRow = existingNameRange?.startRow
    ?? (categoryRange.startRow > 1 ? categoryRange.startRow - 1 : categoryRange.endRow + 1);
  const nameColumn = existingNameRange?.startColumn
    ?? (categoryRange.startColumn > 1 ? categoryRange.startColumn - 1 : categoryRange.endColumn + 1);
  const horizontalCategories = categoryBinding?.hierarchy?.orientation === 'columns' || categoryRange.startRow === categoryRange.endRow
    && categoryRange.startColumn < categoryRange.endColumn;
  const horizontalData = existingRange.startRow === existingRange.endRow
    && existingRange.startColumn < existingRange.endColumn;
  for (const series of orderedChartRecords(Object.values(state.series))) {
    const bindings = series.bindings as MutableBindings;
    const points = orderedChartRecords(Object.values(series.points).filter((point) => !point.removed));
    const xy = series.plotKind === 'scatter' || series.plotKind === 'bubble';
    const nameRange = parseChartFormula(bindings.name.formula);
    if (nameRange) bindings.name = bindingWithFormula(bindings.name,
      chartFormula({ ...nameRange, endColumn: nameRange.startColumn, endRow: nameRange.startRow }));
    if (!xy) {
      bindings.categories = bindingWithFormula(bindings.categories,
        resizedCategoryFormula(categoryBinding ?? { formula: chartFormula(categoryRange), cache: 'string' }, count)!);
      if (categoryBinding?.hierarchy) bindings.categories = { ...bindings.categories, hierarchy: categoryBinding.hierarchy };
      const valuesRange = parseChartFormula(bindings.values?.formula ?? null);
      if (valuesRange) bindings.values = bindingWithFormula(bindings.values,
        resizedChartFormula(bindings.values?.formula ?? null, Math.max(1, points.length))!);
      else if (!series.removed) {
        if (horizontalCategories) {
          const valueRow = nextFreeRow(
            row, existingRange.sheet, [nameColumn, ...dataColumns], blocks,
          );
          row = valueRow + 1;
          bindings.name = bindingWithFormula(bindings.name, chartFormula({
            sheet: existingRange.sheet, startColumn: nameColumn, endColumn: nameColumn,
            startRow: valueRow, endRow: valueRow,
          }));
          bindings.values = bindingWithFormula(bindings.values, chartFormula({
            sheet: existingRange.sheet, startColumn: categoryRange.startColumn,
            endColumn: categoryRange.startColumn + Math.max(1, points.length) - 1,
            startRow: valueRow, endRow: valueRow,
          }));
        } else {
          const valueColumn = nextFreeColumn(
            column, existingRange.sheet, [nameRow, ...dataRows], blocks,
          );
          column = valueColumn + 1;
          bindings.name = bindingWithFormula(bindings.name, chartFormula({
            sheet: existingRange.sheet, startColumn: valueColumn, endColumn: valueColumn,
            startRow: nameRow, endRow: nameRow,
          }));
          bindings.values = bindingWithFormula(bindings.values, chartFormula({
            sheet: existingRange.sheet, startColumn: valueColumn, endColumn: valueColumn,
            startRow: categoryRange.startRow, endRow: categoryRange.startRow + Math.max(1, points.length) - 1,
          }));
        }
      }
      continue;
    }
    const fields: Array<'x' | 'y' | 'size'> = ['x', 'y'];
    if (series.plotKind === 'bubble') fields.push('size');
    const pointColumns = Array.from({ length: Math.max(1, points.length) },
      (_, index) => existingRange.startColumn + index);
    const pointRows = Array.from({ length: Math.max(1, points.length) },
      (_, index) => existingRange.startRow + index);
    for (const field of fields) {
      const range = parseChartFormula(bindings[field]?.formula ?? null);
      if (range) bindings[field] = bindingWithFormula(bindings[field],
        resizedChartFormula(bindings[field]?.formula ?? null, Math.max(1, points.length))!);
      else if (!series.removed) {
        if (horizontalData) {
          const valueRow = nextFreeRow(row, existingRange.sheet,
            [...(field === 'x' ? [nameColumn] : []), ...pointColumns], blocks);
          row = valueRow + 1;
          bindings[field] = bindingWithFormula(bindings[field], chartFormula({
            sheet: existingRange.sheet, startColumn: existingRange.startColumn,
            endColumn: existingRange.startColumn + Math.max(1, points.length) - 1,
            startRow: valueRow, endRow: valueRow,
          }));
        } else {
          const valueColumn = nextFreeColumn(
            column, existingRange.sheet, [nameRow, ...pointRows], blocks,
          );
          column = valueColumn + 1;
          bindings[field] = bindingWithFormula(bindings[field], chartFormula({
            sheet: existingRange.sheet, startColumn: valueColumn, endColumn: valueColumn,
            startRow: existingRange.startRow, endRow: existingRange.startRow + Math.max(1, points.length) - 1,
          }));
        }
      }
    }
    if (!nameRange && !series.removed) {
      const first = parseChartFormula(bindings.x?.formula ?? null)!;
      bindings.name = bindingWithFormula(bindings.name, chartFormula({
        sheet: first.sheet,
        startColumn: horizontalData ? nameColumn : first.startColumn,
        endColumn: horizontalData ? nameColumn : first.startColumn,
        startRow: horizontalData ? first.startRow : nameRow,
        endRow: horizontalData ? first.startRow : nameRow,
      }));
    }
  }
  for (const formula of stateFormulas(state)) {
    const range = parseChartFormula(formula);
    if (!range) continue;
    for (const address of rangeCells(formula)) {
      if (occupancy.merged.get(range.sheet)?.has(address) || occupancy.unsafe.get(range.sheet)?.has(address)
        || (occupancy.occupied.get(range.sheet)?.has(address) && !controlled.get(range.sheet)?.has(address))) {
        throw new Error(`工作簿目标单元格 ${range.sheet}!${address} 已被未知内容占用`);
      }
    }
  }
  assertFormulaOwnership(state);
  return state;
}

export function patchChartWorkbook(
  sourceBytes: Uint8Array, sourceState: ChartDatasetState,
): { readonly bytes: Uint8Array; readonly state: ChartDatasetState } {
  const parts = unzipWorkbook(sourceBytes);
  const map = workbookMap(parts);
  const state = plannedState(sourceState, parts, map);
  return { bytes: writeChartWorkbook(sourceBytes, parts, map, sourceState, state), state };
}
