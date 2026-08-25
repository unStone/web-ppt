import { effectiveElement, slideOfElement } from './projection';
import { elementOrder } from './element-order';
import { assertFractionalIndex, initialFractionalIndex } from './fractional-index';
import { assertDataObject } from './data-validation';
import { validateEmptyTextOverride, validateFlatTextOverride } from './text-override-validation';
import type { EditDoc, ElementId, ElementRecord, SlideId, TextOverride } from './types';
import { tableCellKeyResolver } from './table-cell';
import { assertXfrmValue, XFRM_FIELDS } from './commands/xfrm';
import { textTargetContext } from './commands/text-target';
import { tableRowsWithoutTextOverrides } from './table-rows';
import { assertTableRowAppendEditInfo } from './table-row-append-validation';
import { hasDynamicSlideLink, hasDynamicSlideNumber } from './dynamic-slide-fields';
import { detachedSlideBaselineParts } from './save/remove-slide-parts';
import { assertVectorFill } from './shape-fill';
import { assertStroke } from './shape-stroke';
import { assertEffects } from './shape-effects';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

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

function assertElementOrder(record: ElementRecord): void {
  assertFractionalIndex(record.z);
  if (own(record, 'order')) assertFractionalIndex(record.order!);
}

function assertTextBodies(record: ElementRecord): void {
  const bodies = record.src.kind === 'shape'
    ? [record.src.text]
    : record.src.kind === 'table'
      ? tableRowsWithoutTextOverrides(record)
        .flatMap((row) => row.cells.map((cell) => cell.text ?? cell.editInfo?.textTemplate ?? null))
      : [];
  if (bodies.some((body) => body !== null && body.paragraphs.length === 0)) {
    throw new Error(`元素 ${record.id} 的文本体至少需要一个段落`);
  }
}

function assertTableRows(record: ElementRecord): void {
  const rows = record.ovr.tableRows;
  if (rows === undefined) return;
  if (record.src.kind !== 'table' || !record.src.rows.length) {
    throw new Error(`非表格元素 ${record.id} 不能包含追加行`);
  }
  assertDataObject(rows, Object.keys(rows), `表格 ${record.id} 的追加行`);
  const entries = Object.entries(rows);
  if (!entries.length) throw new Error(`表格 ${record.id} 的追加行不能为空`);
  const orders = new Set<string>();
  const sourceLast = initialFractionalIndex(record.src.rows.length - 1);
  for (const [id, insertion] of entries) {
    if (!id) throw new Error(`表格 ${record.id} 的追加行身份不能为空`);
    assertDataObject(insertion, ['order'], `表格 ${record.id} 的追加行 ${id}`);
    if (typeof insertion.order !== 'string') throw new Error(`表格 ${record.id} 的追加行顺序无效`);
    assertFractionalIndex(insertion.order);
    if (insertion.order <= sourceLast) throw new Error(`表格 ${record.id} 的追加行不在来源行之后`);
    if (orders.has(insertion.order)) throw new Error(`表格 ${record.id} 的追加行顺序重复`);
    orders.add(insertion.order);
  }
}

function assertTextOverride(value: unknown, label: string): asserts value is TextOverride {
  if (!value || typeof value !== 'object') throw new Error(`${label} 无效`);
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'empty') {
    validateEmptyTextOverride(value as Extract<TextOverride, { kind: 'empty' }>);
    return;
  }
  if (kind !== 'flat') throw new Error(`${label} 类型无效`);
  assertDataObject(value, ['kind', 'body', 'bodyOverrides', 'paragraphs'], label);
  validateFlatTextOverride(value as Extract<TextOverride, { kind: 'flat' }>);
}

/** 稀疏文字覆盖是公开模型入口；不能只依赖命令曾经正确地产生过它。 */
function assertTextOverrides(doc: EditDoc, record: ElementRecord): void {
  if (record.ovr.text !== undefined) {
    textTargetContext(doc, { id: record.id });
    assertTextOverride(record.ovr.text, `元素 ${record.id} 的文字覆盖`);
  }
  const cells = record.ovr.tableCells;
  if (cells === undefined) return;
  if (record.src.kind !== 'table') throw new Error(`非表格元素 ${record.id} 不能包含单元格覆盖`);
  assertDataObject(cells, Object.keys(cells), `表格 ${record.id} 的单元格覆盖`);
  const entries = Object.entries(cells);
  if (!entries.length) throw new Error(`表格 ${record.id} 的单元格覆盖不能为空`);
  const resolveCell = tableCellKeyResolver(record);
  for (const [key, value] of entries) {
    const cell = resolveCell(key);
    if (!cell) throw new Error(`表格 ${record.id} 的单元格覆盖坐标无效：${key}`);
    textTargetContext(doc, { id: record.id, cell });
    assertDataObject(value, ['text'], `表格 ${record.id} 的单元格覆盖 ${key}`);
    if (!own(value, 'text') || value.text === undefined) {
      throw new Error(`表格 ${record.id} 的单元格覆盖 ${key} 不能为空`);
    }
    assertTextOverride(value.text, `表格 ${record.id} 的单元格文字覆盖 ${key}`);
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
    if (record.src.kind === 'table') assertTableRowAppendEditInfo(record.src, `表格 ${record.id}`);
    assertTableRows(record);
    assertTextOverrides(doc, record);
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
    const order = elementOrder(child);
    if (previousZ !== null && previousZ >= order) throw new Error(`父节点 ${parentId} 的 z 顺序不严格递增`);
    previousZ = order;
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
  if (!doc.identity.nextSpid || typeof doc.identity.nextSpid !== 'object'
    || Object.entries(doc.identity.nextSpid).some(([part, value]) =>
      !part || !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error('编辑文档缺少有效的 part spid 分配状态');
  }
  if (!doc.saveState || !doc.saveState.baselines || typeof doc.saveState.baselines !== 'object'
    || !Array.isArray(doc.saveState.createdParts) || !Array.isArray(doc.saveState.sourceSlideParts)) {
    throw new Error('编辑文档缺少可序列化的保存基线状态');
  }
  const detachedBaselines = detachedSlideBaselineParts(doc);
  for (const [part, bytes] of Object.entries(doc.saveState.baselines)) {
    // 删除整页后基线是撤销时复原已移除 OPC part 的唯一来源，因此不要求当前包仍含该 part。
    if (!(bytes instanceof Uint8Array)
      || (doc.package && !doc.package.parts[part] && !detachedBaselines.has(part))) {
      throw new Error(`保存基线无效：${part}`);
    }
  }
  if (new Set(doc.saveState.createdParts).size !== doc.saveState.createdParts.length
    || doc.saveState.createdParts.some((part) => typeof part !== 'string' || !part)) {
    throw new Error('会话生成的 OPC part 状态无效');
  }
  if (new Set(doc.saveState.sourceSlideParts).size !== doc.saveState.sourceSlideParts.length
    || doc.saveState.sourceSlideParts.some((part) => typeof part !== 'string' || !part)) {
    throw new Error('来源页面 part 顺序无效');
  }
  if (new Set(doc.slideOrder).size !== doc.slideOrder.length) throw new Error('slideOrder 不能包含重复页');
  if (doc.slideOrder.length !== Object.keys(doc.slides).length) throw new Error('slideOrder 必须恰好包含全部幻灯片');
  if (!doc.layouts || !Array.isArray(doc.layoutOrder)
    || new Set(doc.layoutOrder).size !== doc.layoutOrder.length
    || doc.layoutOrder.length !== Object.keys(doc.layouts).length
    || doc.layoutOrder.some((id) => doc.layouts[id]?.id !== id)) {
    throw new Error('版式目录与 layoutOrder 不一致');
  }

  const createdParts = new Set(Object.values(doc.slides)
    .flatMap((slide) => slide.creation && slide.origin ? [slide.origin.part] : []));
  const creationSlideIds = new Set<number>();
  const creationRelationshipIds = new Set<string>();
  const creationNotesParts = new Set<string>();

  const referenced = new Map<ElementId, SlideId | ElementId>();
  for (const slideId of doc.slideOrder) {
    const slide = doc.slides[slideId];
    if (!slide) throw new Error(`slideOrder 指向不存在的幻灯片：${slideId}`);
    if (slide.id !== slideId) throw new Error(`幻灯片 key 与 id 不一致：${slideId}`);
    if (doc.elements[slideId]) throw new Error(`幻灯片与元素 id 冲突：${slideId}`);
    if (slide.origin && doc.package && !doc.package.parts[slide.origin.part] && !slide.creation
      && !doc.saveState.baselines[slide.origin.part]) {
      throw new Error(`幻灯片 ${slideId} 的源 part 不存在：${slide.origin.part}`);
    }
    if (slide.creation) {
      const creation = slide.creation;
      const notesFields = [creation.duplicateNotesSourcePart, creation.duplicateNotesPart];
      const removedSpids = creation.duplicateRemovedSpids ?? [];
      if (!slide.origin || slide.creation.layoutPart !== slide.layoutId
        || !/^ppt\/slides\/slide\d+\.xml$/.test(slide.origin.part)
        || !doc.layouts[slide.creation.layoutPart]
        || typeof slide.creation.layoutRelationshipId !== 'string'
        || !slide.creation.layoutRelationshipId
        || !Number.isSafeInteger(slide.creation.presentationSlideId)
        || slide.creation.presentationSlideId < 256
        || !/^rId\d+$/.test(slide.creation.presentationRelationshipId)
        || (creation.duplicateSourcePart !== undefined
          && (typeof creation.duplicateSourcePart !== 'string'
            || !creation.duplicateSourcePart
            || creation.duplicateSourcePart === slide.origin.part
            || (!doc.package?.parts[creation.duplicateSourcePart]
              && !doc.saveState.baselines[creation.duplicateSourcePart])))
        || (notesFields.filter((value) => value !== undefined).length !== 0
          && (typeof creation.duplicateNotesSourcePart !== 'string'
            || !creation.duplicateNotesSourcePart
            || typeof creation.duplicateNotesPart !== 'string'
            || !/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(creation.duplicateNotesPart)
            || !creation.duplicateSourcePart
            || creation.duplicateNotesSourcePart === creation.duplicateNotesPart
            || (!doc.package?.parts[creation.duplicateNotesSourcePart!]
              && !doc.saveState.baselines[creation.duplicateNotesSourcePart!])))
        || !Array.isArray(removedSpids)
        || new Set(removedSpids).size !== removedSpids.length
        || removedSpids.some((spid) => !Number.isSafeInteger(spid) || spid <= 0)
        || (removedSpids.length > 0 && !creation.duplicateSourcePart)) {
        throw new Error(`新增幻灯片 ${slideId} 的 OPC 身份无效`);
      }
      if (creationSlideIds.has(slide.creation.presentationSlideId)
        || creationRelationshipIds.has(slide.creation.presentationRelationshipId)) {
        throw new Error(`新增幻灯片 ${slideId} 的 OPC 身份重复`);
      }
      creationSlideIds.add(slide.creation.presentationSlideId);
      creationRelationshipIds.add(slide.creation.presentationRelationshipId);
      if (creation.duplicateNotesPart) {
        if (creationNotesParts.has(creation.duplicateNotesPart)) {
          throw new Error(`新增幻灯片 ${slideId} 的 notes OPC 身份重复`);
        }
        creationNotesParts.add(creation.duplicateNotesPart);
      }
    }
    assertChildren(doc, slideId, slide.children, referenced);
  }

  for (const [id, record] of Object.entries(doc.elements)) {
    if (record.id !== id) throw new Error(`元素 key 与 id 不一致：${id}`);
    assertElementOrder(record);
    if (record.src.kind === 'group' && !record.children) throw new Error(`组 ${id} 缺少 children`);
    if (record.src.kind !== 'group' && record.children) throw new Error(`非组元素 ${id} 不能拥有 children`);
    if (record.children) assertChildren(doc, id, record.children, referenced);
  }
  for (const id of Object.keys(doc.elements)) {
    if (!referenced.has(id)) throw new Error(`存在孤儿元素：${id}`);
    assertParentChain(doc, id);
  }
  const indexedSlideNumbers = new Set<ElementId>();
  const indexedSlideLinks = new Set<ElementId>();
  for (const slideId of doc.slideOrder) {
    const ids = doc.slides[slideId].dynamicSlideNumbers;
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) {
      throw new Error(`幻灯片 ${slideId} 的动态页码索引无效`);
    }
    for (const id of ids) {
      const record = doc.elements[id];
      if (!record || !hasDynamicSlideNumber(record.src) || slideOfElement(doc, id) !== slideId) {
        throw new Error(`幻灯片 ${slideId} 的动态页码索引指向无效元素：${id}`);
      }
      indexedSlideNumbers.add(id);
    }
    const links = doc.slides[slideId].dynamicSlideLinks;
    if (!Array.isArray(links) || new Set(links).size !== links.length) {
      throw new Error(`幻灯片 ${slideId} 的动态跳转索引无效`);
    }
    for (const id of links) {
      const record = doc.elements[id];
      if (!record || !hasDynamicSlideLink(record.src) || slideOfElement(doc, id) !== slideId) {
        throw new Error(`幻灯片 ${slideId} 的动态跳转索引指向无效元素：${id}`);
      }
      indexedSlideLinks.add(id);
    }
  }
  for (const record of Object.values(doc.elements)) {
    if (hasDynamicSlideNumber(record.src) && !indexedSlideNumbers.has(record.id)) {
      throw new Error(`动态页码元素未进入所属页索引：${record.id}`);
    }
    if (hasDynamicSlideLink(record.src) && !indexedSlideLinks.has(record.id)) {
      throw new Error(`动态跳转元素未进入所属页索引：${record.id}`);
    }
  }

  for (const [id, record] of Object.entries(doc.removedElements)) {
    if (record.id !== id || doc.elements[id]) throw new Error(`已删除元素状态冲突：${id}`);
    if (record.meta.editable === 'none') throw new Error(`不可编辑元素不能进入删除集：${id}`);
    if (record.meta.origin && doc.package && !doc.package.parts[record.meta.origin.part]
      && !doc.saveState.baselines[record.meta.origin.part]) {
      throw new Error(`已删除元素 ${id} 的源 part 不存在：${record.meta.origin.part}`);
    }
  }

  const spids = new Set<string>();
  for (const [id, record] of Object.entries(doc.elements)) {
    if (record.src.kind === 'table') assertTableRowAppendEditInfo(record.src, `表格 ${record.id}`);
    assertTableRows(record);
    assertTextOverrides(doc, record);
    assertFiniteTransform(record, doc);
    assertTextBodies(record);
    if (own(record.ovr, 'fill')) {
      if (record.src.kind !== 'shape' || record.meta.editable !== 'full') {
        throw new Error(`元素 ${id} 不能包含填充覆盖`);
      }
      assertVectorFill(record.ovr.fill, `元素 ${id} 的填充覆盖`);
    }
    if (own(record.ovr, 'stroke')) {
      if ((record.src.kind !== 'shape' && record.src.kind !== 'image')
        || record.meta.editable !== 'full') {
        throw new Error(`元素 ${id} 不能包含描边覆盖`);
      }
      if (record.ovr.stroke !== null) assertStroke(record.ovr.stroke, `元素 ${id} 的描边覆盖`);
    }
    if (own(record.ovr, 'effects')) {
      if (!['shape', 'image', 'group'].includes(record.src.kind)
        || record.meta.editable !== 'full') {
        throw new Error(`元素 ${id} 不支持二维效果覆盖`);
      }
      assertEffects(record.ovr.effects, `元素 ${id} 的二维效果覆盖`);
    }
    if (record.meta.origin) {
      // 母版元素会按页投影成多个只读记录，但仍共享同一个 OOXML 锚点；只有可写节点必须独占锚点。
      if (record.meta.editable !== 'none') {
        const key = `${record.meta.origin.part}\0${record.meta.origin.spid}`;
        if (spids.has(key)) throw new Error(`同一 part 内 spid 重复：${record.meta.origin.part}#${record.meta.origin.spid}`);
        spids.add(key);
      }
      if (doc.package && !doc.package.parts[record.meta.origin.part]
        && !doc.saveState.baselines[record.meta.origin.part]
        && !createdParts.has(record.meta.origin.part)) {
        throw new Error(`元素 ${id} 的源 part 不存在：${record.meta.origin.part}`);
      }
    }
  }
}
