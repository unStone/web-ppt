import { DEFAULT_TEXT_LINE_HEIGHT } from '@web-ppt/core';
import { applyBodyProps, queryBodyProps } from '../body-properties';
import { assertDataObject, assertTextRange, own } from '../data-validation';
import { elementOrAncestorMatches } from '../element-ancestry';
import { queryParaProps } from '../paragraph-properties';
import { effectiveElement } from '../projection';
import { queryRunProps } from '../run-properties';
import { normalizeEffects } from '../shape-effects';
import { normalizeStroke } from '../shape-stroke';
import {
  applyParagraphProps, applyRunProps, flattenTextBody, textBodyFromOverride,
} from '../text-model';
import { textBodyEditText, textPositionAtIndex, textPositionToIndex } from '../text-position';
import { assertTableCellAddress } from '../table-cell';
import type {
  EditDoc, ParagraphPropertyOverrides, RunPropertyOverrides, TextBodyPropertyOverrides, TextOverride,
} from '../types';
import { assertFormatMask } from './format-painter-types';
import type { ApplyFormatCommand, FormatMaskField } from './format-painter-types';
import type { CommandPatches, Patch } from './types';
import {
  directEffectsPatches, directFillPatches, directStrokePatches,
} from './direct-format-patches';
import { inverseTextPatch, setTextPatch, textTargetContext } from './text-target';

const TEXT_FIELDS = new Set<FormatMaskField>(['run', 'paragraph', 'body']);
const RUN_FIELDS = ['font', 'size', 'color', 'b', 'i', 'u', 'strike'] as const;
const PARAGRAPH_FIELDS = [
  'level', 'align', 'lineHeight', 'spaceBefore', 'spaceAfter', 'marginLeft', 'indent',
] as const;

function validate(command: ApplyFormatCommand): void {
  assertDataObject(command, [
    'type', 'from', 'to', 'mask', 'fromCell', 'toCell', 'fromRange', 'toRange',
  ], 'ApplyFormat');
  if (typeof command.from !== 'string' || !command.from
    || typeof command.to !== 'string' || !command.to) {
    throw new Error('ApplyFormat.from/to 必须是非空元素身份');
  }
  for (const field of ['fromCell', 'toCell', 'fromRange', 'toRange'] as const) {
    if (own(command, field) && command[field] === undefined) {
      throw new Error(`ApplyFormat.${field} 不能显式为 undefined`);
    }
  }
  assertFormatMask(command.mask, 'ApplyFormat.mask');
  const hasText = command.mask.some((field) => TEXT_FIELDS.has(field));
  if (!hasText && (command.fromCell !== undefined || command.toCell !== undefined
    || command.fromRange !== undefined || command.toRange !== undefined)) {
    throw new Error('对象格式刷不能携带文字目标字段');
  }
  const hasRangeFormat = command.mask.includes('run') || command.mask.includes('paragraph');
  if (!hasRangeFormat && (command.fromRange !== undefined || command.toRange !== undefined)) {
    throw new Error('只有字符或段落格式刷可以携带文字范围');
  }
  if (command.fromCell !== undefined) assertTableCellAddress(command.fromCell, 'ApplyFormat.fromCell');
  if (command.toCell !== undefined) assertTableCellAddress(command.toCell, 'ApplyFormat.toCell');
  if (command.fromRange !== undefined) assertTextRange(command.fromRange, 'ApplyFormat.fromRange');
  if (command.toRange !== undefined) assertTextRange(command.toRange, 'ApplyFormat.toRange');
}

export function applyFormatPatches(
  doc: EditDoc,
  command: ApplyFormatCommand,
  origin: string,
): CommandPatches {
  validate(command);
  if (doc.meta.readonly) throw new Error('只读编辑文档不能使用格式刷');
  const source = doc.elements[command.from];
  const target = doc.elements[command.to];
  if (!source) throw new Error(`找不到格式来源：${command.from}`);
  if (!target) throw new Error(`找不到格式目标：${command.to}`);
  if (target.meta.editable !== 'full') throw new Error(`格式目标不可完整编辑：${command.to}`);
  if (elementOrAncestorMatches(doc, command.to, (record) => record.meta.hiddenByUser === true)) {
    throw new Error(`隐藏元素不能作为格式目标：${command.to}`);
  }
  return objectFormatPatches(doc, command, origin);
}

function wholeRange(body: Parameters<typeof textBodyEditText>[0]) {
  return {
    from: { p: 0, r: 0, off: 0 },
    to: textPositionAtIndex(body, textBodyEditText(body).length),
  };
}

function uniformRunProps(doc: EditDoc, command: ApplyFormatCommand, range: ReturnType<typeof wholeRange>) {
  const state = queryRunProps(doc, command.from, range, command.fromCell);
  const props: Record<string, string | number | boolean> = {};
  for (const field of RUN_FIELDS) {
    if (state[field].mixed || state[field].value === null) {
      throw new Error(`格式来源的字符属性 ${field} 不是单一有效值`);
    }
    props[field] = state[field].value;
  }
  return props as RunPropertyOverrides;
}

function uniformParagraphProps(
  doc: EditDoc,
  command: ApplyFormatCommand,
  range: ReturnType<typeof wholeRange>,
): ParagraphPropertyOverrides {
  const state = queryParaProps(doc, command.from, range, command.fromCell);
  const props: Record<string, string | number | null> = {};
  for (const field of PARAGRAPH_FIELDS) {
    if (state[field].mixed) throw new Error(`格式来源的段落属性 ${field} 不是单一有效值`);
    props[field] = field === 'lineHeight' && state[field].value === null
      ? DEFAULT_TEXT_LINE_HEIGHT : state[field].value;
  }
  return props as ParagraphPropertyOverrides;
}

function textFormatPatches(
  doc: EditDoc,
  command: ApplyFormatCommand,
  origin: string,
): CommandPatches {
  const sourceTarget = {
    id: command.from, ...(command.fromCell !== undefined ? { cell: command.fromCell } : {}),
  };
  const targetTarget = {
    id: command.to, ...(command.toCell !== undefined ? { cell: command.toCell } : {}),
  };
  const source = textTargetContext(doc, sourceTarget);
  const target = textTargetContext(doc, targetTarget);
  const sourceBody = source.before?.kind === 'flat'
    ? textBodyFromOverride(source.before) : source.body;
  const targetBody = target.before?.kind === 'flat'
    ? textBodyFromOverride(target.before) : target.body;
  const fromRange = command.fromRange ?? wholeRange(sourceBody);
  const toRange = command.toRange ?? wholeRange(targetBody);
  const copiesRun = command.mask.includes('run');
  const copiesParagraph = command.mask.includes('paragraph');
  const copiesBody = command.mask.includes('body');
  if ((copiesRun || copiesParagraph) && target.empty) {
    throw new Error('空文字目标没有可保持内容的字符或段落范围');
  }
  if (copiesRun && textPositionToIndex(targetBody, toRange.from)
    === textPositionToIndex(targetBody, toRange.to)) {
    throw new Error('字符格式刷的目标范围不能为空');
  }
  let value = target.before?.kind === 'flat'
    ? target.before : flattenTextBody(targetBody);
  if (copiesRun) value = applyRunProps(
    targetBody, toRange, uniformRunProps(doc, command, fromRange), value,
  ) as Extract<TextOverride, { kind: 'flat' }>;
  if (copiesParagraph) value = applyParagraphProps(
    targetBody, toRange, uniformParagraphProps(doc, command, fromRange), value,
    target.levelTemplate, target.body,
  ) as Extract<TextOverride, { kind: 'flat' }>;
  if (copiesBody) {
    const props = queryBodyProps(doc, command.from, command.fromCell) as TextBodyPropertyOverrides;
    value = applyBodyProps(value, props, target.body.editInfo);
  }
  const finalValue: TextOverride = target.empty && !copiesRun && !copiesParagraph
    ? {
      kind: 'empty', body: value.body,
      ...(value.bodyOverrides ? { bodyOverrides: value.bodyOverrides } : {}),
    }
    : value;
  if (target.before && JSON.stringify(target.before) === JSON.stringify(finalValue)) {
    return { forward: [], inverse: [] };
  }
  return {
    forward: [setTextPatch(target.patchTarget, finalValue, origin)],
    inverse: [inverseTextPatch(target.patchTarget, target.before, origin)],
  };
}

function objectFormatPatches(
  doc: EditDoc,
  command: ApplyFormatCommand,
  origin: string,
): CommandPatches {
  const source = effectiveElement(doc, command.from);
  const target = doc.elements[command.to];
  const forward: Patch[] = [];
  const inverse: Patch[] = [];
  const append = (patches: CommandPatches): void => {
    forward.push(...patches.forward);
    inverse.unshift(...patches.inverse);
  };
  for (const field of command.mask) {
    if (field === 'fill') {
      if (source.kind !== 'shape' || target.src.kind !== 'shape') {
        throw new Error('填充格式只能在形状之间复制');
      }
      if (source.fill?.type === 'image') throw new Error('图片填充属于媒体内容，不能通过格式刷复制');
      append(directFillPatches(
        doc, command.to, structuredClone(source.fill ?? { type: 'none' }), origin,
      ));
    } else if (field === 'stroke') {
      if ((source.kind !== 'shape' && source.kind !== 'image')
        || (target.src.kind !== 'shape' && target.src.kind !== 'image')) {
        throw new Error('描边格式只支持形状或图片');
      }
      const stroke = source.stroke ? normalizeStroke(source.stroke) : null;
      append(directStrokePatches(doc, command.to, stroke, origin));
    } else if (field === 'effects') {
      if (!['shape', 'image', 'group'].includes(source.kind)
        || !['shape', 'image', 'group'].includes(target.src.kind)) {
        throw new Error('二维效果格式只支持形状、图片或组合');
      }
      append(directEffectsPatches(
        doc, command.to, normalizeEffects(source.effects ?? {}), origin,
      ));
    }
  }
  if (command.mask.some((field) => TEXT_FIELDS.has(field))) append(textFormatPatches(doc, command, origin));
  return { forward, inverse };
}
