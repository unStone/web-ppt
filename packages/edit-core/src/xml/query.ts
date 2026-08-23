import type { XmlAttribute, XmlElement } from './types';

export interface XmlNameSelector {
  localName: string;
  /** 省略表示任意命名空间；显式 null 只匹配无命名空间。 */
  namespaceUri?: string | null;
}

const matches = (
  node: { localName: string; namespaceUri: string | null },
  selector: XmlNameSelector,
): boolean => node.localName === selector.localName
  && (!Object.prototype.hasOwnProperty.call(selector, 'namespaceUri')
    || node.namespaceUri === selector.namespaceUri);

export function xmlElementChildren(parent: XmlElement, selector?: XmlNameSelector): XmlElement[] {
  const children = parent.children.filter((node): node is XmlElement => node.type === 'element');
  return selector ? children.filter((node) => matches(node, selector)) : children;
}

export function findXmlChild(parent: XmlElement, selector: XmlNameSelector): XmlElement | null {
  return xmlElementChildren(parent).find((node) => matches(node, selector)) ?? null;
}

export function findXmlDescendant(parent: XmlElement, selector: XmlNameSelector): XmlElement | null {
  for (const child of xmlElementChildren(parent)) {
    if (matches(child, selector)) return child;
    const nested = findXmlDescendant(child, selector);
    if (nested) return nested;
  }
  return null;
}

export function findXmlAttribute(element: XmlElement, selector: XmlNameSelector): XmlAttribute | null {
  return element.attributes.find((attribute) => matches(attribute, selector)) ?? null;
}
