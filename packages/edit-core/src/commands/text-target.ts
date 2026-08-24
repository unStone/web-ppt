import type { TextBody } from '@web-ppt/core';
import type { EditDoc, ElementRecord, TableCellAddress, TextOverride } from '../types';
import { assertTableCellAddress, tableCellKey } from '../table-cell';
import type { ElementTextPatch } from './types';

export interface TextTarget {
  readonly id: string;
  readonly cell?: TableCellAddress;
}

export interface TextTargetContext {
  readonly record: ElementRecord;
  readonly body: TextBody;
  readonly before: TextOverride | undefined;
}

export function textTargetContext(
  doc: EditDoc,
  target: TextTarget,
): TextTargetContext {
  const record = doc.elements[target.id];
  if (!record || record.meta.editable !== 'full') {
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
    };
  }
  assertTableCellAddress(target.cell, '文字命令 cell');
  if (record.src.kind !== 'table') throw new Error(`文字命令 cell 必须指向表格：${target.id}`);
  const cell = record.src.rows[target.cell.r]?.cells[target.cell.c];
  if (!cell) throw new Error(`表格单元格越界：${target.cell.r},${target.cell.c}`);
  if (cell.merged) throw new Error(`合并占位格不可单独编辑：${target.cell.r},${target.cell.c}`);
  const body = cell.text ?? cell.editInfo?.textTemplate;
  if (!body) throw new Error(`表格单元格缺少可编辑文本体：${target.cell.r},${target.cell.c}`);
  return {
    record,
    body,
    before: record.ovr.tableCells?.[tableCellKey(target.cell)]?.text,
  };
}

export function setTextPatch(
  target: TextTarget,
  value: TextOverride,
  origin: string,
): ElementTextPatch {
  return target.cell === undefined
    ? { op: 'set', path: ['elements', target.id, 'ovr', 'text'], value, origin }
    : {
      op: 'set',
      path: ['elements', target.id, 'ovr', 'tableCells', target.cell.r, target.cell.c, 'text'],
      value,
      origin,
    };
}

export function inverseTextPatch(
  target: TextTarget,
  before: TextOverride | undefined,
  origin: string,
): ElementTextPatch {
  if (before) return setTextPatch(target, before, origin);
  return target.cell === undefined
    ? { op: 'del', path: ['elements', target.id, 'ovr', 'text'], origin }
    : {
      op: 'del',
      path: ['elements', target.id, 'ovr', 'tableCells', target.cell.r, target.cell.c, 'text'],
      origin,
    };
}
