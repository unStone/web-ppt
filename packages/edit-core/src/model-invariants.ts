import { effectiveElement } from './projection';
import type { EditDoc, ElementId, ElementRecord, SlideId } from './types';
import { assertXfrmValue, XFRM_FIELDS } from './commands/xfrm';

function assertFiniteTransform(record: ElementRecord, doc: EditDoc): void {
  const effective = effectiveElement(doc, record.id);
  for (const field of XFRM_FIELDS) {
    assertXfrmValue(field, effective[field], `元素 ${record.id} 的 ${field}`);
  }
  if (effective.kind === 'group'
    && (!Number.isFinite(effective.scaleX) || !Number.isFinite(effective.scaleY)
      || effective.scaleX === 0 || effective.scaleY === 0)) {
    throw new Error(`组 ${record.id} 的子坐标范围不能为零`);
  }
}

function assertTextBodies(record: ElementRecord): void {
  const bodies = record.src.kind === 'shape'
    ? [record.src.text]
    : record.src.kind === 'table'
      ? record.src.rows.flatMap((row) => row.cells.map((cell) => cell.text))
      : [];
  if (bodies.some((body) => body !== null && body.paragraphs.length === 0)) {
    throw new Error(`元素 ${record.id} 的文本体至少需要一个段落`);
  }
}

function assertParentChain(doc: EditDoc, id: ElementId): void {
  const seen = new Set<ElementId>();
  let current = id;
  for (;;) {
    if (seen.has(current)) throw new Error(`元素父链成环：${current}`);
    seen.add(current);
    const record = doc.elements[current];
    if (!record) throw new Error(`元素不存在：${current}`);
    if (doc.slides[record.parent]) return;
    if (!doc.elements[record.parent]) throw new Error(`元素 ${current} 的父节点不存在：${record.parent}`);
    current = record.parent;
  }
}

/** 全局模型已在 Editor 构造时验证；事务只需重验其 patch 能影响的元素不变量。 */
export function validateEditElements(doc: EditDoc, ids: Iterable<ElementId>): void {
  for (const id of new Set(ids)) {
    const record = doc.elements[id];
    if (!record) throw new Error(`元素不存在：${id}`);
    assertParentChain(doc, id);
    assertFiniteTransform(record, doc);
    assertTextBodies(record);
  }
}

function assertChildren(
  doc: EditDoc,
  parentId: SlideId | ElementId,
  children: readonly ElementId[],
  referenced: Map<ElementId, SlideId | ElementId>,
): void {
  let previousZ: string | null = null;
  for (const childId of children) {
    const child = doc.elements[childId];
    if (!child) throw new Error(`父节点 ${parentId} 引用了不存在的元素：${childId}`);
    if (referenced.has(childId)) throw new Error(`元素 ${childId} 被多个父节点引用`);
    if (child.parent !== parentId) throw new Error(`元素 ${childId} 的 parent 与父节点 children 不一致`);
    if (previousZ !== null && previousZ >= child.z) throw new Error(`父节点 ${parentId} 的 z 顺序不严格递增`);
    previousZ = child.z;
    referenced.set(childId, parentId);
  }
}

/** 在编辑会话入口验证全局结构；命令提交只需验证自己可能改变的局部不变量。 */
export function validateEditDoc(doc: EditDoc): void {
  if (!Number.isFinite(doc.meta.width) || doc.meta.width <= 0
    || !Number.isFinite(doc.meta.height) || doc.meta.height <= 0) {
    throw new Error('页面宽高必须是有限正数');
  }
  if (doc.package?.disposed) throw new Error('编辑文档持有的 OPC 包已经释放');
  if (new Set(doc.slideOrder).size !== doc.slideOrder.length) throw new Error('slideOrder 不能包含重复页');
  if (doc.slideOrder.length !== Object.keys(doc.slides).length) throw new Error('slideOrder 必须恰好包含全部幻灯片');

  const referenced = new Map<ElementId, SlideId | ElementId>();
  for (const slideId of doc.slideOrder) {
    const slide = doc.slides[slideId];
    if (!slide) throw new Error(`slideOrder 指向不存在的幻灯片：${slideId}`);
    if (slide.id !== slideId) throw new Error(`幻灯片 key 与 id 不一致：${slideId}`);
    if (doc.elements[slideId]) throw new Error(`幻灯片与元素 id 冲突：${slideId}`);
    if (slide.origin && doc.package && !doc.package.parts[slide.origin.part]) {
      throw new Error(`幻灯片 ${slideId} 的源 part 不存在：${slide.origin.part}`);
    }
    assertChildren(doc, slideId, slide.children, referenced);
  }

  for (const [id, record] of Object.entries(doc.elements)) {
    if (record.id !== id) throw new Error(`元素 key 与 id 不一致：${id}`);
    if (record.src.kind === 'group' && !record.children) throw new Error(`组 ${id} 缺少 children`);
    if (record.src.kind !== 'group' && record.children) throw new Error(`非组元素 ${id} 不能拥有 children`);
    if (record.children) assertChildren(doc, id, record.children, referenced);
  }
  for (const id of Object.keys(doc.elements)) {
    if (!referenced.has(id)) throw new Error(`存在孤儿元素：${id}`);
    assertParentChain(doc, id);
  }

  const spids = new Set<string>();
  for (const [id, record] of Object.entries(doc.elements)) {
    assertFiniteTransform(record, doc);
    assertTextBodies(record);
    if (record.meta.origin) {
      // 母版元素会按页投影成多个只读记录，但仍共享同一个 OOXML 锚点；只有可写节点必须独占锚点。
      if (record.meta.editable !== 'none') {
        const key = `${record.meta.origin.part}\0${record.meta.origin.spid}`;
        if (spids.has(key)) throw new Error(`同一 part 内 spid 重复：${record.meta.origin.part}#${record.meta.origin.spid}`);
        spids.add(key);
      }
      if (doc.package && !doc.package.parts[record.meta.origin.part]) {
        throw new Error(`元素 ${id} 的源 part 不存在：${record.meta.origin.part}`);
      }
    }
  }
}
