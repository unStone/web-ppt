import { tableRowsWithoutTextOverrides, effectiveTableFrameHeight } from '../table-rows';
import { directTableCellMarkup } from '../table-direct-markup';
import { own } from '../data-validation';
import type { ElementRecord } from '../types';
import {
  cloneXmlNode, insertXmlChildUnchecked, removeXmlChild, replaceXmlChildren,
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
  return !!record.ovr.tableRows && Object.keys(record.ovr.tableRows).length > 0;
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

/** 从首次触碰基线重建，连续保存不会重复烘入相同行。 */
export function patchTableRows(document: XmlDocument, record: ElementRecord): void {
  if (!hasTableRowOverrides(record)) return;
  if (record.src.kind !== 'table' || record.meta.editable !== 'full') {
    throw new Error(`元素 ${record.id} 不能写回表格行`);
  }
  const { host } = locateElementHost(document, record);
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
  if (record.src.kind !== 'table' || (!own(record.ovr, 'w') && !own(record.ovr, 'h'))) return;
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
