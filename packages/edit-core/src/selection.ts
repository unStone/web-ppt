import type { TextBody } from '@web-ppt/core';
import { slideOfElement } from './projection';
import type { EditDoc, ElementId } from './types';
import type { Selection, TextPosition } from './commands/types';

const clonePosition = (position: TextPosition): TextPosition => ({ ...position });

export function cloneSelection(selection: Selection): Selection {
  switch (selection.kind) {
    case 'none': return { kind: 'none' };
    case 'elements': return { kind: 'elements', ids: [...selection.ids], enteredGroup: selection.enteredGroup };
    case 'text': return {
      kind: 'text', id: selection.id,
      anchor: clonePosition(selection.anchor), focus: clonePosition(selection.focus),
    };
    case 'table': return { kind: 'table', id: selection.id, cells: selection.cells.map((cell) => ({ ...cell })) };
  }
}

function validateTextPosition(text: TextBody, position: TextPosition, label: string): void {
  if (![position.p, position.r, position.off].every((value) => Number.isInteger(value) && value >= 0)) {
    throw new Error(`${label} 必须使用非负整数段落、run 与字符偏移`);
  }
  const paragraph = text.paragraphs[position.p];
  if (!paragraph) throw new Error(`${label} 的段落越界`);
  if (!paragraph.runs.length) {
    if (position.r !== 0 || position.off !== 0) throw new Error(`${label} 的空段落位置越界`);
    return;
  }
  const run = paragraph.runs[position.r];
  if (!run || position.off > run.text.length) throw new Error(`${label} 的 run 或 UTF-16 偏移越界`);
}

export function isElementDescendantOf(doc: EditDoc, id: ElementId, ancestor: ElementId): boolean {
  let current = doc.elements[id];
  const seen = new Set<ElementId>();
  while (current && doc.elements[current.parent]) {
    if (seen.has(current.id)) throw new Error(`元素父链成环：${current.id}`);
    seen.add(current.id);
    if (current.parent === ancestor) return true;
    current = doc.elements[current.parent];
  }
  return false;
}

/** 选区根只沿每个元素的父链查找，避免大选区用两两后代判断退化为平方复杂度。 */
export function outermostSelectedElementIds(doc: EditDoc, ids: readonly ElementId[]): ElementId[] {
  const selected = new Set(ids);
  return ids.filter((id) => {
    let current = doc.elements[id];
    const seen = new Set<ElementId>();
    while (current && doc.elements[current.parent]) {
      if (seen.has(current.id)) throw new Error(`元素父链成环：${current.id}`);
      seen.add(current.id);
      if (selected.has(current.parent)) return false;
      current = doc.elements[current.parent];
    }
    return true;
  });
}

export function normalizeSelection(doc: EditDoc, selection: Selection): Selection {
  switch (selection.kind) {
    case 'none': return { kind: 'none' };
    case 'elements': {
      if (!selection.ids.length) return { kind: 'none' };
      if (new Set(selection.ids).size !== selection.ids.length) throw new Error('元素选区不能包含重复 id');
      const slide = slideOfElement(doc, selection.ids[0]);
      for (const id of selection.ids) {
        if (!doc.elements[id]) throw new Error(`选区指向不存在的元素：${id}`);
        if (slideOfElement(doc, id) !== slide) throw new Error('一个元素选区不能跨幻灯片');
      }
      if (selection.enteredGroup !== null) {
        const group = doc.elements[selection.enteredGroup];
        if (!group || group.src.kind !== 'group') throw new Error('进入组必须指向现有组元素');
        if (!selection.ids.every((id) => isElementDescendantOf(doc, id, selection.enteredGroup!))) {
          throw new Error('进入组后的选区只能包含该组后代');
        }
      }
      return cloneSelection(selection);
    }
    case 'text': {
      const record = doc.elements[selection.id];
      if (!record || record.src.kind !== 'shape' || !record.src.text) throw new Error('文本选区必须指向文本形状');
      validateTextPosition(record.src.text, selection.anchor, '文本选区 anchor');
      validateTextPosition(record.src.text, selection.focus, '文本选区 focus');
      return cloneSelection(selection);
    }
    case 'table': {
      const record = doc.elements[selection.id];
      if (!record || record.src.kind !== 'table') throw new Error('表格选区必须指向表格元素');
      for (const cell of selection.cells) {
        if (!Number.isInteger(cell.r) || !Number.isInteger(cell.c) || cell.r < 0 || cell.c < 0
          || cell.r >= record.src.rows.length || cell.c >= record.src.colWidths.length) {
          throw new Error(`表格选区单元格越界：${cell.r},${cell.c}`);
        }
      }
      return cloneSelection(selection);
    }
  }
}

/** 结构编辑后过滤已删除身份；普通属性事务仍走严格 normalizeSelection。 */
export function selectionAfterStructure(doc: EditDoc, selection: Selection): Selection {
  if (selection.kind === 'none') return { kind: 'none' };
  if (selection.kind === 'text' || selection.kind === 'table') {
    return doc.elements[selection.id] ? normalizeSelection(doc, selection) : { kind: 'none' };
  }
  const ids = selection.ids.filter((id) => !!doc.elements[id]);
  if (!ids.length) return { kind: 'none' };
  const enteredGroup = selection.enteredGroup && doc.elements[selection.enteredGroup]?.src.kind === 'group'
    && ids.every((id) => isElementDescendantOf(doc, id, selection.enteredGroup!))
    ? selection.enteredGroup : null;
  return normalizeSelection(doc, { kind: 'elements', ids, enteredGroup });
}
