import type { ElementRecord } from '../types';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import { findXmlChild } from '../xml/query';
import type { XmlDocument } from '../xml/types';
import { locateElementHost } from './xfrm';

export const hasAltTextOverride = (record: ElementRecord): boolean => !!record.ovr.altText;

export function patchElementAltText(document: XmlDocument, record: ElementRecord): void {
  if (!record.ovr.altText) return;
  if (record.meta.editable === 'none') throw new Error(`元素 ${record.id} 的替代文字不可写`);
  const { host, spec } = locateElementHost(document, record);
  const nonVisual = findXmlChild(host, {
    localName: spec.nonVisual, namespaceUri: spec.namespaceUri,
  });
  const properties = nonVisual && findXmlChild(nonVisual, {
    localName: 'cNvPr', namespaceUri: spec.namespaceUri,
  });
  if (!properties) throw new Error(`元素 ${record.id} 缺少 cNvPr 替代文字宿主`);
  if (Object.prototype.hasOwnProperty.call(record.ovr.altText, 'title')) {
    const value = record.ovr.altText.title!;
    if (value) setXmlAttribute(properties, 'title', value);
    else removeXmlAttribute(properties, 'title');
  }
  if (Object.prototype.hasOwnProperty.call(record.ovr.altText, 'descr')) {
    const value = record.ovr.altText.descr!;
    if (value) setXmlAttribute(properties, 'descr', value);
    else removeXmlAttribute(properties, 'descr');
  }
}
