import { sortElementChildrenByOrder } from '../element-order';
import {
  invalidateElement, invalidateElementStructure, invalidateSlideSequence, invalidateSlideStructure,
} from '../projection';
import { tableCellKeyBelongsToRow, tableCellOverrideKeyFromRowRef } from '../table-cell';
import type { EditDoc, ProjectionInvalidation, TableRowInsertion } from '../types';
import { applyElementTransformPatch } from './element-transform';
import { applyElementFillPatch, isElementFillPatch, validateElementFillPatch } from './element-fill';
import { applyElementStrokePatch, isElementStrokePatch, validateElementStrokePatch } from './element-stroke';
import { applyElementEffectsPatch, isElementEffectsPatch, validateElementEffectsPatch } from './element-effects';
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
import type { ElementTransformPatch, ElementTreePatch, Patch, XfrmField } from './types';
import { assertXfrmValue, XFRM_FIELD_SET } from './xfrm';

function validatePatch(
  doc: EditDoc,
  input: Patch,
  index: number,
  stagedTableRows: ReadonlyMap<string, Record<string, TableRowInsertion>>,
): void {
  const patch = input as Partial<Patch> & { path?: unknown; value?: unknown };
  if (!['set', 'del', 'remove', 'insert', 'move'].includes(String(patch.op))) {
    throw new Error(`Patch ${index} 的 op 不受支持`);
  }
  if (typeof patch.origin !== 'string' || !patch.origin) throw new Error(`Patch ${index} 缺少 origin`);
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
    && patch.path[2] === 'ovr' && patch.path[3] === 'effects'
    && (patch.op === 'set' || patch.op === 'del')) {
    validateElementEffectsPatch(doc, patch as import('./types').ElementEffectsPatch, index);
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

export function applyPatches(doc: EditDoc, patches: readonly Patch[]): ProjectionInvalidation {
  validatePatchRelations(doc, patches);
  const stagedTableRows = new Map<string, Record<string, TableRowInsertion>>();
  patches.forEach((patch, index) => {
    validatePatch(doc, patch, index, stagedTableRows);
    if (!isTableRowPatch(patch)) return;
    const current = stagedTableRows.get(patch.path[1])
      ?? { ...doc.elements[patch.path[1]]?.ovr.tableRows };
    if (patch.op === 'insert') current[patch.path[4]] = { ...patch.value };
    else delete current[patch.path[4]];
    stagedTableRows.set(patch.path[1], current);
  });
  validateElementOrderPatchSet(doc, patches);
  const dirtyElements = new Set<string>();
  const dirtySlides = new Set<string>();
  // 失效可能因外部破坏的父链而失败；先完成它，保证失败时还没有任何 patch 落到模型。
  for (const patch of patches) {
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
    const dirty = isSlideTreePatch(patch)
      ? invalidateSlideStructure(doc, patch.path[1], Object.keys(patch.value.records))
      : isElementTreePatch(patch)
      ? invalidateElementStructure(doc, Object.keys(patch.value.records), patch.value.parent)
      : invalidateElement(doc, patch.path[1]);
    for (const elementId of dirty.dirtyElements) dirtyElements.add(elementId);
    for (const slideId of dirty.dirtySlides) dirtySlides.add(slideId);
  }
  const orderParents = new Set<string>();
  for (const patch of patches) {
    if (isSlideOrderPatch(patch)) applySlideOrderPatch(doc, patch);
    else if (isSlideTreePatch(patch)) applySlideTreePatch(doc, patch);
    else if (isElementTreePatch(patch)) applyElementTreePatch(doc, patch);
    else if (isElementFillPatch(patch)) applyElementFillPatch(doc, patch);
    else if (isElementStrokePatch(patch)) applyElementStrokePatch(doc, patch);
    else if (isElementEffectsPatch(patch)) applyElementEffectsPatch(doc, patch);
    else if (isElementTextPatch(patch)) applyElementTextPatch(doc, patch);
    else if (isTableRowPatch(patch)) applyTableRowPatch(doc, patch);
    else if (isElementOrderPatch(patch)) orderParents.add(applyElementOrderValue(doc, patch));
    else applyElementTransformPatch(doc, patch as ElementTransformPatch);
  }
  for (const parent of orderParents) sortElementChildrenByOrder(doc, parent);
  return { dirtyElements, dirtySlides };
}
