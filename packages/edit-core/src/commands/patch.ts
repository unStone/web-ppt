import { sortElementChildrenByOrder } from '../element-order';
import { validateEditDoc } from '../model-invariants';
import {
  invalidateElement, invalidateElementStructure, invalidateSlide, invalidateSlideSequence,
  invalidateSlideStructure, slideOfElement,
} from '../projection';
import { tableCellKeyBelongsToRow, tableCellOverrideKeyFromRowRef } from '../table-cell';
import type {
  EditDoc, ElementImageReplacement, ElementInsertionResource, ProjectionInvalidation,
  SlideImageBackground, TableRowInsertion,
} from '../types';
import { applyElementTransformPatch } from './element-transform';
import { applyElementFillPatch, isElementFillPatch, validateElementFillPatch } from './element-fill';
import { applyElementStrokePatch, isElementStrokePatch, validateElementStrokePatch } from './element-stroke';
import { applyElementEffectsPatch, isElementEffectsPatch, validateElementEffectsPatch } from './element-effects';
import { applyElementLinkPatch, isElementLinkPatch, validateElementLinkPatch } from './element-link';
import {
  applyElementCropPatch, applyElementImageReplacementPatch, applyImageResourcePatch,
  assertImageReplacement, assertImageResourceTargets,
  isElementCropPatch, isElementImageReplacementPatch, isImageResourcePatch,
  validateElementCropPatch, validateElementImageReplacementPatch, validateImageResourcePatch,
} from './element-image-content';
import {
  applyElementOrderValue, isElementOrderPatch, validateElementOrderPatch, validateElementOrderPatchSet,
} from './element-order';
import { applyElementTreePatch, isElementTreePatch, validateElementTreePatch } from './element-tree';
import { applyElementTextPatch, isElementTextPatch, validateElementTextPatch } from './element-text';
import { applyTableRowPatch, isTableRowPatch, validateTableRowPatch } from './table-row';
import { applySlideTreePatch, isSlideTreePatch, validateSlideTreePatch } from './slide-tree';
import {
  applySlideOrderPatch, isSlideOrderPatch, slideOrderPatchStart, validateSlideOrderPatch,
} from './slide-order';
import {
  applySlidePropertyPatch, isSlideBackgroundImagePatch, isSlideBackgroundPatch,
  isSlidePropertyPatch, validateSlidePropertyPatch, assertSlideImageBackground,
  assertSlideImageBackgroundDimensions,
} from './slide-property';
import type {
  ElementTransformPatch, ElementTreePatch, ImageResourcePatch, Patch, XfrmField,
} from './types';
import { assertXfrmValue, XFRM_FIELD_SET } from './xfrm';

function validatePatch(
  doc: EditDoc,
  input: Patch,
  index: number,
  stagedTableRows: ReadonlyMap<string, Record<string, TableRowInsertion>>,
  stagedImageResources: Readonly<Record<string, ElementInsertionResource>>,
): void {
  const patch = input as Partial<Patch> & { path?: unknown; value?: unknown };
  if (!['set', 'del', 'remove', 'insert', 'move'].includes(String(patch.op))) {
    throw new Error(`Patch ${index} 的 op 不受支持`);
  }
  if (typeof patch.origin !== 'string' || !patch.origin) throw new Error(`Patch ${index} 缺少 origin`);
  if (isImageResourcePatch(input)) {
    return;
  }
  if (Array.isArray(patch.path) && patch.path.length === 2
    && patch.path[0] === 'elements' && typeof patch.path[1] === 'string'
    && (patch.op === 'remove' || patch.op === 'insert')) {
    validateElementTreePatch(doc, patch as ElementTreePatch, index);
    return;
  }
  if (Array.isArray(patch.path) && patch.path.length === 2
    && patch.path[0] === 'slideOrder' && typeof patch.path[1] === 'string'
    && patch.op === 'move') {
    validateSlideOrderPatch(doc, patch as import('./types').SlideOrderPatch, index);
    return;
  }
  if (Array.isArray(patch.path) && patch.path.length === 2
    && patch.path[0] === 'slides' && typeof patch.path[1] === 'string'
    && (patch.op === 'remove' || patch.op === 'insert')) {
    validateSlideTreePatch(doc, patch as import('./types').SlideTreePatch, index);
    return;
  }
  if (isSlidePropertyPatch(input)) {
    validateSlidePropertyPatch(doc, input, index, stagedImageResources);
    return;
  }
  if (Array.isArray(patch.path) && patch.path[0] === 'elements'
    && typeof patch.path[1] === 'string' && patch.path[2] === 'ovr'
    && ((patch.path.length === 4 && patch.path[3] === 'text')
      || (patch.path.length === 7 && patch.path[3] === 'tableCells'
        && (typeof patch.path[4] === 'number' || typeof patch.path[4] === 'string')
        && typeof patch.path[5] === 'number' && patch.path[6] === 'text'))
    && (patch.op === 'set' || patch.op === 'del')) {
    validateElementTextPatch(
      doc,
      patch as import('./types').ElementTextPatch,
      index,
      stagedTableRows.get(patch.path[1]),
    );
    return;
  }
  if (Array.isArray(patch.path) && patch.path.length === 5
    && patch.path[0] === 'elements' && typeof patch.path[1] === 'string'
    && patch.path[2] === 'ovr' && patch.path[3] === 'tableRows'
    && (patch.op === 'insert' || patch.op === 'remove')) {
    validateTableRowPatch(doc, patch as import('./types').TableRowPatch, index);
    return;
  }
  if (Array.isArray(patch.path) && patch.path.length === 3
    && patch.path[0] === 'elements' && typeof patch.path[1] === 'string' && patch.path[2] === 'order'
    && (patch.op === 'set' || patch.op === 'del')) {
    validateElementOrderPatch(doc, patch as import('./types').ElementOrderPatch, index);
    return;
  }
  if (Array.isArray(patch.path) && patch.path.length === 4
    && patch.path[0] === 'elements' && typeof patch.path[1] === 'string'
    && patch.path[2] === 'ovr' && patch.path[3] === 'fill'
    && (patch.op === 'set' || patch.op === 'del')) {
    validateElementFillPatch(doc, patch as import('./types').ElementFillPatch, index);
    return;
  }
  if (Array.isArray(patch.path) && patch.path.length === 4
    && patch.path[0] === 'elements' && typeof patch.path[1] === 'string'
    && patch.path[2] === 'ovr' && patch.path[3] === 'crop'
    && (patch.op === 'set' || patch.op === 'del')) {
    validateElementCropPatch(doc, patch as import('./types').ElementCropPatch, index);
    return;
  }
  if (Array.isArray(patch.path) && patch.path.length === 4
    && patch.path[0] === 'elements' && typeof patch.path[1] === 'string'
    && patch.path[2] === 'meta' && patch.path[3] === 'imageReplacement'
    && (patch.op === 'set' || patch.op === 'del')) {
    validateElementImageReplacementPatch(
      doc, patch as import('./types').ElementImageReplacementPatch, index, stagedImageResources,
    );
    return;
  }
  if (Array.isArray(patch.path) && patch.path.length === 4
    && patch.path[0] === 'elements' && typeof patch.path[1] === 'string'
    && patch.path[2] === 'ovr' && patch.path[3] === 'effects'
    && (patch.op === 'set' || patch.op === 'del')) {
    validateElementEffectsPatch(doc, patch as import('./types').ElementEffectsPatch, index);
    return;
  }
  if (Array.isArray(patch.path) && patch.path.length === 4
    && patch.path[0] === 'elements' && typeof patch.path[1] === 'string'
    && patch.path[2] === 'ovr' && patch.path[3] === 'link'
    && (patch.op === 'set' || patch.op === 'del')) {
    validateElementLinkPatch(doc, patch as import('./types').ElementLinkPatch, index);
    return;
  }
  if (Array.isArray(patch.path) && patch.path.length === 4
    && patch.path[0] === 'elements' && typeof patch.path[1] === 'string'
    && patch.path[2] === 'ovr' && patch.path[3] === 'stroke'
    && (patch.op === 'set' || patch.op === 'del')) {
    validateElementStrokePatch(doc, patch as import('./types').ElementStrokePatch, index);
    return;
  }
  if (!Array.isArray(patch.path) || patch.path.length !== 4
    || patch.path[0] !== 'elements' || typeof patch.path[1] !== 'string'
    || patch.path[2] !== 'ovr' || !XFRM_FIELD_SET.has(patch.path[3] as XfrmField)) {
    throw new Error(`Patch ${index} 的路径不受支持`);
  }
  const id = patch.path[1];
  const field = patch.path[3] as XfrmField;
  if (!doc.elements[id]) throw new Error(`Patch 指向不存在的元素：${id}`);
  if (patch.op === 'set') {
    assertXfrmValue(field, patch.value, `Patch ${index} 的 ${field}`);
  }
}

function validatePatchRelations(doc: EditDoc, patches: readonly Patch[]): void {
  const owner = new Map<string, number>();
  const tableRows = new Map<string, number>();
  const tableOrders = new Map<string, number>();
  patches.forEach((patch, index) => {
    if (isTableRowPatch(patch)) {
      const path = JSON.stringify(patch.path);
      const previousPath = tableRows.get(path);
      if (previousPath !== undefined) {
        throw new Error(`Patch ${index} 与 Patch ${previousPath} 重复修改同一表格行`);
      }
      tableRows.set(path, index);
      if (patch.op === 'insert') {
        const order = `${patch.path[1]}\0${patch.value.order}`;
        const previousOrder = tableOrders.get(order);
        if (previousOrder !== undefined) {
          throw new Error(`Patch ${index} 与 Patch ${previousOrder} 的表格行顺序冲突`);
        }
        tableOrders.set(order, index);
      }
    }
    if (!isElementTreePatch(patch) && !isSlideTreePatch(patch)) return;
    for (const id of Object.keys(patch.value.records)) {
      const previous = owner.get(id);
      if (previous !== undefined) {
        throw new Error(`Patch ${index} 与 Patch ${previous} 的元素树重叠：${id}`);
      }
      owner.set(id, index);
    }
  });
  const rowCellState = new Map<string, Set<string>>();
  const cellsFor = (elementId: string, rowId: string): Set<string> => {
    const stateKey = `${elementId}\0${rowId}`;
    let cells = rowCellState.get(stateKey);
    if (!cells) {
      cells = new Set(Object.keys(doc.elements[elementId]?.ovr.tableCells ?? {})
        .filter((key) => tableCellKeyBelongsToRow(key, rowId)));
      rowCellState.set(stateKey, cells);
    }
    return cells;
  };
  for (const patch of patches) {
    if (isElementTextPatch(patch) && patch.path.length === 7
      && typeof patch.path[4] === 'string') {
      const cells = cellsFor(patch.path[1], patch.path[4]);
      const key = tableCellOverrideKeyFromRowRef(patch.path[4], patch.path[5]);
      if (patch.op === 'set') cells.add(key);
      else cells.delete(key);
    }
    if (isTableRowPatch(patch) && patch.op === 'remove') {
      const orphan = cellsFor(patch.path[1], patch.path[4]).values().next().value;
      if (orphan) throw new Error(`移除表格行前必须先删除其单元格覆盖：${orphan}`);
    }
  }
  patches.forEach((patch, index) => {
    if (isElementTreePatch(patch) || isSlideTreePatch(patch)) return;
    const tree = owner.get(patch.path[1]);
    if (tree !== undefined) {
      throw new Error(`Patch ${index} 与 Patch ${tree} 同时修改将被移除的元素：${patch.path[1]}`);
    }
  });
}

function structuralPatchStage(doc: EditDoc, patches: readonly Patch[]): EditDoc {
  const stage: EditDoc = {
    ...doc,
    identity: structuredClone(doc.identity),
    slides: { ...doc.slides },
    slideOrder: [...doc.slideOrder],
    elements: { ...doc.elements },
    removedElements: { ...doc.removedElements },
    imageResources: { ...doc.imageResources },
  };
  const clonedSlides = new Set<string>();
  const clonedElements = new Set<string>();
  const cloneSlide = (id: string): void => {
    if (clonedSlides.has(id) || !stage.slides[id]) return;
    stage.slides[id] = structuredClone(stage.slides[id]);
    clonedSlides.add(id);
  };
  const cloneElement = (id: string): void => {
    if (clonedElements.has(id) || !stage.elements[id]) return;
    stage.elements[id] = structuredClone(stage.elements[id]);
    clonedElements.add(id);
  };
  const cloneParent = (id: string): void => {
    if (stage.slides[id]) cloneSlide(id);
    else cloneElement(id);
  };
  for (const patch of patches) {
    if (patch.path[0] === 'slides' && patch.path.length > 2) cloneSlide(patch.path[1]);
    if (patch.path[0] === 'elements' && patch.path.length > 2) cloneElement(patch.path[1]);
    if (isElementTreePatch(patch)) {
      cloneParent(patch.value.parent);
      const slideId = doc.slides[patch.value.parent]
        ? patch.value.parent : slideOfElement(doc, patch.value.parent);
      cloneSlide(slideId);
    } else if (isElementOrderPatch(patch)) {
      const parent = doc.elements[patch.path[1]]?.parent;
      if (parent) cloneParent(parent);
    }
  }
  return stage;
}

function applyPatchValues(doc: EditDoc, patches: readonly Patch[]): void {
  const orderParents = new Set<string>();
  for (const patch of patches) {
    if (isSlideOrderPatch(patch)) applySlideOrderPatch(doc, patch);
    else if (isSlideTreePatch(patch)) applySlideTreePatch(doc, patch);
    else if (isSlidePropertyPatch(patch)) applySlidePropertyPatch(doc, patch);
    else if (isElementTreePatch(patch)) applyElementTreePatch(doc, patch);
    else if (isElementFillPatch(patch)) applyElementFillPatch(doc, patch);
    else if (isElementStrokePatch(patch)) applyElementStrokePatch(doc, patch);
    else if (isElementEffectsPatch(patch)) applyElementEffectsPatch(doc, patch);
    else if (isElementLinkPatch(patch)) applyElementLinkPatch(doc, patch);
    else if (isElementCropPatch(patch)) applyElementCropPatch(doc, patch);
    else if (isElementImageReplacementPatch(patch)) applyElementImageReplacementPatch(doc, patch);
    else if (isImageResourcePatch(patch)) applyImageResourcePatch(doc, patch);
    else if (isElementTextPatch(patch)) applyElementTextPatch(doc, patch);
    else if (isTableRowPatch(patch)) applyTableRowPatch(doc, patch);
    else if (isElementOrderPatch(patch)) orderParents.add(applyElementOrderValue(doc, patch));
    else applyElementTransformPatch(doc, patch as ElementTransformPatch);
  }
  for (const parent of orderParents) sortElementChildrenByOrder(doc, parent);
}

function applyPatchBatch(
  doc: EditDoc,
  patches: readonly Patch[],
  stageStructuralModel: boolean,
): ProjectionInvalidation {
  validatePatchRelations(doc, patches);
  const imageResourcePatches: { patch: ImageResourcePatch; index: number }[] = [];
  patches.forEach((patch, index) => {
    if (isImageResourcePatch(patch)) imageResourcePatches.push({ patch, index });
  });
  // 变换/文字等热路径只读资源表；只有真正修改资源时才支付写时复制成本。
  const stagedImageResources = imageResourcePatches.length
    ? { ...doc.imageResources } : doc.imageResources;
  imageResourcePatches.forEach(({ patch, index }) => {
    validateImageResourcePatch(doc, patch, index);
    if (patch.op === 'set') stagedImageResources[patch.path[1]] = patch.value;
    else delete stagedImageResources[patch.path[1]];
  });
  if (imageResourcePatches.length) assertImageResourceTargets(doc, stagedImageResources);
  const stagedTableRows = new Map<string, Record<string, TableRowInsertion>>();
  patches.forEach((patch, index) => {
    validatePatch(doc, patch, index, stagedTableRows, stagedImageResources);
    if (!isTableRowPatch(patch)) return;
    const current = stagedTableRows.get(patch.path[1])
      ?? { ...doc.elements[patch.path[1]]?.ovr.tableRows };
    if (patch.op === 'insert') current[patch.path[4]] = { ...patch.value };
    else delete current[patch.path[4]];
    stagedTableRows.set(patch.path[1], current);
  });
  const resourceHashes = new Set(imageResourcePatches.map(({ patch }) => patch.path[1]));
  const replacements = new Map<string, ElementImageReplacement | undefined>();
  const backgrounds = new Map<string, EditDoc['slides'][string]['ovr']['background']>();
  const backgroundImages = new Map<string, SlideImageBackground | undefined>();
  for (const patch of patches) {
    if (isElementImageReplacementPatch(patch)) {
      replacements.set(patch.path[1], patch.op === 'set' ? patch.value : undefined);
    } else if (isSlideBackgroundPatch(patch)) {
      backgrounds.set(patch.path[1], patch.op === 'set' ? patch.value : undefined);
    } else if (isSlideBackgroundImagePatch(patch)) {
      backgroundImages.set(patch.path[1], patch.op === 'set' ? patch.value : undefined);
    }
  }
  const finalBackgroundImage = (id: string): SlideImageBackground | undefined =>
    backgroundImages.has(id) ? backgroundImages.get(id) : doc.slides[id]?.backgroundImage;
  if (resourceHashes.size) {
    for (const record of Object.values(doc.elements)) {
      const replacement = replacements.has(record.id)
        ? replacements.get(record.id) : record.meta.imageReplacement;
      if (replacement && resourceHashes.has(replacement.resourceHash) && record.meta.origin) {
        assertImageReplacement(
          replacement, record.meta.origin.part, stagedImageResources,
          `元素 ${record.id} 的最终图片替换资源`,
        );
      }
    }
    for (const record of Object.values(doc.slides)) {
      const backgroundImage = finalBackgroundImage(record.id);
      if (backgroundImage
        && backgroundImage.resourceHashes.some((hash) => resourceHashes.has(hash))
        && record.origin) {
        assertSlideImageBackground(
          backgroundImage, record, stagedImageResources,
          `幻灯片 ${record.id} 的最终图片背景资源`, doc,
        );
      }
    }
  }
  const touchedBackgroundSlides = new Set([...backgrounds.keys(), ...backgroundImages.keys()]);
  if (resourceHashes.size) for (const record of Object.values(doc.slides)) {
    if (finalBackgroundImage(record.id)?.resourceHashes.some((hash) => resourceHashes.has(hash))) {
      touchedBackgroundSlides.add(record.id);
    }
  }
  for (const slideId of touchedBackgroundSlides) {
    const record = doc.slides[slideId];
    if (!record) throw new Error(`图片背景 Patch 指向不存在的幻灯片：${slideId}`);
    const background = backgrounds.has(slideId) ? backgrounds.get(slideId) : record.ovr.background;
    const backgroundImage = finalBackgroundImage(slideId);
    if ((background?.type === 'image') !== !!backgroundImage
      || (background?.type === 'image' && background.src !== backgroundImage?.src)) {
      throw new Error(`幻灯片 ${record.id} 的图片背景与资源闭包不一致`);
    }
    if (background?.type === 'image' && backgroundImage) {
      assertSlideImageBackgroundDimensions(
        doc, record, background, backgroundImage, stagedImageResources,
        `幻灯片 ${record.id} 的最终图片背景`,
      );
    }
  }
  validateElementOrderPatchSet(doc, patches);
  const dirtyElements = new Set<string>();
  const dirtySlides = new Set<string>();
  // 失效可能因外部破坏的父链而失败；先完成它，保证失败时还没有任何 patch 落到模型。
  for (const patch of patches) {
    if (isImageResourcePatch(patch)) continue;
    if (isSlideOrderPatch(patch)) {
      const sequence = invalidateSlideSequence(doc, slideOrderPatchStart(doc, patch));
      for (const elementId of sequence.dirtyElements) dirtyElements.add(elementId);
      for (const slideId of sequence.dirtySlides) dirtySlides.add(slideId);
      continue;
    }
    if (isSlideTreePatch(patch)) {
      const start = patch.op === 'insert'
        ? (patch.value.after === null ? 0 : doc.slideOrder.indexOf(patch.value.after) + 1)
        : doc.slideOrder.indexOf(patch.path[1]) + 1;
      const sequence = invalidateSlideSequence(doc, start);
      for (const elementId of sequence.dirtyElements) dirtyElements.add(elementId);
      for (const slideId of sequence.dirtySlides) dirtySlides.add(slideId);
    }
    const dirty = isSlidePropertyPatch(patch)
      ? invalidateSlide(doc, patch.path[1])
      : isSlideTreePatch(patch)
      ? invalidateSlideStructure(doc, patch.path[1], Object.keys(patch.value.records))
      : isElementTreePatch(patch)
      ? invalidateElementStructure(doc, Object.keys(patch.value.records), patch.value.parent)
      : invalidateElement(doc, patch.path[1]);
    for (const elementId of dirty.dirtyElements) dirtyElements.add(elementId);
    for (const slideId of dirty.dirtySlides) dirtySlides.add(slideId);
  }
  if (stageStructuralModel
    && patches.some((patch) => isSlideTreePatch(patch) || isElementTreePatch(patch))) {
    const stage = structuralPatchStage(doc, patches);
    applyPatchValues(stage, patches);
    validateEditDoc(stage);
  }
  applyPatchValues(doc, patches);
  return { dirtyElements, dirtySlides };
}

/** JSON/协同 seam：结构快照必须先在写时复制的完整模型上验真。 */
export function applyPatches(doc: EditDoc, patches: readonly Patch[]): ProjectionInvalidation {
  return applyPatchBatch(doc, patches, true);
}

/** 仅供同一事务内刚生成的命令 Patch；事务末尾由 Editor 统一校验完整模型。 */
export function applyLocalPatches(doc: EditDoc, patches: readonly Patch[]): ProjectionInvalidation {
  return applyPatchBatch(doc, patches, false);
}
