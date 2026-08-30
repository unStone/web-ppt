import { tableRowsWithoutTextOverrides, effectiveTableFrameHeight } from '../table-rows';
import { directTableCellMarkup } from '../table-direct-markup';
import { own } from '../data-validation';
import type { ElementRecord } from '../types';
import { tableCellKeyResolver, tableCellStableRefFromKey } from '../table-cell';
import { orderedTableColumns, orderedTableRows } from '../table-grid';
import {
  hasComplexTableStructureOverrides, hasTableStructureOverrides, projectTableStructure,
} from '../table-grid-projection';
import {
  cloneXmlNode, createXmlText, insertXmlChildUnchecked, removeXmlChild, replaceXmlChildren,
} from '../xml/nodes';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import {
  DRAWINGML_NS, MARKUP_COMPATIBILITY_NS, OFFICE_MATH_NS, PRESENTATIONML_NS,
} from '../xml/qname';
import { findXmlAttribute, findXmlChild, findXmlDescendant, xmlElementChildren } from '../xml/query';
import { parseXmlTree } from '../xml/tree';
import type { XmlDocument, XmlElement } from '../xml/types';
import { locateElementHost } from './xfrm';
import { namespacedElement } from './xml-element';

export function hasTableRowOverrides(record: ElementRecord): boolean {
  return hasTableStructureOverrides(record);
}

export function hasTableCellAppearanceOverrides(record: ElementRecord): boolean {
  return Object.values(record.ovr.tableCells ?? {}).some((cell) =>
    ['fill', 'borders', 'margins', 'vAlign', 'vert'].some((field) => own(cell, field)));
}

export function hasTableStyleOverride(record: ElementRecord): boolean {
  return Object.prototype.hasOwnProperty.call(record.ovr, 'tableStyle');
}

/** tblPr 只保存六个开关与 styleId；单元格直接格式继续原位直通。 */
export function patchTableStyle(document: XmlDocument, record: ElementRecord): void {
  if (!hasTableStyleOverride(record)) return;
  if (record.src.kind !== 'table' || record.meta.editable !== 'full') {
    throw new Error(`元素 ${record.id} 不能写回表样式`);
  }
  const settings = record.ovr.tableStyle!;
  const { host } = locateElementHost(document, record);
  const table = findXmlDescendant(host, { localName: 'tbl', namespaceUri: DRAWINGML_NS });
  const properties = table && findXmlChild(table, { localName: 'tblPr', namespaceUri: DRAWINGML_NS });
  if (!properties) throw new Error(`表格 ${record.id} 缺少 a:tblPr`);
  for (const field of ['firstRow', 'lastRow', 'bandRow', 'firstCol', 'lastCol', 'bandCol'] as const) {
    if (settings[field]) setXmlAttribute(properties, field, '1');
    else removeXmlAttribute(properties, field);
  }
  let styleId = findXmlChild(properties, { localName: 'tableStyleId', namespaceUri: DRAWINGML_NS });
  if (!styleId) {
    styleId = namespacedElement(properties, DRAWINGML_NS, 'tableStyleId');
    const extension = findXmlChild(properties, { localName: 'extLst', namespaceUri: DRAWINGML_NS });
    insertXmlChildUnchecked(properties, styleId, extension);
  }
  for (const child of [...styleId.children]) removeXmlChild(styleId, child);
  insertXmlChildUnchecked(styleId, createXmlText(settings.styleId));
}

function removeParagraphContent(parent: XmlElement): void {
  for (const child of [...parent.children]) {
    if (child.type !== 'element') continue;
    const drawingText = child.namespaceUri === DRAWINGML_NS
      && ['r', 'br', 'fld', 'endParaRPr'].includes(child.localName);
    const math = child.namespaceUri === OFFICE_MATH_NS
      && ['oMath', 'oMathPara'].includes(child.localName);
    if (drawingText || math) removeXmlChild(parent, child);
    else if (child.namespaceUri === MARKUP_COMPATIBILITY_NS
      && ['AlternateContent', 'Choice', 'Fallback'].includes(child.localName)) {
      removeParagraphContent(child);
    }
  }
}

function emptyParagraph(body: XmlElement): void {
  const paragraphs = xmlElementChildren(body, { localName: 'p', namespaceUri: DRAWINGML_NS });
  const first = paragraphs[0];
  if (!first) throw new Error('表格行模板缺少 a:p');
  const previousEnd = findXmlChild(first, { localName: 'endParaRPr', namespaceUri: DRAWINGML_NS });
  const endTail = previousEnd ? first.children.slice(first.children.indexOf(previousEnd) + 1) : [];
  const runProperties = findXmlDescendant(first, { localName: 'rPr', namespaceUri: DRAWINGML_NS })
    ?? findXmlChild(first, { localName: 'endParaRPr', namespaceUri: DRAWINGML_NS });
  for (const paragraph of paragraphs.slice(1)) removeXmlChild(body, paragraph);
  removeParagraphContent(first);

  // 保留首段属性、pPr 与未知扩展；只用来源输入格式重建不含文字的结尾属性。
  const end = namespacedElement(first, DRAWINGML_NS, 'endParaRPr');
  if (runProperties) {
    for (const attribute of runProperties.attributes) {
      setXmlAttribute(end, attribute.name, attribute.value, attribute.quote);
    }
    for (const child of runProperties.children) insertXmlChildUnchecked(end, cloneXmlNode(child));
  }
  // 原 endParaRPr 的位置已经满足序位；复用其后继锚点可绕过被清空的 AlternateContent 分支。
  const endAnchor = endTail.find((child) => first.children.includes(child)) ?? null;
  insertXmlChildUnchecked(first, end, endAnchor);
}

/** 旧末行可能是纵向合并的收尾；新增尾行只复制横向合并拓扑。 */
function clearRow(row: XmlElement): void {
  const cells = xmlElementChildren(row, { localName: 'tc', namespaceUri: DRAWINGML_NS });
  let coveredUntil = 0;
  cells.forEach((cell, column) => {
    const horizontalPlaceholder = column < coveredUntil;
    const gridSpan = Number(findXmlAttribute(cell, { localName: 'gridSpan', namespaceUri: null })?.value ?? 1);
    if (!horizontalPlaceholder) coveredUntil = Math.max(coveredUntil, column + Math.max(1, gridSpan));
    removeXmlAttribute(cell, 'rowSpan');
    removeXmlAttribute(cell, 'vMerge');
    if (horizontalPlaceholder) setXmlAttribute(cell, 'hMerge', '1');
    else removeXmlAttribute(cell, 'hMerge');
    const body = findXmlChild(cell, { localName: 'txBody', namespaceUri: DRAWINGML_NS });
    if (!body) throw new Error(`表格行模板第 ${column} 格缺少 a:txBody`);
    emptyParagraph(body);
  });
}

function clearCell(cell: XmlElement): void {
  for (const attribute of ['rowSpan', 'gridSpan', 'hMerge', 'vMerge']) removeXmlAttribute(cell, attribute);
  const body = findXmlChild(cell, { localName: 'txBody', namespaceUri: DRAWINGML_NS });
  if (!body) throw new Error('表格单元格模板缺少 a:txBody');
  emptyParagraph(body);
}

function applyDirectCellAppearance(target: XmlElement, source: Parameters<typeof directTableCellMarkup>[0]): void {
  const wrapper = parseXmlTree(`<root xmlns:a="${DRAWINGML_NS}">${directTableCellMarkup(source)}</root>`);
  const staged = xmlElementChildren(wrapper.root, { localName: 'tc', namespaceUri: DRAWINGML_NS })[0];
  if (!staged) throw new Error('无法构造表格追加行直接格式');
  for (const name of ['txBody', 'tcPr']) {
    const replacement = findXmlChild(staged, { localName: name, namespaceUri: DRAWINGML_NS });
    const current = findXmlChild(target, { localName: name, namespaceUri: DRAWINGML_NS });
    if (!replacement || !current || !removeXmlChild(staged, replacement)) {
      throw new Error(`表格追加行缺少 a:${name}`);
    }
    replaceXmlChildren(target, current, [replacement]);
  }
}

/** 只识别本引擎写出的自包含格式签名；普通粘贴表格继续保留完整来源 XML。 */
function hasSelfContainedTableAppearance(row: XmlElement): boolean {
  const requiredRunAttributes = ['sz', 'b', 'i', 'u', 'strike'];
  return xmlElementChildren(row, { localName: 'tc', namespaceUri: DRAWINGML_NS }).every((cell) => {
    const body = findXmlChild(cell, { localName: 'txBody', namespaceUri: DRAWINGML_NS });
    const bodyPr = body && findXmlChild(body, { localName: 'bodyPr', namespaceUri: DRAWINGML_NS });
    const end = body && findXmlDescendant(body, { localName: 'endParaRPr', namespaceUri: DRAWINGML_NS });
    const properties = findXmlChild(cell, { localName: 'tcPr', namespaceUri: DRAWINGML_NS });
    if (!bodyPr || bodyPr.attributes.some((attribute) => !attribute.name.startsWith('xmlns'))
      || !end || !properties || !requiredRunAttributes.every((name) =>
        !!findXmlAttribute(end, { localName: name, namespaceUri: null }))) return false;
    const runChildren = new Set(xmlElementChildren(end).filter((child) => child.namespaceUri === DRAWINGML_NS)
      .map((child) => child.localName));
    if (!['solidFill', 'latin', 'ea', 'cs'].every((name) => runChildren.has(name))) return false;
    if (!['marT', 'marR', 'marB', 'marL', 'anchor', 'vert'].every((name) =>
      !!findXmlAttribute(properties, { localName: name, namespaceUri: null }))) return false;
    const propertyChildren = xmlElementChildren(properties)
      .filter((child) => child.namespaceUri === DRAWINGML_NS);
    const fill = propertyChildren.find((child) =>
      ['noFill', 'solidFill', 'gradFill', 'pattFill'].includes(child.localName));
    return !!fill && ['lnL', 'lnR', 'lnT', 'lnB'].every((name) => {
      const line = propertyChildren.find((child) => child.localName === name);
      return !!line && xmlElementChildren(line).filter((child) => child.namespaceUri === DRAWINGML_NS)
        .some((child) => ['noFill', 'solidFill'].includes(child.localName));
    });
  });
}

function frameHeight(host: XmlElement, record: ElementRecord): void {
  const transform = findXmlChild(host, { localName: 'xfrm', namespaceUri: PRESENTATIONML_NS });
  const extent = transform && findXmlChild(transform, { localName: 'ext', namespaceUri: DRAWINGML_NS });
  if (!extent) throw new Error(`表格 ${record.id} 缺少 p:xfrm/a:ext`);
  const emu = Math.round(effectiveTableFrameHeight(record) * 9525);
  if (!Number.isSafeInteger(emu)) throw new Error(`表格 ${record.id} 的追加后高度超出安全范围`);
  setXmlAttribute(extent, 'cy', String(emu));
}

function frameSize(host: XmlElement, record: ElementRecord, width: number, height: number): void {
  const transform = findXmlChild(host, { localName: 'xfrm', namespaceUri: PRESENTATIONML_NS });
  const extent = transform && findXmlChild(transform, { localName: 'ext', namespaceUri: DRAWINGML_NS });
  if (!extent) throw new Error(`表格 ${record.id} 缺少 p:xfrm/a:ext`);
  const cx = Math.round(width * 9525);
  const cy = Math.round(height * 9525);
  if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cy) || cx <= 0 || cy <= 0) {
    throw new Error(`表格 ${record.id} 的结构 frame 超出安全范围`);
  }
  setXmlAttribute(extent, 'cx', String(cx));
  setXmlAttribute(extent, 'cy', String(cy));
}

function replaceRepeatedChildren(
  parent: XmlElement, localName: string, replacements: readonly XmlElement[],
): void {
  // 克隆行尚未挂树时 namespaceUri 仍为空；QName 的 localName 已足以识别同层 DrawingML 序位。
  const current = parent.children.filter((child): child is XmlElement =>
    child.type === 'element' && child.localName === localName
      && (child.namespaceUri === DRAWINGML_NS || child.namespaceUri === null));
  const last = current[current.length - 1];
  const anchor = last ? parent.children[parent.children.indexOf(last) + 1] ?? null : null;
  current.forEach((child) => removeXmlChild(parent, child));
  replacements.forEach((child) => insertXmlChildUnchecked(parent, child, anchor));
}

function patchComplexTableStructure(document: XmlDocument, record: ElementRecord): void {
  if (record.src.kind !== 'table') throw new Error(`元素 ${record.id} 不是表格`);
  const { host } = locateElementHost(document, record);
  const table = findXmlDescendant(host, { localName: 'tbl', namespaceUri: DRAWINGML_NS });
  const grid = table && findXmlChild(table, { localName: 'tblGrid', namespaceUri: DRAWINGML_NS });
  if (!table || !grid) throw new Error(`表格 ${record.id} 缺少 a:tbl/a:tblGrid`);
  const sourceRows = xmlElementChildren(table, { localName: 'tr', namespaceUri: DRAWINGML_NS });
  const sourceColumns = xmlElementChildren(grid, { localName: 'gridCol', namespaceUri: DRAWINGML_NS });
  if (sourceRows.length < record.src.rows.length || sourceColumns.length < record.src.colWidths.length) {
    throw new Error(`表格 ${record.id} 的来源网格数量不一致`);
  }
  const rowEntries = orderedTableRows(record);
  const columnEntries = orderedTableColumns(record);
  const projected = projectTableStructure(record, record.src);
  const widths = scaledEmu(projected.colWidths, Math.round(projected.w * 9525), `${record.id}.structure.w`);
  const heights = scaledEmu(projected.rows.map((row) => row.height),
    Math.round(projected.h * 9525), `${record.id}.structure.h`);
  const columns = columnEntries.map((entry, index) => {
    const template = sourceColumns[entry.source ?? entry.template ?? sourceColumns.length - 1];
    if (!template) throw new Error(`表格 ${record.id} 缺少列模板`);
    const column = cloneXmlNode(template);
    setXmlAttribute(column, 'w', String(widths[index]));
    return column;
  });
  replaceRepeatedChildren(grid, 'gridCol', columns);

  const emptyTargets: XmlElement[] = [];
  const rows = rowEntries.map((rowEntry, r) => {
    const rowTemplateIndex = rowEntry.source ?? rowEntry.template ?? sourceRows.length - 1;
    const template = sourceRows[rowTemplateIndex];
    if (!template) throw new Error(`表格 ${record.id} 缺少行模板`);
    const row = cloneXmlNode(template);
    const templateCells = xmlElementChildren(template, { localName: 'tc', namespaceUri: DRAWINGML_NS });
    const cellEntries = columnEntries.map((columnEntry) => {
      const columnTemplate = columnEntry.source ?? columnEntry.template ?? templateCells.length - 1;
      const cellTemplate = templateCells[columnTemplate] ?? templateCells[templateCells.length - 1];
      if (!cellTemplate) throw new Error(`表格 ${record.id} 缺少单元格模板`);
      const cell = cloneXmlNode(cellTemplate);
      return {
        cell,
        empty: rowEntry.source === null || columnEntry.source === null,
      };
    });
    replaceRepeatedChildren(row, 'tc', cellEntries.map((entry) => entry.cell));
    cellEntries.forEach(({ cell, empty }) => {
      for (const attribute of ['rowSpan', 'gridSpan', 'hMerge', 'vMerge']) removeXmlAttribute(cell, attribute);
      if (empty) emptyTargets.push(cell);
    });
    setXmlAttribute(row, 'h', String(heights[r]));
    return row;
  });
  replaceRepeatedChildren(table, 'tr', rows);
  emptyTargets.forEach(clearCell);
  const mergeOwners = new Map<string, { readonly r: number; readonly c: number }>();
  projected.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
    if (cell.merged || cell.rowSpan <= 1 && cell.colSpan <= 1) return;
    for (let rr = r; rr < r + cell.rowSpan; rr++) for (let cc = c; cc < c + cell.colSpan; cc++) {
      mergeOwners.set(`${rr}:${cc}`, { r, c });
    }
  }));
  projected.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
    const target = xmlElementChildren(rows[r], { localName: 'tc', namespaceUri: DRAWINGML_NS })[c];
    if (cell.rowSpan > 1) setXmlAttribute(target, 'rowSpan', String(cell.rowSpan));
    if (cell.colSpan > 1) setXmlAttribute(target, 'gridSpan', String(cell.colSpan));
    if (!cell.merged) return;
    const owner = mergeOwners.get(`${r}:${c}`);
    if (!owner) throw new Error(`表格 ${record.id} 的合并占位格缺少锚点：${r},${c}`);
    if (c > owner.c) setXmlAttribute(target, 'hMerge', '1');
    if (r > owner.r) setXmlAttribute(target, 'vMerge', '1');
  }));
  frameSize(host, record, projected.w, projected.h);
}

function replaceStagedPropertyChild(
  target: XmlElement, staged: XmlElement, names: readonly string[],
): void {
  for (const child of [...xmlElementChildren(target)]) {
    if (child.namespaceUri === DRAWINGML_NS && names.includes(child.localName)) removeXmlChild(target, child);
  }
  const anchor = findXmlChild(target, { localName: 'extLst', namespaceUri: DRAWINGML_NS });
  for (const child of xmlElementChildren(staged)) {
    if (child.namespaceUri === DRAWINGML_NS && names.includes(child.localName)) {
      insertXmlChildUnchecked(target, cloneXmlNode(child), anchor);
    }
  }
}

export function patchTableCellAppearances(document: XmlDocument, record: ElementRecord): void {
  if (!hasTableCellAppearanceOverrides(record)) return;
  if (record.src.kind !== 'table') throw new Error(`元素 ${record.id} 不能写回单元格格式`);
  const { host } = locateElementHost(document, record);
  const table = findXmlDescendant(host, { localName: 'tbl', namespaceUri: DRAWINGML_NS });
  if (!table) throw new Error(`表格 ${record.id} 缺少 a:tbl`);
  const rows = xmlElementChildren(table, { localName: 'tr', namespaceUri: DRAWINGML_NS });
  const projected = hasComplexTableStructureOverrides(record)
    ? projectTableStructure(record, record.src) : { ...record.src, rows: tableRowsWithoutTextOverrides(record) };
  const resolve = tableCellKeyResolver(record);
  for (const [key, override] of Object.entries(record.ovr.tableCells ?? {})) {
    if (!['fill', 'borders', 'margins', 'vAlign', 'vert'].some((field) => own(override, field))) continue;
    const address = resolve(key);
    const stable = tableCellStableRefFromKey(record, key);
    if (!address && stable) continue;
    const source = address && projected.rows[address.r]?.cells[address.c];
    const target = address && rows[address.r]
      ? xmlElementChildren(rows[address.r], { localName: 'tc', namespaceUri: DRAWINGML_NS })[address.c] : null;
    if (!source || !target) throw new Error(`表格 ${record.id} 的单元格格式坐标无效：${key}`);
    const { text: _text, ...appearance } = override;
    const stagedWrapper = parseXmlTree(`<root xmlns:a="${DRAWINGML_NS}">${directTableCellMarkup({
      ...source, ...appearance,
    })}</root>`);
    const stagedCell = xmlElementChildren(stagedWrapper.root, { localName: 'tc', namespaceUri: DRAWINGML_NS })[0];
    const staged = stagedCell && findXmlChild(stagedCell, { localName: 'tcPr', namespaceUri: DRAWINGML_NS });
    const properties = findXmlChild(target, { localName: 'tcPr', namespaceUri: DRAWINGML_NS });
    if (!staged || !properties) throw new Error(`表格 ${record.id} 的单元格缺少 a:tcPr`);
    if (override.margins) for (const [name, value] of [
      ['marT', override.margins[0]], ['marR', override.margins[1]],
      ['marB', override.margins[2]], ['marL', override.margins[3]],
    ] as const) setXmlAttribute(properties, name, String(Math.round(value * 9525)));
    if (override.vAlign) setXmlAttribute(properties, 'anchor', override.vAlign === 'middle' ? 'ctr'
      : override.vAlign === 'bottom' ? 'b' : 't');
    if (override.vert) setXmlAttribute(properties, 'vert', override.vert);
    if (own(override, 'fill')) replaceStagedPropertyChild(properties, staged,
      ['noFill', 'solidFill', 'gradFill', 'pattFill']);
    if (override.borders) for (const [side, name] of [
      ['l', 'lnL'], ['r', 'lnR'], ['t', 'lnT'], ['b', 'lnB'],
    ] as const) if (own(override.borders, side)) replaceStagedPropertyChild(properties, staged, [name]);
  }
}

/** 从首次触碰基线重建，连续保存不会重复烘入相同行。 */
export function patchTableRows(document: XmlDocument, record: ElementRecord): void {
  if (!hasTableRowOverrides(record)) return;
  if (record.src.kind !== 'table' || record.meta.editable !== 'full') {
    throw new Error(`元素 ${record.id} 不能写回表格行`);
  }
  const { host } = locateElementHost(document, record);
  if (hasComplexTableStructureOverrides(record)) {
    patchComplexTableStructure(document, record);
    return;
  }
  const table = findXmlDescendant(host, { localName: 'tbl', namespaceUri: DRAWINGML_NS });
  if (!table) throw new Error(`表格 ${record.id} 缺少 a:tbl`);
  const sourceRows = xmlElementChildren(table, { localName: 'tr', namespaceUri: DRAWINGML_NS });
  const template = sourceRows[sourceRows.length - 1];
  if (!template) throw new Error(`表格 ${record.id} 没有可复制的 a:tr`);
  const selfContainedAppearance = hasSelfContainedTableAppearance(template);
  const anchor = table.children[table.children.indexOf(template) + 1] ?? null;
  const projectedRows = tableRowsWithoutTextOverrides(record);
  const total = projectedRows.length - record.src.rows.length;
  for (let index = 0; index < total; index++) {
    const row = cloneXmlNode(template);
    // 克隆节点先挂回原命名空间上下文；固定锚点也让未知尾节点继续留在全部 a:tr 之后。
    insertXmlChildUnchecked(table, row, anchor);
    clearRow(row);
    const appearance = projectedRows[record.src.rows.length + index];
    const cells = xmlElementChildren(row, { localName: 'tc', namespaceUri: DRAWINGML_NS });
    if (selfContainedAppearance && appearance && cells.length === appearance.cells.length) {
      cells.forEach((cell, column) => applyDirectCellAppearance(cell, appearance.cells[column]));
    }
  }
  frameHeight(host, record);
}

/** 以 BigInt 最大余数法写回网格，缩放后的每行每列仍是正整数 EMU 且总和严格等于 frame。 */
function scaledEmu(values: readonly number[], total: number, label: string): number[] {
  const weights = values.map((value) => Math.round(value * 9525));
  if (!Number.isSafeInteger(total) || total < values.length
    || weights.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${label} 无法分配为正整数 EMU`);
  }
  const denominator = weights.reduce((sum, value) => sum + BigInt(value), 0n);
  const parts = weights.map((weight, index) => {
    const product = BigInt(total) * BigInt(weight);
    return { index, value: Number(product / denominator), remainder: product % denominator };
  });
  let remaining = total - parts.reduce((sum, part) => sum + part.value, 0);
  const order = [...parts].sort((left, right) => left.remainder === right.remainder
    ? left.index - right.index : left.remainder > right.remainder ? -1 : 1);
  for (let index = 0; index < remaining; index++) order[index].value++;
  const result = parts.map((part) => part.value);
  if (result.some((value) => value <= 0)) throw new Error(`${label} 缩放后存在零尺寸网格`);
  return result;
}

/** frame 与内部网格必须同生共变；Office 不会替编辑模型猜测各行列的新整数尺寸。 */
export function patchTableGeometry(document: XmlDocument, record: ElementRecord): void {
  if (record.src.kind !== 'table' || hasComplexTableStructureOverrides(record)
    || (!own(record.ovr, 'w') && !own(record.ovr, 'h'))) return;
  const { host } = locateElementHost(document, record);
  const table = findXmlDescendant(host, { localName: 'tbl', namespaceUri: DRAWINGML_NS });
  if (!table) throw new Error(`表格 ${record.id} 缺少 a:tbl`);
  if (own(record.ovr, 'w')) {
    const grid = findXmlChild(table, { localName: 'tblGrid', namespaceUri: DRAWINGML_NS });
    if (!grid) throw new Error(`表格 ${record.id} 缺少 a:tblGrid`);
    const columns = xmlElementChildren(grid, { localName: 'gridCol', namespaceUri: DRAWINGML_NS });
    if (columns.length !== record.src.colWidths.length) throw new Error(`表格 ${record.id} 的列网格数量不一致`);
    const widths = scaledEmu(record.src.colWidths, Math.round(record.ovr.w! * 9525), `${record.id}.w`);
    columns.forEach((column, index) => setXmlAttribute(column, 'w', String(widths[index])));
  }
  if (own(record.ovr, 'h')) {
    const rows = xmlElementChildren(table, { localName: 'tr', namespaceUri: DRAWINGML_NS });
    const projected = tableRowsWithoutTextOverrides(record);
    if (rows.length !== projected.length) throw new Error(`表格 ${record.id} 的行网格数量不一致`);
    const heights = scaledEmu(projected.map((row) => row.height),
      Math.round(effectiveTableFrameHeight(record) * 9525), `${record.id}.h`);
    rows.forEach((row, index) => setXmlAttribute(row, 'h', String(heights[index])));
    // 新插入片段会在整页上下文再次物化覆盖；这里重申有效高度，不能退回稀疏基准 h。
    frameHeight(host, record);
  }
}
