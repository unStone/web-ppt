import { validateEditDoc } from '../model-invariants';
import { releaseProjectionCache } from '../projection';
import { tableCellKeyBelongsToRow, tableCellOverrideKeyFromRefs } from '../table-cell';
import type {
  EditDoc, ElementImageReplacement, ElementInsertionResource, ProjectionInvalidation,
  SlideImageBackground, TableRowInsertion,
} from '../types';
import { validateElementFillPatch } from './element-fill';
import { validateElementStrokePatch } from './element-stroke';
import { validateElementEffectsPatch } from './element-effects';
import { validateElementLinkPatch } from './element-link';
import {
  assertImageReplacement, assertImageResourceTargets,
  isElementImageReplacementPatch, isImageResourcePatch,
  validateElementCropPatch, validateElementImageReplacementPatch, validateImageResourcePatch,
} from './element-image-content';
import {
  validateElementOrderPatch, validateElementOrderPatchSet,
} from './element-order';
import { isElementTreePatch, validateElementTreePatch } from './element-tree';
import {
  isElementHierarchyPatch, validateElementHierarchyPatch,
} from './element-hierarchy';
import { isElementTextPatch, validateElementTextPatch } from './element-text';
import { isTableRowPatch, validateTableRowPatch } from './table-row';
import {
  isTableCellPropsPatch, isTableColumnPatch, isTableGridEntryPatch,
  isTableMergePatch, validateTableCellPropsPatch, validateTableColumnPatch,
  validateTableGridEntryPatch, validateTableMergePatch,
} from './table-grid-patch';
import { isSlideTreePatch, validateSlideTreePatch } from './slide-tree';
import { validateSlideOrderPatch } from './slide-order';
import {
  isSlideBackgroundImagePatch, isSlideBackgroundPatch,
  isSlideAnimationsPatch, isSlidePropertyPatch, validateSlidePropertyPatch, assertSlideImageBackground,
  assertSlideImageBackgroundDimensions,
} from './slide-property';
import {
  isSlideLayoutPatch, validateSlideLayoutPatch,
} from './slide-layout';
import { isSlideNotesPatch, validateSlideNotesPatch } from './slide-notes';
import type {
  ElementTreePatch, ExtensionPatch, ImageResourcePatch, Patch, XfrmField,
} from './types';
import { assertPatchCount } from './patch-count';
import { assertXfrmValue, XFRM_FIELD_SET } from './xfrm';
import {
  isElementNamePatch, validateElementNamePatch,
} from './element-name';
import {
  isElementInteractionPatch, validateElementInteractionPatch,
} from './element-interaction';
import {
  isElementGeometryPatch, isElementPresetGeometryPatch,
  validateElementGeometryPatch, validateElementPresetGeometryPatch,
} from './element-geometry';
import {
  isElementTableStylePatch, validateElementTableStylePatch,
} from './element-table-style';
import { canInvalidateAgainst, collectPatchInvalidation } from './patch-invalidation';
import {
  validateCommonObjectSlidePatch,
} from './common-object-slide-patch';
import { isThemePatch, validateThemePatch } from './theme';
import {
  isLayoutPropertyPatch, validateLayoutPropertyPatch,
} from './layout-property';
import { isMasterBackgroundPatch, validateMasterBackgroundPatch } from './master-property';
import { isMasterTextStylePatch, validateMasterTextStylePatch } from './master-text-style';
import { applyPatchValues } from './patch-apply';
import { structuralPatchStage } from './patch-stage';
import { retainInsertionSources } from '../source-retention';
import {
  isExtensionPatch, validateExtensionPatch, validateExtensionPatchBatches,
} from '../extension-runtime';
import { isDocumentExtensionPatch, validateDocumentExtensionPatch } from '../document-extensions';
import { canonicalExtensionPatch, isExtensionAddressPatch } from '../extension-addresses';
import { isExtensionMigrationPatch } from '../extension-migration-receipt';

function validatePatch(
  doc: EditDoc,
  input: Patch,
  index: number,
  stagedTableRows: ReadonlyMap<string, Record<string, TableRowInsertion>>,
  stagedImageResources: Readonly<Record<string, ElementInsertionResource>>,
  animationDoc: EditDoc,
  runtimeExtensionValidated: boolean,
): void {
  const patch = input as Partial<Patch> & { path?: unknown; value?: unknown };
  if (!['set', 'del', 'remove', 'insert', 'move'].includes(String(patch.op))) {
    throw new Error(`Patch ${index} 的 op 不受支持`);
  }
  if (typeof patch.origin !== 'string' || !patch.origin) throw new Error(`Patch ${index} 缺少 origin`);
  if (isImageResourcePatch(input)) {
    return;
  }
  if (isThemePatch(input)) {
    validateThemePatch(doc, input, index);
    return;
  }
  if (isLayoutPropertyPatch(input)) {
    validateLayoutPropertyPatch(doc, input, index);
    return;
  }
  if (isMasterBackgroundPatch(input)) {
    validateMasterBackgroundPatch(doc, input, index);
    return;
  }
  if (isMasterTextStylePatch(input)) {
    validateMasterTextStylePatch(doc, input, index);
    return;
  }
  if (isExtensionPatch(input)) {
    validateExtensionPatch(doc, input, index, runtimeExtensionValidated);
    return;
  }
  if (isDocumentExtensionPatch(input)) {
    validateDocumentExtensionPatch(doc, input, index);
    return;
  }
  if (validateCommonObjectSlidePatch(doc, input, index)) return;
  if (isElementHierarchyPatch(input)) {
    validateElementHierarchyPatch(doc, input, index);
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
    validateSlidePropertyPatch(animationDoc, input, index, stagedImageResources);
    return;
  }
  if (isSlideLayoutPatch(input)) {
    validateSlideLayoutPatch(doc, input, index);
    return;
  }
  if (isSlideNotesPatch(input)) {
    validateSlideNotesPatch(doc, input, index);
    return;
  }
  if (Array.isArray(patch.path) && patch.path[0] === 'elements'
    && typeof patch.path[1] === 'string' && patch.path[2] === 'ovr'
    && ((patch.path.length === 4 && patch.path[3] === 'text')
      || (patch.path.length === 7 && patch.path[3] === 'tableCells'
        && (typeof patch.path[4] === 'number' || typeof patch.path[4] === 'string')
        && (typeof patch.path[5] === 'number' || typeof patch.path[5] === 'string')
        && patch.path[6] === 'text'))
    && (patch.op === 'set' || patch.op === 'del')) {
    validateElementTextPatch(
      doc,
      patch as import('./types').ElementTextPatch,
      index,
      stagedTableRows.get(patch.path[1]),
      stagedImageResources,
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
  if (isTableColumnPatch(input)) {
    validateTableColumnPatch(doc, input, index);
    return;
  }
  if (isTableGridEntryPatch(input)) {
    validateTableGridEntryPatch(doc, input, index);
    return;
  }
  if (isTableMergePatch(input)) {
    validateTableMergePatch(doc, input, index);
    return;
  }
  if (isTableCellPropsPatch(input)) {
    validateTableCellPropsPatch(doc, input, index);
    return;
  }
  if (Array.isArray(patch.path) && patch.path.length === 3
    && patch.path[0] === 'elements' && typeof patch.path[1] === 'string' && patch.path[2] === 'order'
    && (patch.op === 'set' || patch.op === 'del')) {
    validateElementOrderPatch(doc, patch as import('./types').ElementOrderPatch, index);
    return;
  }
  if (isElementNamePatch(input)) {
    validateElementNamePatch(doc, input, index);
    return;
  }
  if (isElementInteractionPatch(input)) {
    validateElementInteractionPatch(doc, input, index);
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
  if (isElementGeometryPatch(input)) {
    validateElementGeometryPatch(doc, input, index);
    return;
  }
  if (isElementPresetGeometryPatch(input)) {
    validateElementPresetGeometryPatch(doc, input, index);
    return;
  }
  if (isElementTableStylePatch(input)) {
    validateElementTableStylePatch(doc, input, index);
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

function validatePatchRelations(
  doc: EditDoc,
  patches: readonly Patch[],
  allowSequentialStructure: boolean,
): void {
  const owner = new Map<string, number>();
  const tableRows = new Map<string, number>();
  const tableOrders = new Map<string, number>();
  const tableGridPaths = new Map<string, number>();
  const tableColumnOrders = new Map<string, number>();
  patches.forEach((patch, index) => {
    if (isTableRowPatch(patch)) {
      const path = JSON.stringify(patch.path);
      const previousPath = tableRows.get(path);
      if (previousPath !== undefined && !allowSequentialStructure) {
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
    if (isTableColumnPatch(patch) || isTableGridEntryPatch(patch)
      || isTableMergePatch(patch) || isTableCellPropsPatch(patch)) {
      const path = JSON.stringify(patch.path);
      const previousPath = tableGridPaths.get(path);
      if (previousPath !== undefined && !allowSequentialStructure) {
        throw new Error(`Patch ${index} 与 Patch ${previousPath} 重复修改同一表格网格路径`);
      }
      tableGridPaths.set(path, index);
      if (isTableColumnPatch(patch) && patch.op === 'insert') {
        const order = `${patch.path[1]}\0${patch.value.order}`;
        const previousOrder = tableColumnOrders.get(order);
        if (previousOrder !== undefined) {
          throw new Error(`Patch ${index} 与 Patch ${previousOrder} 的表格列顺序冲突`);
        }
        tableColumnOrders.set(order, index);
      }
    }
    if (!isElementTreePatch(patch) && !isSlideTreePatch(patch) && !isElementHierarchyPatch(patch)) return;
    for (const id of Object.keys(patch.value.records)) {
      const previous = owner.get(id);
      if (previous !== undefined && !allowSequentialStructure) {
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
      const key = tableCellOverrideKeyFromRefs(patch.path[4], patch.path[5]);
      if (patch.op === 'set') cells.add(key);
      else cells.delete(key);
    }
    if (isTableRowPatch(patch) && patch.op === 'remove') {
      const orphan = cellsFor(patch.path[1], patch.path[4]).values().next().value;
      if (orphan) throw new Error(`移除表格行前必须先删除其单元格覆盖：${orphan}`);
    }
  }
  patches.forEach((patch, index) => {
    if (isElementTreePatch(patch) || isSlideTreePatch(patch) || isElementHierarchyPatch(patch)) return;
    const tree = owner.get(patch.path[1]);
    if (tree !== undefined && !allowSequentialStructure) {
      throw new Error(`Patch ${index} 与 Patch ${tree} 同时修改将被移除的元素：${patch.path[1]}`);
    }
  });
}

function applyPatchBatch(
  doc: EditDoc,
  patches: readonly Patch[],
  stageStructuralModel: boolean,
): ProjectionInvalidation {
  patches = patches.map(patch => canonicalExtensionPatch(doc, patch));
  assertPatchCount(patches.length);
  validatePatchRelations(doc, patches, stageStructuralModel);
  const structural = patches.some((patch) =>
    isSlideTreePatch(patch) || isElementTreePatch(patch) || isElementHierarchyPatch(patch)
      || isTableRowPatch(patch) || isTableColumnPatch(patch) || isTableGridEntryPatch(patch)
      || isTableMergePatch(patch) || isTableCellPropsPatch(patch) || isExtensionAddressPatch(patch) || isExtensionMigrationPatch(patch));
  // 本机元素删除已由命令生成独立快照，删除分支只读它；再次深拷贝会重复复制九级文字目录。
  // 外部批次及会安装记录的操作仍隔离快照，不能让调用方或暂存写回污染真实模型。
  const appliedPatches = structural && (stageStructuralModel
    || patches.some((patch) => patch.op !== 'remove' || !isElementTreePatch(patch)))
    ? structuredClone([...patches]) : [...patches];
  const validationStage = structural && (stageStructuralModel || patches.some(patch => isExtensionAddressPatch(patch) || isExtensionMigrationPatch(patch)))
    ? structuralPatchStage(doc, appliedPatches) : null;
  const needsAnimationStage = structural && patches.some(isSlideAnimationsPatch);
  const animationDoc = needsAnimationStage ? structuralPatchStage(doc, appliedPatches) : doc;
  if (needsAnimationStage) applyPatchValues(animationDoc, structuredClone(appliedPatches));
  const imageResourcePatches: { patch: ImageResourcePatch; index: number }[] = [];
  const extensionEntries: { patch: ExtensionPatch; index: number }[] = [];
  const resourceHashes = new Set<string>();
  patches.forEach((patch, index) => {
    if (isImageResourcePatch(patch)) {
      imageResourcePatches.push({ patch, index });
      resourceHashes.add(patch.path[1]);
    }
    else if (isExtensionPatch(patch)) extensionEntries.push({ patch, index });
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
  const dirtyElements = new Set<string>();
  const dirtySlides = new Set<string>();
  const stagedAddresses = new Set<string>(), liveAddresses = new Set<string>();
  // 结构批次依赖逐条暂存后的模型；普通扩展批次可共享一次昂贵的来源解析。
  const batchValidatedExtensions = structural
    ? new Set<number>() : validateExtensionPatchBatches(doc, extensionEntries);
  const patchDoc = validationStage ?? doc;
  patches.forEach((input, index) => {
    const patch = canonicalExtensionPatch(patchDoc, input);
    appliedPatches[index] = canonicalExtensionPatch(patchDoc, appliedPatches[index]);
    validatePatch(
      patchDoc, patch, index, stagedTableRows, stagedImageResources, animationDoc,
      batchValidatedExtensions.has(index),
    );
    if (isTableRowPatch(patch)) {
      const current = stagedTableRows.get(patch.path[1])
        ?? { ...patchDoc.elements[patch.path[1]]?.ovr.tableRows };
      if (patch.op === 'insert') current[patch.path[4]] = { ...patch.value };
      else delete current[patch.path[4]];
      stagedTableRows.set(patch.path[1], current);
    }
    if (validationStage) {
      collectPatchInvalidation(validationStage, patch, dirtyElements, dirtySlides, stagedAddresses);
      // 后续结构 Patch 必须看见前序创建的页/组；逐条克隆避免暂存写回污染批次快照。
      applyPatchValues(validationStage, [structuredClone(appliedPatches[index])]);
    }
  });
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
    backgroundImages.has(id) ? backgroundImages.get(id) : patchDoc.slides[id]?.backgroundImage;
  if (resourceHashes.size) {
    for (const record of Object.values(patchDoc.elements)) {
      const replacement = replacements.has(record.id)
        ? replacements.get(record.id) : record.meta.imageReplacement;
      if (replacement && resourceHashes.has(replacement.resourceHash)) {
        assertImageReplacement(
          replacement, record.meta.origin?.part, stagedImageResources,
          `元素 ${record.id} 的最终图片替换资源`,
        );
      }
    }
    for (const record of Object.values(patchDoc.slides)) {
      const backgroundImage = finalBackgroundImage(record.id);
      if (backgroundImage
        && backgroundImage.resourceHashes.some((hash) => resourceHashes.has(hash))
        && record.origin) {
        assertSlideImageBackground(
          backgroundImage, record, stagedImageResources,
          `幻灯片 ${record.id} 的最终图片背景资源`, patchDoc,
        );
      }
    }
  }
  const touchedBackgroundSlides = new Set([...backgrounds.keys(), ...backgroundImages.keys()]);
  if (resourceHashes.size) for (const record of Object.values(patchDoc.slides)) {
    if (finalBackgroundImage(record.id)?.resourceHashes.some((hash) => resourceHashes.has(hash))) {
      touchedBackgroundSlides.add(record.id);
    }
  }
  for (const slideId of touchedBackgroundSlides) {
    const record = patchDoc.slides[slideId];
    if (!record) throw new Error(`图片背景 Patch 指向不存在的幻灯片：${slideId}`);
    const background = backgrounds.has(slideId) ? backgrounds.get(slideId) : record.ovr.background;
    const backgroundImage = finalBackgroundImage(slideId);
    if ((background?.type === 'image') !== !!backgroundImage
      || (background?.type === 'image' && background.src !== backgroundImage?.src)) {
      throw new Error(`幻灯片 ${record.id} 的图片背景与资源闭包不一致`);
    }
    if (background?.type === 'image' && backgroundImage) {
      assertSlideImageBackgroundDimensions(
        patchDoc, record, background, backgroundImage, stagedImageResources,
        `幻灯片 ${record.id} 的最终图片背景`,
      );
    }
  }
  // 结构批中的中途 order 可能被后续解组/删除吸收；逐条验值、最终模型验唯一性即可。
  if (!validationStage) validateElementOrderPatchSet(doc, patches);
  // 失效可能因外部破坏的父链而失败；先完成它，保证失败时还没有任何 patch 落到模型。
  if (!validationStage) for (const patch of patches) {
    collectPatchInvalidation(doc, patch, dirtyElements, dirtySlides, liveAddresses);
  }
  if (validationStage) {
    validateEditDoc(validationStage);
    let released = false;
    for (const patch of patches) {
      if (canInvalidateAgainst(doc, patch)) {
        collectPatchInvalidation(doc, patch, dirtyElements, dirtySlides, liveAddresses);
      } else if (!released) {
        // 新页/新组上的后续页序与字段可能影响旧页派生值；无法沿基线遍历时清空真实缓存。
        releaseProjectionCache(doc);
        released = true;
      }
    }
  }
  if (structural) for (const patch of appliedPatches) {
    if (isElementTreePatch(patch) || isSlideTreePatch(patch) || isElementHierarchyPatch(patch)) {
      retainInsertionSources(doc, patch.value);
    }
  }
  applyPatchValues(doc, appliedPatches);
  return { dirtyElements, dirtySlides };
}
/** 协同等调用方可在不触碰真实模型的前提下验真一批外部 Patch。 */
export function assertPatchesApplicable(doc: EditDoc, patches: readonly Patch[]): void {
  stageExternalPatches(doc, patches);
}
/** 返回写时复制的外部 Patch 预演模型；调用方只能读取，真实文档始终不变。 */
export function stageExternalPatches(doc: EditDoc, patches: readonly Patch[]): EditDoc {
  const stage = structuralPatchStage(doc, patches);
  applyPatches(stage, patches);
  return stage;
}
/** JSON/协同 seam：结构快照必须先在写时复制的完整模型上验真。 */
export function applyPatches(doc: EditDoc, patches: readonly Patch[]): ProjectionInvalidation {
  return applyPatchBatch(doc, patches, true);
}
/** 仅供同一事务内刚生成的命令 Patch；事务末尾由 Editor 统一校验完整模型。 */
export function applyLocalPatches(doc: EditDoc, patches: readonly Patch[]): ProjectionInvalidation {
  return applyPatchBatch(doc, patches, false);
}
