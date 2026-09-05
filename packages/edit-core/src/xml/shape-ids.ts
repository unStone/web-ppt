import type { XmlElement } from './types';
import { findXmlAttribute } from './query';

/** 同一兼容对象的不同表示允许复用 ID；调用方需要的是占用集合，不是出现次数。 */
export function shapeIds(root: XmlElement): string[] {
  const ids = new Set<string>();
  const visit = (element: XmlElement): void => {
    if (element.localName === 'cNvPr') {
      const id = findXmlAttribute(element, { localName: 'id', namespaceUri: null });
      if (id) ids.add(id.value);
    }
    for (const child of element.children) if (child.type === 'element') visit(child);
  };
  visit(root);
  return [...ids];
}
