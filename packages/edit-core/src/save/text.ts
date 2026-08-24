import type { ElementRecord } from '../types';
import { insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import type { XmlDocument } from '../xml/types';
import { locateElementHost } from './xfrm';
import { namespacedElement } from './xml-element';

export function hasTextOverrides(record: ElementRecord): boolean {
  return record.ovr.text !== undefined;
}

/** empty 只替换段落序列；bodyPr、lstStyle、命名空间与宿主身份全部原样保留。 */
export function patchElementText(document: XmlDocument, record: ElementRecord): void {
  if (record.ovr.text?.kind !== 'empty') return;
  if (record.src.kind !== 'shape' || record.meta.editable !== 'full') {
    throw new Error(`元素 ${record.id} 不能写回文本`);
  }
  const { host } = locateElementHost(document, record);
  const body = findXmlChild(host, { localName: 'txBody', namespaceUri: PRESENTATIONML_NS });
  if (!body) throw new Error(`文本形状 ${record.id} 缺少 p:txBody`);
  for (const paragraph of xmlElementChildren(body, { localName: 'p', namespaceUri: DRAWINGML_NS })) {
    removeXmlChild(body, paragraph);
  }
  const paragraph = namespacedElement(body, DRAWINGML_NS, 'p');
  insertXmlInOrder(body, paragraph);
  const end = namespacedElement(paragraph, DRAWINGML_NS, 'endParaRPr');
  insertXmlChildUnchecked(paragraph, end);
}
