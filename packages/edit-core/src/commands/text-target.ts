import type { TextBody } from '@web-ppt/core';
import type {
  EditDoc, ElementRecord, TableCellAddress, TableCellRowRef, TextOverride,
} from '../types';
import {
  assertTableCellAddress, tableCellOverrideKey, tableCellRowRef,
} from '../table-cell';
import { tableRowsWithoutTextOverrides } from '../table-rows';
import type { ElementTextPatch } from './types';

export interface TextTarget {
  readonly id: string;
  readonly cell?: TableCellAddress;
}

export interface TextTargetContext {
  readonly record: ElementRecord;
  readonly body: TextBody;
  readonly before: TextOverride | undefined;
  readonly patchTarget: TextPatchTarget;
}

export interface TextPatchTarget {
  readonly id: string;
  readonly cell?: { readonly row: TableCellRowRef; readonly c: number };
}

export function textTargetContextForRecord(
  record: ElementRecord,
  target: TextTarget,
): TextTargetContext {
  if (record.id !== target.id || record.meta.editable !== 'full') {
    throw new Error(`找不到可编辑文字的元素：${target.id}`);
  }
  if (target.cell === undefined) {
    if (record.src.kind !== 'shape' || (!record.src.text && !record.meta.textTemplate)) {
      throw new Error(`找不到可编辑文字的形状：${target.id}`);
    }
    return {
      record,
      body: record.src.text ?? record.meta.textTemplate!,
      before: record.ovr.text,
      patchTarget: { id: target.id },
    };
  }
  assertTableCellAddress(target.cell, '文字命令 cell');
  if (record.src.kind !== 'table') throw new Error(`文字命令 cell 必须指向表格：${target.id}`);
  const cell = tableRowsWithoutTextOverrides(record)[target.cell.r]?.cells[target.cell.c];
  if (!cell) throw new Error(`表格单元格越界：${target.cell.r},${target.cell.c}`);
  if (cell.merged) throw new Error(`合并占位格不可单独编辑：${target.cell.r},${target.cell.c}`);
  const body = cell.text ?? cell.editInfo?.textTemplate;
  if (!body) throw new Error(`表格单元格缺少可编辑文本体：${target.cell.r},${target.cell.c}`);
  const row = tableCellRowRef(record, target.cell);
  if (row === null) throw new Error(`表格单元格越界：${target.cell.r},${target.cell.c}`);
  return {
    record,
    body,
    before: record.ovr.tableCells?.[tableCellOverrideKey(record, target.cell)]?.text,
    patchTarget: { id: target.id, cell: { row, c: target.cell.c } },
  };
}

export function textTargetContext(
  doc: EditDoc,
  target: TextTarget,
): TextTargetContext {
  const record = doc.elements[target.id];
  if (!record) throw new Error(`找不到可编辑文字的元素：${target.id}`);
  return textTargetContextForRecord(record, target);
}

export function setTextPatch(
  target: TextPatchTarget,
  value: TextOverride,
  origin: string,
): ElementTextPatch {
  return target.cell === undefined
    ? { op: 'set', path: ['elements', target.id, 'ovr', 'text'], value, origin }
    : {
      op: 'set',
      path: ['elements', target.id, 'ovr', 'tableCells', target.cell.row, target.cell.c, 'text'],
      value,
      origin,
    };
}

export function inverseTextPatch(
  target: TextPatchTarget,
  before: TextOverride | undefined,
  origin: string,
): ElementTextPatch {
  if (before) return setTextPatch(target, before, origin);
  return target.cell === undefined
    ? { op: 'del', path: ['elements', target.id, 'ovr', 'text'], origin }
    : {
      op: 'del',
      path: ['elements', target.id, 'ovr', 'tableCells', target.cell.row, target.cell.c, 'text'],
      origin,
    };
}
