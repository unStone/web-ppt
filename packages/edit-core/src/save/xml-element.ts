import { createXmlElement } from '../xml/nodes';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { elementState } from '../xml/state';
import type { XmlElement } from '../xml/types';

/** 沿用源 part 已绑定的前缀；没有绑定时才为新命名空间声明稳定前缀。 */
export function namespacedElement(
  parent: XmlElement,
  namespaceUri: string,
  localName: string,
): XmlElement {
  const namespaces = elementState(parent).namespaces;
  const bound = [...namespaces].find(([, uri]) => uri === namespaceUri)?.[0];
  if (bound !== undefined) return createXmlElement(bound ? `${bound}:${localName}` : localName);

  const base = namespaceUri === DRAWINGML_NS ? 'a' : namespaceUri === PRESENTATIONML_NS ? 'p' : 'ns';
  let prefix = base;
  let serial = 1;
  while (namespaces.has(prefix)) prefix = `${base}${serial++}`;
  return createXmlElement(`${prefix}:${localName}`, {
    attributes: [[`xmlns:${prefix}`, namespaceUri]],
  });
}
