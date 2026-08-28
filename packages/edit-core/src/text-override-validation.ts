import type {
  ParagraphProperties, ParagraphPropertyOverrides, TextOverride,
} from './types';
import { assertDataObject } from './data-validation';
import {
  assertParagraphPropertyOverrides, PARAGRAPH_ALIGNMENTS, PARAGRAPH_PROPERTY_FIELDS,
} from './paragraph-property-schema';
import { TEXT_ATOM } from './text-position';
import { assertTextBodyPropertyOverrides } from './body-property-schema';
import { assertRunPropertyOverrides } from './run-property-schema';

function validateParagraphOverrides(value: ParagraphPropertyOverrides): void {
  assertParagraphPropertyOverrides(value, '段落格式覆盖');
}

function validateInherited(value: ParagraphProperties): void {
  assertDataObject(value, PARAGRAPH_PROPERTY_FIELDS, '继承段落格式');
  if (Reflect.ownKeys(value).length !== PARAGRAPH_PROPERTY_FIELDS.length
    || PARAGRAPH_PROPERTY_FIELDS.some((field) => !(field in value))) {
    throw new Error('继承段落格式字段不完整');
  }
  if (!PARAGRAPH_ALIGNMENTS.includes(value.align)) throw new Error('继承段落对齐无效');
  for (const field of PARAGRAPH_PROPERTY_FIELDS.slice(1)) {
    const fieldValue = value[field];
    if (fieldValue !== null && (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue))) {
      throw new Error(`继承段落格式 ${field} 无效`);
    }
    if (field === 'level' && fieldValue !== null
      && (!Number.isInteger(fieldValue) || fieldValue < 0 || fieldValue > 8)) {
      throw new Error('继承段落格式 level 无效');
    }
  }
}

function validateDirect(value: Readonly<Partial<Record<keyof ParagraphProperties, true>>>): void {
  assertDataObject(value, PARAGRAPH_PROPERTY_FIELDS, '直接段落格式索引');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !PARAGRAPH_PROPERTY_FIELDS.includes(key as keyof ParagraphProperties)
      || value[key as keyof ParagraphProperties] !== true) {
      throw new Error(`直接段落格式索引无效：${String(key)}`);
    }
  }
}

export function validateFlatTextOverride(
  override: Extract<TextOverride, { kind: 'flat' }>,
): void {
  if (!override.body || !Array.isArray(override.paragraphs) || !override.paragraphs.length) {
    throw new Error('扁平文本覆盖至少需要一个段落');
  }
  if (override.bodyOverrides) {
    assertTextBodyPropertyOverrides(override.bodyOverrides, '文字框属性覆盖');
  }
  for (const paragraph of override.paragraphs) {
    if (!paragraph || typeof paragraph !== 'object'
      || typeof paragraph.text !== 'string' || !Array.isArray(paragraph.marks)) {
      throw new Error('扁平文本段落无效');
    }
    if (paragraph.paragraphOverrides) validateParagraphOverrides(paragraph.paragraphOverrides);
    if (paragraph.inheritedParagraphProps) validateInherited(paragraph.inheritedParagraphProps);
    if (paragraph.directParagraphProps) validateDirect(paragraph.directParagraphProps);
    let offset = 0;
    for (const mark of paragraph.marks) {
      if (!Number.isInteger(mark.from) || !Number.isInteger(mark.to)
        || mark.from !== offset || mark.to < mark.from || mark.to > paragraph.text.length) {
        throw new Error('文字格式区间必须连续覆盖段落');
      }
      if (mark.atomText !== undefined
        && (mark.to - mark.from !== 1 || paragraph.text.slice(mark.from, mark.to) !== TEXT_ATOM)) {
        throw new Error('公式标记必须覆盖单个原子');
      }
      if (mark.runOverrides) {
        assertRunPropertyOverrides(mark.runOverrides, '文字字符格式覆盖');
      }
      offset = mark.to;
    }
    if (offset !== paragraph.text.length || (!paragraph.marks.length && paragraph.text.length)) {
      throw new Error('文字格式区间没有完整覆盖段落');
    }
  }
}

export function validateEmptyTextOverride(
  override: Extract<TextOverride, { kind: 'empty' }>,
): void {
  assertDataObject(override, ['kind', 'body', 'bodyOverrides'], '空文字覆盖');
  if (override.bodyOverrides && !override.body) throw new Error('空文字覆盖缺少文字框属性正文');
  if (override.bodyOverrides) {
    assertTextBodyPropertyOverrides(override.bodyOverrides, '文字框属性覆盖');
  }
}
