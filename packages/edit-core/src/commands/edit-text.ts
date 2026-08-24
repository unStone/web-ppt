import { applyTextEditOps, flattenTextBody, textBodyFromOverride } from '../text-model';
import { assertDataObject, assertTextPosition, own } from '../data-validation';
import { assertRunPropertyOverrides } from '../run-property-schema';
import type { EditDoc, TextFragment, TextOverride } from '../types';
import type { CommandPatches, EditTextCommand } from './types';

function assertFragment(value: unknown, label: string): asserts value is TextFragment {
  assertDataObject(value, ['paragraphs'], label);
  const paragraphs = (value as TextFragment).paragraphs;
  if (!Array.isArray(paragraphs) || !paragraphs.length) throw new Error(`${label}.paragraphs 不能为空`);
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const paragraphLabel = `${label}.paragraphs[${paragraphIndex}]`;
    assertDataObject(paragraph, ['text', 'marks'], paragraphLabel);
    const data = paragraph as TextFragment['paragraphs'][number];
    if (typeof data.text !== 'string' || data.text.includes('\r') || data.text.includes('\uFFFC')) {
      throw new Error(`${paragraphLabel}.text 必须是不含 CR 与公式占位符的字符串`);
    }
    if (!Array.isArray(data.marks)) throw new Error(`${paragraphLabel}.marks 必须是数组`);
    let offset = 0;
    data.marks.forEach((mark, markIndex) => {
      const markLabel = `${paragraphLabel}.marks[${markIndex}]`;
      assertDataObject(mark, ['from', 'to', 'props'], markLabel);
      const markData = mark as TextFragment['paragraphs'][number]['marks'][number];
      if (!Number.isInteger(markData.from) || markData.from !== offset
        || !Number.isInteger(markData.to) || markData.to <= markData.from || markData.to > data.text.length) {
        throw new Error(`${markLabel} 必须连续覆盖有效文字区间`);
      }
      assertRunPropertyOverrides(markData.props, `${markLabel}.props`, true);
      offset = markData.to;
    });
    if (offset !== data.text.length) throw new Error(`${paragraphLabel}.marks 必须完整覆盖文字`);
  });
}

function assertOps(command: EditTextCommand): void {
  if (!Array.isArray(command.ops) || !command.ops.length) throw new Error('EditText 至少需要一个操作');
  command.ops.forEach((input, index) => {
    const op = input as unknown as Record<string, unknown>;
    if (op?.type === 'replace') {
      assertDataObject(op, ['type', 'from', 'to', 'text'], `EditText.ops[${index}]`);
      assertTextPosition(op.from, `EditText.ops[${index}].from`);
      assertTextPosition(op.to, `EditText.ops[${index}].to`);
      if (typeof op.text !== 'string') throw new Error(`EditText.ops[${index}].text 必须是字符串`);
      return;
    }
    if (op?.type === 'splitParagraph' || op?.type === 'insertLineBreak') {
      assertDataObject(op, ['type', 'at'], `EditText.ops[${index}]`);
      assertTextPosition(op.at, `EditText.ops[${index}].at`);
      return;
    }
    if (op?.type === 'replaceFragment') {
      assertDataObject(op, ['type', 'from', 'to', 'fragment'], `EditText.ops[${index}]`);
      assertTextPosition(op.from, `EditText.ops[${index}].from`);
      assertTextPosition(op.to, `EditText.ops[${index}].to`);
      assertFragment(op.fragment, `EditText.ops[${index}].fragment`);
      return;
    }
    throw new Error(`EditText.ops[${index}] 的类型无效`);
  });
}

function sourceBody(doc: EditDoc, command: EditTextCommand) {
  const record = doc.elements[command.id];
  if (!record || record.src.kind !== 'shape' || (!record.src.text && !record.meta.textTemplate)) {
    throw new Error(`找不到可编辑文字的形状：${command.id}`);
  }
  if (record.meta.editable !== 'full') throw new Error(`元素 ${command.id} 的文字不可编辑`);
  assertOps(command);
  return { record, body: record.ovr.text?.kind === 'flat'
    ? textBodyFromOverride(record.ovr.text)
    : (record.src.text ?? record.meta.textTemplate!) };
}

export function editTextPatches(
  doc: EditDoc,
  command: EditTextCommand,
  origin: string,
): CommandPatches {
  const { record, body } = sourceBody(doc, command);
  const before = record.ovr.text;
  const value: TextOverride = applyTextEditOps(
    body, command.ops, before?.kind === 'flat' ? before : undefined,
  );
  const baseline = before?.kind === 'flat' ? before : flattenTextBody(body);
  if (JSON.stringify(value) === JSON.stringify(baseline)) return { forward: [], inverse: [] };
  const path = ['elements', command.id, 'ovr', 'text'] as const;
  return {
    forward: [{ op: 'set', path, value, origin }],
    inverse: [own(record.ovr, 'text') && before
      ? { op: 'set', path, value: before, origin }
      : { op: 'del', path, origin }],
  };
}
