import type { ElementRecord } from '../types';
import { setXmlAttribute } from '../xml/mutate';
import { findXmlChild } from '../xml/query';
import type { XmlDocument } from '../xml/types';
import { locateElementHost } from './xfrm';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

export function hasNameOverride(record: ElementRecord): boolean {
  return own(record.ovr, 'name');
}

/** 名称只落在宿主 cNvPr；不重建 non-visual 树，避免碰未知扩展与锁定节点。 */
export function patchElementName(document: XmlDocument, record: ElementRecord): void {
  if (!hasNameOverride(record)) return;
  if (record.meta.editable === 'none') throw new Error(`元素 ${record.id} 不可重命名`);
  const { host, spec } = locateElementHost(document, record);
  const nonVisual = findXmlChild(host, {
    localName: spec.nonVisual, namespaceUri: spec.namespaceUri,
  });
  const properties = nonVisual && findXmlChild(nonVisual, {
    localName: 'cNvPr', namespaceUri: spec.namespaceUri,
  });
  if (!properties) throw new Error(`元素 ${record.id} 缺少 cNvPr 名称宿主`);
  setXmlAttribute(properties, 'name', record.ovr.name as string);
}
