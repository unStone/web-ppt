import type { SlideElement } from '@web-ppt/core';
import { initialFractionalIndex } from '../fractional-index';
import {
  changedLayout, projectedLayoutElements, projectionContentIds,
} from '../layout-projection';
import { effectiveElement } from '../projection';
import type { EditDoc, ElementRecord, SlideId } from '../types';

export interface GeneratedProjectionTree {
  readonly roots: string[];
  readonly sourceRecords: Record<string, ElementRecord>;
}

export function allocatedProjectionSpids(
  records: Readonly<Record<string, ElementRecord>>,
  roots: readonly string[],
): Map<string, number> {
  const used = new Set<number>([1]);
  const result = new Map<string, number>();
  let next = 2;
  const visit = (id: string): void => {
    const sourceId = records[id].src.id;
    let spid = sourceId && Number.isSafeInteger(sourceId) && sourceId > 1 && !used.has(sourceId)
      ? sourceId : 0;
    while (!spid && used.has(next)) next++;
    if (!spid) spid = next++;
    used.add(spid);
    result.set(id, spid);
    for (const child of records[id].children ?? []) visit(child);
  };
  for (const id of roots) visit(id);
  return result;
}

/** 生成包没有版式关系，先把有效版式视觉变成页面自有的稳定记录树。 */
export function generatedProjectionTree(doc: EditDoc, slideId: SlideId): GeneratedProjectionTree {
  const sourceRecords: Record<string, ElementRecord> = Object.create(null);
  const roots: string[] = [];
  let virtualSequence = 0;
  const virtualId = (): string => {
    let id: string;
    do id = `${slideId}-layout-${++virtualSequence}`;
    while (doc.elements[id] || sourceRecords[id]);
    return id;
  };
  const addVirtual = (element: SlideElement, parent: string, index: number): string => {
    const id = virtualId();
    const record: ElementRecord = {
      id, parent, z: initialFractionalIndex(index), src: structuredClone(element), ovr: {},
      meta: {
        editable: 'full', created: true,
        ...(element.editInfo?.geom ? { geom: structuredClone(element.editInfo.geom) } : {}),
        ...(element.editInfo?.customGeometry
          ? { customGeometry: structuredClone(element.editInfo.customGeometry) } : {}),
      },
    };
    sourceRecords[id] = record;
    if (element.kind === 'group') {
      record.children = element.children.map((child, childIndex) =>
        addVirtual(child, id, childIndex));
    }
    return id;
  };
  if (changedLayout(doc, slideId)) {
    const virtual = projectedLayoutElements(doc, slideId, (id) => effectiveElement(doc, id))
      .filter((element) => !element.editInfo?.placeholder);
    virtual.forEach((element, index) => roots.push(addVirtual(element, slideId, index)));
  }
  const visitSource = (id: string): void => {
    const source = doc.elements[id];
    if (!source) throw new Error(`生成保存找不到投影元素：${id}`);
    sourceRecords[id] = source;
    for (const child of source.children ?? []) visitSource(child);
  };
  for (const id of projectionContentIds(doc, slideId)) {
    roots.push(id);
    visitSource(id);
  }
  roots.forEach((id, index) => {
    sourceRecords[id] = { ...sourceRecords[id], z: initialFractionalIndex(index) };
  });
  return { roots, sourceRecords };
}
