import type { SlideElement } from '@web-ppt/core';
import { elementOrder } from './element-order';
import { effectiveElement } from './projection';
import { outermostSelectedElementIds } from './selection';
import { elementFrameToSlideMatrix, elementFrameToSlidePoint } from './space';
import { clipboardClosure } from './clipboard-source';
import { locateElementHosts } from './save/xfrm';
import { nodeState } from './xml/state';
import { parseXmlTree } from './xml/tree';
import type {
  ClipboardElementRecord, ClipboardResource, ClipboardXmlRoot, ElementClipboardPayload,
  ElementClipboardRecordMeta,
} from './commands/types';
import type { EditDoc, ElementId, ElementMeta } from './types';
import type { XmlElement } from './xml/types';

function hostSpids(host: XmlElement): string[] {
  const values: string[] = [];
  const visit = (element: XmlElement): void => {
    if (element.localName === 'cNvPr') {
      const id = element.attributes.find((attribute) => attribute.localName === 'id' && !attribute.namespaceUri);
      if (id) values.push(id.value);
    }
    for (const child of element.children) if (child.type === 'element') visit(child);
  };
  visit(host);
  return values;
}

function copiedMeta(meta: ElementMeta, frameToSlide?: ReturnType<typeof elementFrameToSlideMatrix>): ElementClipboardRecordMeta {
  return {
    editable: meta.editable,
    anchored: !!meta.origin,
    ...(meta.origin ? { sourceSpid: meta.origin.spid } : {}),
    ...(meta.geom ? { geom: structuredClone(meta.geom) } : {}),
    ...(frameToSlide ? { frameToSlide } : {}),
  };
}

function copiedSource(doc: EditDoc, id: ElementId): SlideElement {
  const effective = structuredClone(effectiveElement(doc, id));
  delete effective.editInfo;
  delete effective.id;
  if (effective.kind === 'group') effective.children = [];
  return effective;
}

function rootBounds(doc: EditDoc, ids: readonly ElementId[]): { left: number; top: number } {
  const points = ids.flatMap((id) => {
    const element = effectiveElement(doc, id);
    return [
      { x: 0, y: 0 }, { x: element.w, y: 0 },
      { x: element.w, y: element.h }, { x: 0, y: element.h },
    ].map((point) => elementFrameToSlidePoint(doc, id, point));
  });
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
  };
}

/** 载荷身份只在自身 JSON 内有效；不能泄漏或复用会话级 EditDoc id。 */
export function copyElements(doc: EditDoc, input: readonly ElementId[]): ElementClipboardPayload {
  if (!Array.isArray(input) || !input.length
    || input.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('复制元素必须提供非空 id 数组');
  }
  if (new Set(input).size !== input.length) throw new Error('复制元素不能包含重复 id');
  const roots = outermostSelectedElementIds(doc, input)
    .sort((left, right) => elementOrder(doc.elements[left]).localeCompare(elementOrder(doc.elements[right])));
  const parent = doc.elements[roots[0]]?.parent;
  if (!parent || roots.some((id) => doc.elements[id]?.parent !== parent)) {
    throw new Error('一次复制的最外层根必须属于同一父级');
  }
  for (const id of roots) {
    const record = doc.elements[id];
    if (!record || record.meta.editable === 'none') throw new Error(`元素不可复制：${id}`);
    if (record.meta.locked) throw new Error(`元素已锁定：${id}`);
  }

  const records: Record<string, ClipboardElementRecord> = Object.create(null);
  const rootIds: string[] = [];
  let next = 1;
  const visit = (id: ElementId, clipboardParent: string | null): string => {
    const record = doc.elements[id];
    if (!record) throw new Error(`复制树引用不存在的元素：${id}`);
    const clipboardId = `e${next++}`;
    const children = (record.children ?? []).map((child) => visit(child, clipboardId));
    records[clipboardId] = {
      id: clipboardId,
      parent: clipboardParent,
      src: copiedSource(doc, id),
      meta: copiedMeta(record.meta, clipboardParent === null ? elementFrameToSlideMatrix(doc, id) : undefined),
      children,
    };
    return clipboardId;
  };
  for (const id of roots) rootIds.push(visit(id, null));
  const sourcePart = doc.elements[roots[0]].meta.origin?.part;
  const pkg = doc.package;
  const sourceBytes = sourcePart && pkg?.parts[sourcePart];
  if (!sourcePart || !sourceBytes || !pkg) throw new Error('复制元素缺少可读取的 OOXML 来源 part');
  const document = parseXmlTree(sourceBytes);
  const located = locateElementHosts(document, roots.map((id) => doc.elements[id]));
  const namespaces: Record<string, string> = Object.create(null);
  for (const attribute of document.root.attributes) {
    if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) {
      namespaces[attribute.name] = attribute.value;
    }
  }
  const xmlRoots: Record<string, ClipboardXmlRoot> = Object.create(null);
  const resources = new Map<string, ClipboardResource>();
  roots.forEach((id, index) => {
    const host = located.get(id)!.host;
    const closure = clipboardClosure(pkg, sourcePart, host);
    for (const resource of closure.resources) resources.set(resource.hash, resource);
    xmlRoots[rootIds[index]] = {
      markup: nodeState(host).raw,
      namespaces: { ...namespaces },
      hostSpids: hostSpids(host),
      ...(closure.relationships.length ? { relationships: closure.relationships } : {}),
    };
  });
  return {
    format: 'web-ppt-elements',
    version: 1,
    source: { width: doc.meta.width, height: doc.meta.height },
    bounds: rootBounds(doc, roots),
    roots: rootIds,
    records,
    ooxml: { roots: xmlRoots },
    resources: [...resources.values()],
  };
}
