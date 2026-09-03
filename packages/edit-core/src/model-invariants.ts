import { effectiveElement, slideOfElement } from './projection';
import { canvasTargetOfElement } from './design-target';
import { slideDesignChanged } from './layout-projection';
import { elementOrder } from './element-order';
import { assertFractionalIndex } from './fractional-index';
import { assertDataObject } from './data-validation';
import { validateEmptyTextOverride, validateFlatTextOverride } from './text-override-validation';
import type { EditDoc, ElementId, ElementRecord, SlideId, TextOverride } from './types';
import { assertXfrmValue, XFRM_FIELDS } from './commands/xfrm';
import { textTargetContext } from './commands/text-target';
import { tableRowsWithoutTextOverrides } from './table-rows';
import { assertTableRowAppendEditInfo } from './table-row-append-validation';
import { hasDynamicSlideLink, hasDynamicSlideNumber } from './dynamic-slide-fields';
import { detachedSlideBaselineParts } from './save/remove-slide-parts';
import { assertSectionState } from './commands/sections';
import { assertVectorFill } from './shape-fill';
import { assertStroke } from './shape-stroke';
import { assertEffects } from './shape-effects';
import { assertImageCrop, isEditablePicture } from './image-content';
import {
  assertImageReplacement, assertImageResource, assertImageResourceTargets,
} from './commands/element-image-content';
import {
  assertSlideImageBackground, assertSlideImageBackgroundDimensions, assertSlideImageFill,
} from './commands/slide-property';
import { assertLinkOverride, supportsElementLink } from './hyperlink';
import { assertActiveRelationshipTargets, assertElementInsertionSource } from './insertion-invariants';
import { isNotesPart } from './notes-part';
import { assertElementName } from './element-name';
import { assertAltTextField } from './alt-text';
import { assertStoredSlideTransition } from './slide-transition';
import { assertStoredSlideAnimations } from './slide-animation';
import { assertCustomGeometryOverride } from './custom-geometry';
import { assertPresetGeometry } from './preset-geometry';
import { assertTableStyleSettings } from './table-style';
import { assertSlideSize } from './slide-size';
import {
  assertTableCellOverrides, assertTableGridOverrides, assertTableRows,
} from './table-invariants';
import { THEME_COLOR_SLOTS } from '@web-ppt/core';
import { assertThemeColor, assertThemeFont, assertThemeOverrides } from './theme';
import { assertParagraphPropertyOverrides } from './paragraph-property-schema';
import { assertRunPropertyOverrides } from './run-property-schema';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

function assertFiniteTransform(record: ElementRecord, doc: EditDoc): void {
  const target = canvasTargetOfElement(doc, record.id);
  const source = target.kind === 'slide' && slideDesignChanged(doc, target.id)
    ? effectiveElement(doc, record.id) : record.src;
  for (const field of XFRM_FIELDS) {
    const value = own(record.ovr, field) ? record.ovr[field] : source[field];
    assertXfrmValue(field, value, `元素 ${record.id} 的 ${field}`);
  }
  if (source.kind === 'group'
    && (!Number.isFinite(source.scaleX) || !Number.isFinite(source.scaleY)
      || source.scaleX === 0 || source.scaleY === 0)) {
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

function assertTextOverride(
  doc: EditDoc,
  record: ElementRecord,
  value: unknown,
  label: string,
): asserts value is TextOverride {
  if (!value || typeof value !== 'object') throw new Error(`${label} 无效`);
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'empty') {
    validateEmptyTextOverride(value as Extract<TextOverride, { kind: 'empty' }>);
    return;
  }
  if (kind !== 'flat') throw new Error(`${label} 类型无效`);
  assertDataObject(value, ['kind', 'body', 'bodyOverrides', 'paragraphs'], label);
  validateFlatTextOverride(value as Extract<TextOverride, { kind: 'flat' }>, {
    doc, part: record.meta.origin?.part, resources: doc.imageResources,
  });
}

/** 稀疏文字覆盖是公开模型入口；不能只依赖命令曾经正确地产生过它。 */
function assertTextOverrides(doc: EditDoc, record: ElementRecord): void {
  if (record.ovr.text !== undefined) {
    textTargetContext(doc, { id: record.id });
    assertTextOverride(doc, record, record.ovr.text, `元素 ${record.id} 的文字覆盖`);
  }
  assertTableCellOverrides(
    doc, record, (value, label) => assertTextOverride(doc, record, value, label),
  );
}

function assertParentChain(doc: EditDoc, id: ElementId): void {
  const seen = new Set<ElementId>();
  let current = id;
  for (;;) {
    if (seen.has(current)) throw new Error(`元素父链成环：${current}`);
    seen.add(current);
    const record = doc.elements[current];
    if (!record) throw new Error(`元素不存在：${current}`);
    if (doc.slides[record.parent] || doc.layouts[record.parent] || doc.masters[record.parent]) return;
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
    assertTableGridOverrides(record);
    assertTextOverrides(doc, record);
    if (own(record.ovr, 'link')) assertLinkOverride(record.ovr.link, `元素 ${record.id} 的链接覆盖`);
    if (own(record.ovr, 'name')) assertElementName(record.ovr.name, `元素 ${record.id} 的名称覆盖`);
    if (own(record.ovr, 'altText')) {
      assertDataObject(record.ovr.altText, ['title', 'descr'], `元素 ${record.id} 的替代文字覆盖`);
      if (own(record.ovr.altText!, 'title')) {
        assertAltTextField(record.ovr.altText!.title, `元素 ${record.id} 的替代文字标题`);
      }
      if (own(record.ovr.altText!, 'descr')) {
        assertAltTextField(record.ovr.altText!.descr, `元素 ${record.id} 的替代文字描述`);
      }
      if (!Reflect.ownKeys(record.ovr.altText!).length) {
        throw new Error(`元素 ${record.id} 不能保留空替代文字覆盖`);
      }
    }
    if (own(record.ovr, 'tableStyle')) {
      assertTableStyleSettings(doc, record.id, record.ovr.tableStyle, `表格 ${record.id} 的样式覆盖`);
    }
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
  assertSlideSize(doc.meta.width, '页面宽度');
  assertSlideSize(doc.meta.height, '页面高度');
  assertSlideSize(doc.meta.sourceWidth, '来源页面宽度');
  assertSlideSize(doc.meta.sourceHeight, '来源页面高度');
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
  if (!doc.imageResources || typeof doc.imageResources !== 'object') {
    throw new Error('编辑文档缺少图片资源表');
  }
  for (const [hash, resource] of Object.entries(doc.imageResources)) {
    assertImageResource(resource, `图片资源 ${hash}`, doc);
    if (resource.hash !== hash) throw new Error(`图片资源 key 与哈希不一致：${hash}`);
  }
  assertImageResourceTargets(doc, doc.imageResources);
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
  assertSectionState(doc, doc.sections, '编辑文档节状态');
  if (!doc.layouts || !Array.isArray(doc.layoutOrder)
    || new Set(doc.layoutOrder).size !== doc.layoutOrder.length
    || doc.layoutOrder.length !== Object.keys(doc.layouts).length
    || doc.layoutOrder.some((id) => doc.layouts[id]?.id !== id)) {
    throw new Error('版式目录与 layoutOrder 不一致');
  }
  const layoutIds = new Set(doc.layoutOrder);
  if (!doc.masters || !Array.isArray(doc.masterOrder)
    || new Set(doc.masterOrder).size !== doc.masterOrder.length
    || doc.masterOrder.length !== Object.keys(doc.masters).length
    || doc.masterOrder.some((id) => doc.masters[id]?.id !== id)) {
    throw new Error('母版目录与 masterOrder 不一致');
  }
  const masterIds = new Set(doc.masterOrder);
  if (!doc.themes || !Array.isArray(doc.themeOrder)
    || new Set(doc.themeOrder).size !== doc.themeOrder.length
    || doc.themeOrder.length !== Object.keys(doc.themes).length
    || doc.themeOrder.some((id) => doc.themes[id]?.id !== id)) {
    throw new Error('主题目录与 themeOrder 不一致');
  }
  const themeIds = new Set(doc.themeOrder);
  for (const id of doc.themeOrder) {
    const theme = doc.themes[id];
    if (!theme.name || typeof theme.name !== 'string') throw new Error(`主题名称无效：${id}`);
    assertDataObject(theme.src, ['colors', 'fonts'], `主题 ${id} 的来源`);
    assertDataObject(theme.src.colors, THEME_COLOR_SLOTS, `主题 ${id} 的来源颜色`);
    for (const slot of THEME_COLOR_SLOTS) {
      assertThemeColor(theme.src.colors[slot], `主题 ${id} 的来源颜色 ${slot}`);
    }
    assertDataObject(theme.src.fonts, ['major', 'minor'], `主题 ${id} 的来源字体`);
    for (const role of ['major', 'minor'] as const) {
      const font = theme.src.fonts[role];
      assertDataObject(font, ['latin', 'ea', 'cs', 'scripts'], `主题 ${id} 的来源字体 ${role}`);
      for (const field of ['latin', 'ea', 'cs'] as const) {
        assertThemeFont(font[field], `主题 ${id} 的来源字体 ${role}.${field}`);
      }
      assertDataObject(font.scripts, Object.keys(font.scripts), `主题 ${id} 的来源脚本 ${role}`);
      for (const [script, typeface] of Object.entries(font.scripts)) {
        if (!/^[A-Za-z]{4}$/.test(script)) throw new Error(`主题 ${id} 的脚本代码无效：${script}`);
        assertThemeFont(typeface, `主题 ${id} 的来源脚本 ${role}.${script}`);
      }
    }
    assertThemeOverrides(theme.ovr, `主题 ${id} 的覆盖`);
  }
  for (const layout of Object.values(doc.layouts)) {
    if (!masterIds.has(layout.origin.masterPart)) {
      throw new Error(`版式 ${layout.id} 指向不存在的母版：${layout.origin.masterPart}`);
    }
    if (layout.themeId !== undefined && !themeIds.has(layout.themeId)) {
      throw new Error(`版式 ${layout.id} 指向不存在的主题：${layout.themeId}`);
    }
    if (doc.elements[layout.id] || doc.slides[layout.id]) {
      throw new Error(`版式与页面或元素 id 冲突：${layout.id}`);
    }
    if (own(layout.ovr, 'background')) {
      assertVectorFill(layout.ovr.background, `版式 ${layout.id} 的背景覆盖`);
    }
    if (own(layout.ovr, 'transition')) {
      assertStoredSlideTransition(layout.ovr.transition, `版式 ${layout.id} 的切换覆盖`);
    }
  }
  for (const master of Object.values(doc.masters)) {
    if (master.themeId !== undefined && !themeIds.has(master.themeId)) {
      throw new Error(`母版 ${master.id} 指向不存在的主题：${master.themeId}`);
    }
    if (doc.elements[master.id] || doc.slides[master.id] || doc.layouts[master.id]) {
      throw new Error(`母版与页面、版式或元素 id 冲突：${master.id}`);
    }
    if (master.layoutIds.some((id) => !layoutIds.has(id)
      || doc.layouts[id].origin.masterPart !== master.id)) {
      throw new Error(`母版 ${master.id} 的直属版式集合无效`);
    }
    if (own(master.ovr, 'background')) {
      assertVectorFill(master.ovr.background, `母版 ${master.id} 的背景覆盖`);
    }
    assertDataObject(master.ovr, ['background', 'textStyles'], `母版 ${master.id} 的覆盖`);
    if (master.ovr.textStyles) {
      assertDataObject(master.ovr.textStyles, ['title', 'body', 'other'], `母版 ${master.id} 的文字覆盖`);
      for (const [category, levels] of Object.entries(master.ovr.textStyles)) {
        assertDataObject(levels, Object.keys(levels), `母版 ${master.id} 的 ${category} 文字层级`);
        for (const [level, value] of Object.entries(levels)) {
          if (!/^[0-8]$/.test(level)) throw new Error(`母版 ${master.id} 的文字层级无效：${level}`);
          assertDataObject(value, ['paragraph', 'run'], `母版 ${master.id} 的 ${category} 第 ${level} 级覆盖`);
          if (value.paragraph) {
            if (own(value.paragraph, 'level')) throw new Error(`母版 ${master.id} 不能覆盖文字层级身份`);
            assertParagraphPropertyOverrides(value.paragraph, `母版 ${master.id} 的段落覆盖`);
            if (value.paragraph.bullet?.kind === 'blip') throw new Error(`母版 ${master.id} 不支持图片项目符号覆盖`);
          }
          if (value.run) {
            if (own(value.run, 'link')) throw new Error(`母版 ${master.id} 不能覆盖文字超链接`);
            assertRunPropertyOverrides(value.run, `母版 ${master.id} 的字符覆盖`);
          }
        }
      }
    }
    for (const category of ['title', 'body', 'other'] as const) {
      if (master.textStyles[category].paragraphs.length !== 9) {
        throw new Error(`母版 ${master.id} 的 ${category} 文字来源必须包含九级`);
      }
    }
  }

  const createdParts = new Set(Object.values(doc.slides)
    .flatMap((slide) => slide.creation && slide.origin ? [slide.origin.part] : []));
  const creationSlideIds = new Set<number>();
  const creationRelationshipIds = new Set<string>();
  const creationNotesParts = new Set<string>();
  const sessionNotesParts = new Set<string>();

  const referenced = new Map<ElementId, SlideId | ElementId>();
  for (const masterId of doc.masterOrder) {
    assertChildren(doc, masterId, doc.masters[masterId].children, referenced);
  }
  for (const layoutId of doc.layoutOrder) {
    assertChildren(doc, layoutId, doc.layouts[layoutId].children, referenced);
  }
  for (const slideId of doc.slideOrder) {
    const slide = doc.slides[slideId];
    if (!slide) throw new Error(`slideOrder 指向不存在的幻灯片：${slideId}`);
    if (slide.id !== slideId) throw new Error(`幻灯片 key 与 id 不一致：${slideId}`);
    if (doc.elements[slideId]) throw new Error(`幻灯片与元素 id 冲突：${slideId}`);
    if (slide.layoutId !== undefined && !layoutIds.has(slide.layoutId)) {
      throw new Error(`幻灯片 ${slideId} 的当前版式不存在：${slide.layoutId}`);
    }
    if (slide.sourceLayoutId !== undefined && !layoutIds.has(slide.sourceLayoutId)) {
      throw new Error(`幻灯片 ${slideId} 的来源版式不存在：${slide.sourceLayoutId}`);
    }
    if (own(slide.ovr, 'background')) {
      if (slide.ovr.background === null) throw new Error(`幻灯片 ${slideId} 的直接背景不能是 null`);
      if (slide.ovr.background?.type === 'image') {
        assertSlideImageFill(slide.ovr.background, `幻灯片 ${slideId} 的背景覆盖`);
      } else assertVectorFill(slide.ovr.background, `幻灯片 ${slideId} 的背景覆盖`);
    }
    if (slide.backgroundImage) {
      if (!slide.origin || slide.ovr.background?.type !== 'image'
        || slide.ovr.background.src !== slide.backgroundImage.src) {
        throw new Error(`幻灯片 ${slideId} 的图片背景与资源闭包不一致`);
      }
      assertSlideImageBackground(
        slide.backgroundImage, slide, doc.imageResources,
        `幻灯片 ${slideId} 的图片背景资源`, doc,
      );
      assertSlideImageBackgroundDimensions(
        doc, slide, slide.ovr.background, slide.backgroundImage, doc.imageResources,
        `幻灯片 ${slideId} 的图片背景资源`,
      );
    } else if (slide.ovr.background?.type === 'image') {
      throw new Error(`幻灯片 ${slideId} 的图片背景缺少资源闭包`);
    }
    if (own(slide.ovr, 'hidden') && typeof slide.ovr.hidden !== 'boolean') {
      throw new Error(`幻灯片 ${slideId} 的隐藏覆盖必须是布尔值`);
    }
    if (own(slide.ovr, 'transition')) {
      assertStoredSlideTransition(slide.ovr.transition, `幻灯片 ${slideId} 的切换覆盖`);
    }
    if (own(slide.ovr, 'animations')) {
      assertStoredSlideAnimations(doc, slideId, slide.ovr.animations, `幻灯片 ${slideId} 的动画覆盖`);
    }
    if (own(slide.ovr, 'notes') && typeof slide.ovr.notes !== 'string') {
      throw new Error(`幻灯片 ${slideId} 的备注覆盖必须是字符串`);
    }
    if (own(slide.ovr, 'notes') && !slide.notes) {
      throw new Error(`幻灯片 ${slideId} 的备注覆盖缺少 OPC 身份`);
    }
    if (slide.notes) {
      const binding = slide.notes;
      const packageUnavailable = doc.meta.readonly && !doc.package;
      const sourceExists = packageUnavailable || binding.sourcePart === undefined
        || !!doc.package?.parts[binding.sourcePart] || !!doc.saveState.baselines[binding.sourcePart];
      const targetExists = packageUnavailable || !!doc.package?.parts[binding.targetPart]
        || !!doc.saveState.baselines[binding.targetPart];
      if (!isNotesPart(binding.targetPart)
        || typeof binding.relationshipId !== 'string' || !binding.relationshipId
        || binding.sourcePart !== undefined && !isNotesPart(binding.sourcePart)
        || !sourceExists
        || !targetExists && binding.sourcePart === undefined && !own(slide.ovr, 'notes')) {
        throw new Error(`幻灯片 ${slideId} 的备注 OPC 身份无效`);
      }
      if (!targetExists) {
        if (sessionNotesParts.has(binding.targetPart)) {
          throw new Error(`会话新建备注 part 被多个页面共享：${binding.targetPart}`);
        }
        sessionNotesParts.add(binding.targetPart);
      }
    }
    if (slide.origin && doc.package && !doc.package.parts[slide.origin.part] && !slide.creation
      && !doc.saveState.baselines[slide.origin.part]) {
      throw new Error(`幻灯片 ${slideId} 的源 part 不存在：${slide.origin.part}`);
    }
    if (slide.creation) {
      const creation = slide.creation;
      const notesFields = [creation.duplicateNotesSourcePart, creation.duplicateNotesPart];
      const removedSpids = creation.duplicateRemovedSpids ?? [];
      const removedAnimationSpids = creation.duplicateRemovedAnimationSpids ?? removedSpids;
      if (!slide.origin || !slide.layoutId
        || !/^ppt\/slides\/slide\d+\.xml$/.test(slide.origin.part)
        || !layoutIds.has(slide.creation.layoutPart)
        || !layoutIds.has(slide.layoutId)
        || typeof slide.creation.layoutRelationshipId !== 'string'
        || !slide.creation.layoutRelationshipId
        || !Number.isSafeInteger(slide.creation.presentationSlideId)
        || slide.creation.presentationSlideId < 256
        || slide.creation.presentationSlideId > 0x7fff_ffff
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
        || !Array.isArray(removedAnimationSpids)
        || new Set(removedAnimationSpids).size !== removedAnimationSpids.length
        || removedAnimationSpids.some((spid) => !Number.isSafeInteger(spid) || spid <= 0)
        || removedSpids.some((spid) => !removedAnimationSpids.includes(spid))
        || (removedAnimationSpids.length > 0 && !creation.duplicateSourcePart)) {
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
    if (record.meta.sourceParent !== undefined) {
      const sourceParent = record.meta.sourceParent;
      if (record.meta.created || sourceParent === record.parent
        || (!doc.slides[sourceParent] && !doc.layouts[sourceParent]
          && !doc.elements[sourceParent] && !doc.removedElements[sourceParent])) {
        throw new Error(`元素 ${id} 的来源父级无效`);
      }
    }
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
    const target = canvasTargetOfElement(doc, record.id);
    if (target.kind === 'slide' && hasDynamicSlideNumber(record.src) && !indexedSlideNumbers.has(record.id)) {
      throw new Error(`动态页码元素未进入所属页索引：${record.id}`);
    }
    if (target.kind === 'slide' && hasDynamicSlideLink(record.src) && !indexedSlideLinks.has(record.id)) {
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
    if (record.sourceSpids && (!Array.isArray(record.sourceSpids)
      || record.sourceSpids.some((spid) => !Number.isInteger(spid) || spid <= 0)
      || new Set(record.sourceSpids).size !== record.sourceSpids.length)) {
      throw new Error(`已删除元素 ${id} 的动画来源 spid 无效`);
    }
  }

  const spids = new Set<string>();
  for (const [id, record] of Object.entries(doc.elements)) {
    if (record.src.kind === 'table') assertTableRowAppendEditInfo(record.src, `表格 ${record.id}`);
    assertTableRows(record);
    assertTableGridOverrides(record);
    assertTextOverrides(doc, record);
    if (own(record.ovr, 'link')) {
      if (!supportsElementLink(record.src.kind)
        || record.meta.editable !== 'full') {
        throw new Error(`元素 ${id} 不能包含链接覆盖`);
      }
      assertLinkOverride(record.ovr.link, `元素 ${id} 的链接覆盖`);
    }
    assertFiniteTransform(record, doc);
    assertTextBodies(record);
    assertElementInsertionSource(doc, record);
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
    if (own(record.ovr, 'crop')) {
      if (record.src.kind !== 'image' || !isEditablePicture(record.src)
        || record.meta.editable !== 'full') {
        throw new Error(`元素 ${id} 不支持图片裁剪覆盖`);
      }
      assertImageCrop(record.ovr.crop, `元素 ${id} 的图片裁剪覆盖`);
    }
    if (own(record.ovr, 'geometry')) {
      if (record.src.kind !== 'shape' || record.meta.editable !== 'full') {
        throw new Error(`元素 ${id} 不支持自定义几何覆盖`);
      }
      assertCustomGeometryOverride(
        record.meta.customGeometry ?? null,
        record.ovr.geometry,
        `元素 ${id} 的自定义几何覆盖`,
      );
    }
    if (own(record.ovr, 'presetGeometry')) {
      if (record.src.kind !== 'shape' || record.meta.editable !== 'full') {
        throw new Error(`元素 ${id} 不支持预设几何覆盖`);
      }
      if (own(record.ovr, 'geometry')) throw new Error(`元素 ${id} 不能同时覆盖预设与自由几何`);
      assertPresetGeometry(record.ovr.presetGeometry, `元素 ${id} 的预设几何覆盖`);
    }
    if (record.meta.imageReplacement) {
      if (record.src.kind !== 'image' || !isEditablePicture(record.src)
        || record.meta.editable !== 'full' || !record.meta.origin) {
        throw new Error(`元素 ${id} 不支持图片替换资源`);
      }
      assertImageReplacement(
        record.meta.imageReplacement, record.meta.origin.part, doc.imageResources,
        `元素 ${id} 的图片替换资源`,
      );
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
  assertActiveRelationshipTargets(doc);
}
