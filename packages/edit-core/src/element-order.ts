import { compareFractionalIndex } from './fractional-index';
import type { EditDoc, ElementId, ElementRecord, FractionalIndex } from './types';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

export function elementOrder(record: Pick<ElementRecord, 'z' | 'order'>): FractionalIndex {
  return own(record, 'order') ? record.order! : record.z;
}

export function elementParentChildren(doc: EditDoc, parent: string): ElementId[] {
  const children = doc.slides[parent]?.children ?? doc.elements[parent]?.children;
  if (!children) throw new Error(`元素父节点不存在或不能包含子元素：${parent}`);
  return children;
}

function sourcePart(record: ElementRecord): string | null {
  return record.meta.origin?.part ?? null;
}

/** 母版/版式与歧义宿主留在固定槽位；层级命令只重排可可靠写回的同 part 直属节点。 */
export function writableLayerSiblingIds(doc: EditDoc, record: ElementRecord): ElementId[] {
  const part = sourcePart(record);
  return elementParentChildren(doc, record.parent).filter((id) => {
    const sibling = doc.elements[id];
    return !!sibling && sibling.meta.editable !== 'none' && !sibling.meta.locked && sourcePart(sibling) === part;
  });
}

/** 同一事务可能改多个键；最后只排序一次，避免多选操作退化成逐元素全量搬移。 */
export function sortElementChildrenByOrder(doc: EditDoc, parent: string): void {
  elementParentChildren(doc, parent).sort((left, right) => {
    const leftRecord = doc.elements[left];
    const rightRecord = doc.elements[right];
    if (!leftRecord || !rightRecord) throw new Error(`父节点 ${parent} 引用了不存在的元素`);
    return compareFractionalIndex(elementOrder(leftRecord), elementOrder(rightRecord));
  });
}
