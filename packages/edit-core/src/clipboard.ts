import type { SlideElement } from '@web-ppt/core';
import { elementOrder } from './element-order';
import { tokenizeElementAssets } from './clipboard-assets';
import { effectiveElement } from './projection';
import { outermostSelectedElementIds } from './selection';
import { elementFrameToSlideMatrix, elementFrameToSlidePoint } from './space';
import { clipboardClosure } from './clipboard-source';
import { materializeElementRoots, materializeInsertionFragment } from './save/insertion';
import { locateElementHosts } from './save/xfrm';
import { serializeXmlNode } from './xml/tree';
import type {
  ClipboardElementRecord, ClipboardResource, ClipboardXmlRoot, ElementClipboardPayload,
  ElementClipboardRecordMeta,
} from './commands/types';
import type { EditDoc, ElementId, ElementMeta, ElementRecord } from './types';
import type { XmlDocument, XmlElement } from './xml/types';

let clipboardBatchSerial = 0;

function createCopyBatchId(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else {
    clipboardBatchSerial++;
    new DataView(bytes.buffer).setUint32(12, clipboardBatchSerial);
  }
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

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

function copiedMeta(
  meta: ElementMeta,
  copyBatchId: string,
  sourcePart: string,
  frameToSlide?: ReturnType<typeof elementFrameToSlideMatrix>,
): ElementClipboardRecordMeta {
  const anchored = meta.origin?.part === sourcePart;
  return {
    copyBatchId,
    editable: meta.editable,
    anchored,
    ...(anchored ? { sourceSpid: meta.origin!.spid } : {}),
    ...(meta.geom ? { geom: structuredClone(meta.geom) } : {}),
    ...(frameToSlide ? { frameToSlide } : {}),
  };
}

function insertionOwner(doc: EditDoc, id: ElementId): ElementRecord | null {
  let current = doc.elements[id];
  while (current) {
    if (current.meta.insertion) return current;
    if (doc.slides[current.parent]) return null;
    current = doc.elements[current.parent];
  }
  return null;
}

function namespaces(document: XmlDocument): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const attribute of document.root.attributes) {
    if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) {
      result[attribute.name] = attribute.value;
    }
  }
  return result;
}

function copiedSource(doc: EditDoc, id: ElementId, assets: Set<string>): SlideElement {
  const effective = effectiveElement(doc, id);
  const source = effective.kind === 'group' ? { ...effective, children: [] } : effective;
  const portable = tokenizeElementAssets(
    doc, source, assets, insertionOwner(doc, id)?.meta.insertion?.resources,
  );
  delete portable.editInfo;
  delete portable.id;
  return portable;
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
  if (roots.length !== input.length) throw new Error('复制元素不能同时包含祖先与其后代');
  const parent = doc.elements[roots[0]]?.parent;
  if (!parent || roots.some((id) => doc.elements[id]?.parent !== parent)) {
    throw new Error('一次复制的最外层根必须属于同一父级');
  }
  for (const id of roots) {
    const record = doc.elements[id];
    if (!record || record.meta.editable === 'none') throw new Error(`元素不可复制：${id}`);
    if (record.meta.locked) throw new Error(`元素已锁定：${id}`);
  }
  const sourcePart = doc.elements[roots[0]].meta.origin?.part;
  const pkg = doc.package;
  const sourceBytes = sourcePart && (doc.saveState.baselines[sourcePart] ?? pkg?.parts[sourcePart]);
  if (!sourcePart || !sourceBytes || !pkg) throw new Error('复制元素缺少可读取的 OOXML 来源 part');
  if (roots.some((id) => doc.elements[id].meta.origin?.part !== sourcePart)) {
    throw new Error('一次复制的元素树必须来自同一 OOXML part');
  }

  const records: Record<string, ClipboardElementRecord> = Object.create(null);
  const rootIds: string[] = [];
  const copyBatchId = createCopyBatchId();
  const assetHashes = new Set<string>();
  let next = 1;
  const visit = (id: ElementId, clipboardParent: string | null): string => {
    const record = doc.elements[id];
    if (!record) throw new Error(`复制树引用不存在的元素：${id}`);
    const clipboardId = `e${next++}`;
    const children = (record.children ?? []).map((child) => visit(child, clipboardId));
    records[clipboardId] = {
      id: clipboardId,
      parent: clipboardParent,
      src: copiedSource(doc, id, assetHashes),
      meta: copiedMeta(
        record.meta, copyBatchId, sourcePart,
        clipboardParent === null ? elementFrameToSlideMatrix(doc, id) : undefined,
      ),
      children,
    };
    return clipboardId;
  };
  for (const id of roots) rootIds.push(visit(id, null));
  const hosts = new Map<ElementId, { host: XmlElement; namespaces: Record<string, string> }>();
  const inserted = new Map<ElementRecord, ElementId[]>();
  const original: ElementId[] = [];
  for (const id of roots) {
    const owner = insertionOwner(doc, id);
    if (!owner) original.push(id);
    else inserted.set(owner, [...(inserted.get(owner) ?? []), id]);
  }
  if (original.length) {
    const document = materializeElementRoots(doc, original.map((id) => doc.elements[id]), sourceBytes);
    const located = locateElementHosts(document, original.map((id) => doc.elements[id]));
    const declarations = namespaces(document);
    for (const id of original) hosts.set(id, { host: located.get(id)!.host, namespaces: declarations });
  }
  for (const [owner, ids] of inserted) {
    const document = materializeInsertionFragment(doc, owner);
    const located = locateElementHosts(document, ids.map((id) => doc.elements[id]));
    const declarations = namespaces(document);
    for (const id of ids) hosts.set(id, { host: located.get(id)!.host, namespaces: declarations });
  }
  const insertions = Object.values(doc.elements).flatMap((record) =>
    record.meta.origin?.part === sourcePart && record.meta.insertion ? [record.meta.insertion] : []);
  const xmlRoots: Record<string, ClipboardXmlRoot> = Object.create(null);
  const resources = new Map<string, ClipboardResource>();
  roots.forEach((id, index) => {
    const resolved = hosts.get(id)!;
    const closure = clipboardClosure(pkg, sourcePart, resolved.host, insertions);
    for (const resource of closure.resources) resources.set(resource.hash, resource);
    xmlRoots[rootIds[index]] = {
      markup: serializeXmlNode(resolved.host),
      namespaces: { ...resolved.namespaces },
      hostSpids: hostSpids(resolved.host),
      ...(closure.relationships.length ? { relationships: closure.relationships } : {}),
    };
  });
  for (const hash of assetHashes) {
    if (!resources.has(hash)) throw new Error(`元素投影资源未包含在 OOXML 闭包中：${hash}`);
  }
  return {
    format: 'web-ppt-elements',
    version: 1,
    source: { width: doc.meta.width, height: doc.meta.height, copyBatchId },
    bounds: rootBounds(doc, roots),
    roots: rootIds,
    records,
    ooxml: { roots: xmlRoots },
    resources: [...resources.values()],
  };
}
