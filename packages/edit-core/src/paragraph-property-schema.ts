import { assertDataObject, own } from './data-validation';
import type { ParagraphBullet, ParagraphPropertyInput, ParagraphPropertyOverrides } from './types';
import { assertDrawingColor } from './shape-fill';

export const PARAGRAPH_AUTO_NUMBER_TYPES = [
  'alphaLcParenBoth', 'alphaLcParenR', 'alphaLcPeriod',
  'alphaUcParenBoth', 'alphaUcParenR', 'alphaUcPeriod',
  'arabic1Minus', 'arabic2Minus', 'arabicDbPeriod', 'arabicDbPlain',
  'arabicParenBoth', 'arabicParenR', 'arabicPeriod', 'arabicPlain',
  'circleNumDbPlain', 'circleNumWdBlackPlain', 'circleNumWdWhitePlain',
  'ea1ChsPeriod', 'ea1ChsPlain', 'ea1ChtPeriod', 'ea1ChtPlain',
  'ea1JpnChsDbPeriod', 'ea1JpnKorPeriod', 'ea1JpnKorPlain',
  'hebrew2Minus', 'hindiAlpha1Period', 'hindiAlphaPeriod',
  'hindiNumParenR', 'hindiNumPeriod',
  'romanLcParenBoth', 'romanLcParenR', 'romanLcPeriod',
  'romanUcParenBoth', 'romanUcParenR', 'romanUcPeriod',
  'thaiAlphaParenBoth', 'thaiAlphaParenR', 'thaiAlphaPeriod',
  'thaiNumParenBoth', 'thaiNumParenR', 'thaiNumPeriod',
] as const;

export const PARAGRAPH_PROPERTY_FIELDS = [
  'align', 'lineHeight', 'spaceBefore', 'spaceAfter', 'marginLeft', 'indent', 'level',
] as const;
const PARAGRAPH_OVERRIDE_FIELDS = [...PARAGRAPH_PROPERTY_FIELDS, 'bullet'] as const;
export const PARAGRAPH_ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;

function assertParagraphProperties(
  value: ParagraphPropertyOverrides | ParagraphPropertyInput,
  label: string,
  imageMode: 'stored' | 'upload' | 'source',
): void {
  assertDataObject(value, PARAGRAPH_OVERRIDE_FIELDS, label);
  if (!PARAGRAPH_OVERRIDE_FIELDS.some((field) => own(value, field))) {
    throw new Error(`${label} 不能为空`);
  }
  if (own(value, 'align') && value.align !== null
    && !PARAGRAPH_ALIGNMENTS.includes(value.align as typeof PARAGRAPH_ALIGNMENTS[number])) {
    throw new Error(`${label}.align 无效`);
  }
  if (own(value, 'bullet') && value.bullet !== null) {
    const bullet = value.bullet;
    assertDataObject(
      bullet, ['kind', 'char', 'font', 'type', 'startAt', 'color', 'size', 'image'], `${label}.bullet`,
    );
    if (bullet.kind === 'none') {
      if (Reflect.ownKeys(bullet).length !== 1) throw new Error(`${label}.bullet none 无效`);
    } else if (bullet.kind === 'autoNum') {
      if (!PARAGRAPH_AUTO_NUMBER_TYPES.includes(bullet.type)
        || bullet.startAt !== undefined && (!Number.isInteger(bullet.startAt)
          || bullet.startAt < 1 || bullet.startAt > 32767)
        || Reflect.ownKeys(bullet).some((key) =>
          !['kind', 'type', 'startAt', 'font', 'color', 'size'].includes(String(key)))) {
        throw new Error(`${label}.bullet 自动编号无效`);
      }
    } else if (bullet.kind === 'blip') {
      assertDataObject(bullet.image, ['src', 'bytes', 'mime'], `${label}.bullet.image`);
      const image = bullet.image as { readonly src?: unknown; readonly bytes?: unknown;
        readonly mime?: unknown };
      if (imageMode === 'stored') {
        if (Reflect.ownKeys(bullet.image).length !== 1
          || typeof image.src !== 'string'
          || !/^web-ppt-resource:[0-9a-f]{64}$/.test(
            image.src,
          )) throw new Error(`${label}.bullet 图片资源无效`);
      } else if (image.src !== undefined) {
        if (Reflect.ownKeys(bullet.image).length !== 1
          || typeof image.src !== 'string' || !image.src
          || /[\u0000-\u001f]/.test(image.src)) {
          throw new Error(`${label}.bullet 图片来源无效`);
        }
      } else if (imageMode === 'source' || Reflect.ownKeys(bullet.image).length !== 2
        || !image.bytes
        || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
          String(image.mime),
        )) {
        throw new Error(`${label}.bullet 图片上传无效`);
      }
    } else if (bullet.kind !== 'char' || typeof bullet.char !== 'string' || !bullet.char
      || Array.from(bullet.char).length !== 1) {
      throw new Error(`${label}.bullet 字符项目符号无效`);
    }
    if (bullet.kind !== 'none') {
      if (bullet.font !== undefined && bullet.font !== null
        && (typeof bullet.font !== 'string' || !bullet.font.trim())) {
        throw new Error(`${label}.bullet.font 必须是非空字符串`);
      }
      if (bullet.color !== undefined && bullet.color !== null) {
        assertDrawingColor(bullet.color, `${label}.bullet.color`);
      }
      if (bullet.size !== undefined && bullet.size !== null) {
        assertDataObject(bullet.size, ['kind', 'value'], `${label}.bullet.size`);
        const { kind, value: size } = bullet.size;
        if (!['percent', 'points'].includes(kind) || typeof size !== 'number'
          || !Number.isFinite(size) || kind === 'percent' && (size < 0.25 || size > 4)
          || kind === 'points' && (size < 1 || size > 400)) {
          throw new Error(`${label}.bullet.size 无效`);
        }
      }
    }
  }
  for (const field of PARAGRAPH_PROPERTY_FIELDS.slice(1)) {
    const fieldValue = value[field];
    if (!own(value, field) || fieldValue === null) continue;
    if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
      throw new Error(`${label}.${field} 必须是有限数或 null`);
    }
    if (field === 'level' && (!Number.isInteger(fieldValue) || fieldValue < 0 || fieldValue > 8)) {
      throw new Error(`${label}.level 必须是 0–8 的整数或 null`);
    }
    if (field === 'lineHeight' && fieldValue < 0.5) throw new Error(`${label}.lineHeight 不能小于 0.5`);
    if (field !== 'indent' && field !== 'level' && fieldValue < 0) {
      throw new Error(`${label}.${field} 不能为负数`);
    }
  }
}

export function assertParagraphPropertyOverrides(
  value: ParagraphPropertyOverrides,
  label: string,
): void {
  assertParagraphProperties(value, label, 'stored');
}

export function assertParagraphPropertyInput(
  value: ParagraphPropertyInput,
  label: string,
): void {
  assertParagraphProperties(value, label, 'upload');
}

export function assertSourceParagraphBullet(value: ParagraphBullet, label: string): void {
  assertParagraphProperties({ bullet: value }, label, 'source');
}
