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
