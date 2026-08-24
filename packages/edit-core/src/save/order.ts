import { writableLayerSiblingIds } from '../element-order';
import type { EditDoc, ElementRecord } from '../types';
import { reorderXmlChildren } from '../xml/nodes';
import type { XmlDocument, XmlElement } from '../xml/types';
import { locateElementHosts } from './xfrm';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

export function hasOrderOverride(record: ElementRecord): boolean {
  return own(record, 'order');
}

/** 同一父级只执行一次宿主重排；未知节点与只读投影占据的 XML 槽位不会被搬动。 */
export function patchElementOrders(
  document: XmlDocument,
  doc: EditDoc,
  part: string,
  scope?: ReadonlySet<string>,
): void {
  const changedParents = new Map<string, ElementRecord>();
  for (const record of Object.values(doc.elements)) {
    if ((!scope || scope.has(record.id)) && hasOrderOverride(record) && record.meta.origin?.part === part) {
      changedParents.set(record.parent, record);
    }
  }
  for (const record of changedParents.values()) {
    const siblings = writableLayerSiblingIds(doc, record)
      .map((id) => doc.elements[id])
      .filter((sibling): sibling is ElementRecord => !!sibling && sibling.meta.origin?.part === part
        && (!scope || scope.has(sibling.id)));
    if (siblings.length < 2) continue;
    const located = locateElementHosts(document, siblings);
    const locations = siblings.map((sibling) => located.get(sibling.id)!);
    const parent = locations[0].parent;
    if (locations.some((location) => location.parent !== parent)) {
      throw new Error(`父节点 ${record.parent} 的 OOXML 宿主不在同一容器`);
    }
    reorderXmlChildren(parent as XmlElement, locations.map((location) => location.host));
  }
}
