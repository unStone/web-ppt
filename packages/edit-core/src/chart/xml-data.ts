import {
  createXmlElement, createXmlText, findXmlAttribute, insertXmlChildUnchecked,
  removeXmlChild, xmlElementChildren,
} from '@web-ppt/edit-core/xml';
import type { XmlElement, XmlNode } from '@web-ppt/edit-core/xml';
import { isChartNamespace, isSpreadsheetNamespace } from './xml-namespaces';

/** 先锁定父节点的格式与方言；同名的外来子节点不能成为数据来源。 */
function dialectAccess(accept: (namespace: string | null) => boolean) {
  const children = (node: XmlElement | null, name?: string): XmlElement[] =>
    node && accept(node.namespaceUri) ? xmlElementChildren(node).filter((item) =>
      item.namespaceUri === node.namespaceUri && (!name || item.localName === name)) : [];
  const child = (node: XmlElement | null, name: string): XmlElement | null =>
    node && accept(node.namespaceUri) ? xmlElementChildren(node).find((item) =>
      item.namespaceUri === node.namespaceUri && item.localName === name) ?? null : null;
  return { child, children };
}

export const chartXml = dialectAccess(isChartNamespace);
export const worksheetXml = dialectAccess(isSpreadsheetNamespace);
export const xmlAttribute = (node: XmlElement | null, name: string): string | null =>
  node ? findXmlAttribute(node, { localName: name, namespaceUri: null })?.value ?? null : null;
export const xmlContent = (node: XmlElement | null): string => node
  ? node.children.map((item) => item.type === 'text' || item.type === 'cdata'
    ? item.value : item.type === 'element' ? xmlContent(item) : '').join('') : '';

export function appendXml(parent: XmlElement, node: XmlNode, before: XmlNode | null = null): void {
  insertXmlChildUnchecked(parent, node, before);
}

export function makeDataElement(
  parent: XmlElement, name: string, attributes: readonly (readonly [string, string])[] = [],
): XmlElement {
  return createXmlElement(parent.prefix ? `${parent.prefix}:${name}` : name, {
    attributes, selfClosing: false,
  });
}

export function setDataText(node: XmlElement, value: string): void {
  for (const current of [...node.children]) removeXmlChild(node, current);
  appendXml(node, createXmlText(value));
}

/**
 * EG_AxShared 中排在轴标题（title）之后的子元素 localName，四种轴共用。轴标题
 * 重排时锚定到第一个出现的后继元素——XSD 要求 title 落在 numFmt 之前，紧贴
 * crossAx 反而是非法位置。crossAx 是必填子元素，锚点在合法轴上总能命中，无需
 * 列举各类型的尾部元素。按 localName 判断可同时覆盖两种 chart 命名空间。
 * 用单个字符串 + split 表达：字符串字面量对 gzip 预算的影响远小于一组引号字面量。
 */
const AXIS_TITLE_SUCCESSORS = new Set(
  'numFmt majorTickMark minorTickMark tickLblPos spPr txPr crossAx crosses crossesAt'.split(' '));

/** 轴标题按 EG_AxShared 序列归位：调用方先 remove 再带本锚点插回。 */
export function axisTitleAnchor(axis: XmlElement): XmlElement | null {
  return xmlElementChildren(axis).find((item) => AXIS_TITLE_SUCCESSORS.has(item.localName)) ?? null;
}
