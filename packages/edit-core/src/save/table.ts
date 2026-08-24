import { tableRowsWithoutTextOverrides, effectiveTableFrameHeight } from '../table-rows';
import type { ElementRecord } from '../types';
import { cloneXmlNode, insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import {
  DRAWINGML_NS, MARKUP_COMPATIBILITY_NS, OFFICE_MATH_NS, PRESENTATIONML_NS,
} from '../xml/qname';
import { findXmlAttribute, findXmlChild, findXmlDescendant, xmlElementChildren } from '../xml/query';
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
  const anchor = table.children[table.children.indexOf(template) + 1] ?? null;
  const total = tableRowsWithoutTextOverrides(record).length - record.src.rows.length;
  for (let index = 0; index < total; index++) {
    const row = cloneXmlNode(template);
    // 克隆节点先挂回原命名空间上下文；固定锚点也让未知尾节点继续留在全部 a:tr 之后。
    insertXmlChildUnchecked(table, row, anchor);
    clearRow(row);
  }
  frameHeight(host, record);
}
