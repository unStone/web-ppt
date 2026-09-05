import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { findXmlAttribute, xmlElementChildren } from '../xml/query';
import { setXmlAttribute } from '../xml/mutate';
import type { XmlElement } from '../xml/types';

/** 隐藏分支也可能有连接线；只改 cNvPr 会让线端继续指向已经换号的旧对象。 */
export function remapCompatibilityReferences(host: XmlElement, ids: Readonly<Record<string, number>>): void {
  const field = host.namespaceUri === DRAWINGML_NS && ['stCxn', 'endCxn'].includes(host.localName) ? 'id'
    : host.namespaceUri === PRESENTATIONML_NS && host.localName === 'spTgt' ? 'spid' : null;
  if (field) {
    const attribute = findXmlAttribute(host, { localName: field, namespaceUri: null });
    const id = attribute ? ids[attribute.value] : undefined;
    if (id !== undefined) setXmlAttribute(host, field, String(id));
  }
  for (const child of xmlElementChildren(host)) remapCompatibilityReferences(child, ids);
}
