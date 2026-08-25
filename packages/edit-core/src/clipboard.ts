import type { SlideElement, TableRowAppendEditInfo } from '@web-ppt/core';
import { elementOrder } from './element-order';
import { tokenizeElementAssets } from './session-assets';
import { effectiveElement } from './projection';
import { orderedTableRowInsertions } from './table-rows';
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
import { copiedLinkMeta } from './clipboard-links';

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
  doc: EditDoc,
  id: ElementId,
  meta: ElementMeta,
  copyBatchId: string,
  sourcePart: string,
  frameToSlide?: ReturnType<typeof elementFrameToSlideMatrix>,
  source?: SlideElement,
): ElementClipboardRecordMeta {
  const anchored = meta.origin?.part === sourcePart;
  return {
    copyBatchId,
    editable: meta.editable,
    anchored,
    ...(anchored ? { sourceSpid: meta.origin!.spid } : {}),
    ...(meta.geom ? { geom: structuredClone(meta.geom) } : {}),
    ...(frameToSlide ? { frameToSlide } : {}),
    ...(source ? copiedLinkMeta(doc, id, source) : {}),
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
    doc, source, assets, [
      ...(insertionOwner(doc, id)?.meta.insertion?.resources ?? []),
      ...(doc.elements[id].meta.imageReplacement
        ? [doc.imageResources[doc.elements[id].meta.imageReplacement!.resourceHash]!] : []),
    ],
  );
  let tableRowAppend: TableRowAppendEditInfo | undefined;
  if (portable.kind === 'table' && portable.editInfo?.tableRowAppend) {
    const sourceAppend = portable.editInfo.tableRowAppend;
    const appended = orderedTableRowInsertions(doc.elements[id]).length;
    const parity = appended % 2;
    // src 已包含有效追加行；模板起点也必须前移同样次数，否则再次追加会重复上一条纹。
    tableRowAppend = {
      ...(portable.rows.length === 1 && sourceAppend.previousLast
        ? { previousLast: sourceAppend.previousLast } : {}),
      regular: [sourceAppend.regular[parity], sourceAppend.regular[1 - parity]],
      last: [sourceAppend.last[parity], sourceAppend.last[1 - parity]],
    };
  }
  // 来源锚点等解析期身份不能跨文档传播；表格追加模板则是后续结构编辑的必要语义。
  delete portable.editInfo;
  if (tableRowAppend) portable.editInfo = { tableRowAppend };
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
    const source = copiedSource(doc, id, assetHashes);
    records[clipboardId] = {
      id: clipboardId,
      parent: clipboardParent,
      src: source,
      meta: copiedMeta(
        doc, id, record.meta, copyBatchId, sourcePart,
        clipboardParent === null ? elementFrameToSlideMatrix(doc, id) : undefined,
        source,
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
  const insertions = Object.values(doc.elements).flatMap((record) => {
    if (record.meta.origin?.part !== sourcePart) return [];
    return [
      ...(record.meta.insertion ? [record.meta.insertion] : []),
      ...(record.meta.imageReplacement ? [{
        relationships: record.meta.imageReplacement.relationships,
        resources: [doc.imageResources[record.meta.imageReplacement.resourceHash]!],
      }] : []),
    ];
  });
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
