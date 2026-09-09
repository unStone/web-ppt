import type { SlideElement, TableRowAppendEditInfo } from '@web-ppt/core';
import { elementOrder } from './element-order';
import { tokenizeElementAssets } from './session-assets';
import { effectiveElement } from './projection';
import { orderedTableRowInsertions } from './table-rows';
import { outermostSelectedElementIds } from './selection';
import { elementFrameToSlideMatrix, elementFrameToSlidePoint } from './space';
import { insertionOwner } from './clipboard-source';
import { elementTreeSources } from './clipboard-trees';
import type {
  ClipboardElementRecord, ElementClipboardPayload,
  ElementClipboardRecordMeta,
} from './commands/types';
import type { EditDoc, ElementId, ElementMeta } from './types';
import { copiedLinkMeta } from './clipboard-links';
import { effectivePresetGeometry } from './preset-geometry';

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
  const geometry = source?.kind === 'shape' ? effectivePresetGeometry(doc, id) : meta.geom;
  return {
    copyBatchId,
    editable: meta.editable,
    anchored,
    ...(anchored ? { sourceSpid: meta.origin!.spid } : {}),
    ...(geometry ? { geom: structuredClone(geometry) } : {}),
    ...(frameToSlide ? { frameToSlide } : {}),
    ...(source ? copiedLinkMeta(doc, id, source) : {}),
  };
}

function copiedSource(doc: EditDoc, id: ElementId, assets: Set<string>, effective = effectiveElement(doc, id)): SlideElement {
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
  const requiresOriginal = portable.editInfo?.requiresOriginal;
  delete portable.editInfo;
  if (tableRowAppend || requiresOriginal) portable.editInfo = {
    ...(tableRowAppend ? { tableRowAppend } : {}), ...(requiresOriginal ? { requiresOriginal } : {}),
  };
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
  const sources = elementTreeSources(doc, roots);
  const sourcePart = doc.elements[roots[0]].meta.origin!.part;
  const records: Record<string, ClipboardElementRecord> = Object.create(null);
  const rootIds: string[] = [];
  const copyBatchId = createCopyBatchId();
  const assetHashes = new Set<string>();
  let next = 1;
  const visitProjection = (owner: ElementId, element: SlideElement, parent: string): string => {
    const id = `e${next++}`;
    const children = element.kind === 'group' ? element.children.map(child => visitProjection(owner, child, id)) : [];
    records[id] = { id, parent, children, src: copiedSource(doc, owner, assetHashes, element),
      meta: { copyBatchId, editable: 'none', anchored: false } };
    return id;
  };
  const visit = (id: ElementId, clipboardParent: string | null): string => {
    const record = doc.elements[id];
    if (!record) throw new Error(`复制树引用不存在的元素：${id}`);
    const clipboardId = `e${next++}`;
    const effective = effectiveElement(doc, id);
    // 原生框架的孩子是派生视图，数据编辑后数量和几何都可能改变；旧记录树不是当前画面。
    const children = record.meta.editable === 'frame' && effective.kind === 'group'
      ? effective.children.map(child => visitProjection(id, child, clipboardId))
      : (record.children ?? []).map((child) => visit(child, clipboardId));
    const source = copiedSource(doc, id, assetHashes, effective);
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
  const resources = new Set(sources.resources.map((resource) => resource.hash));
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
    ooxml: { roots: Object.fromEntries(roots.map((id, index) => [rootIds[index], sources.ooxml.roots[id]])) },
    resources: sources.resources,
  };
}
