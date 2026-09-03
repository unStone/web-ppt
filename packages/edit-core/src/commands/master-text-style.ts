import type { MasterTextCategory } from '@web-ppt/core';
import { assertDataObject, own } from '../data-validation';
import { assertParagraphPropertyInput, assertParagraphPropertyOverrides } from '../paragraph-property-schema';
import { assertRunPropertyOverrides } from '../run-property-schema';
import type {
  EditDoc,
} from '../types';
import type { CommandPatches, Patch } from './types';
import type { MasterTextStylePatch, SetMasterTextStyleCommand } from './master-text-style-types';

const CATEGORIES = ['title', 'body', 'other'] as const;

export function isMasterTextStylePatch(patch: Patch): patch is MasterTextStylePatch {
  return patch.path.length === 8 && patch.path[0] === 'masters' && patch.path[2] === 'ovr'
    && patch.path[3] === 'textStyles'
    && CATEGORIES.includes(patch.path[4] as MasterTextCategory)
    && Number.isInteger(patch.path[5]) && Number(patch.path[5]) >= 0 && Number(patch.path[5]) <= 8
    && (patch.path[6] === 'paragraph' || patch.path[6] === 'run');
}

function sameValue(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}

function fieldPatches(
  masterId: string,
  category: MasterTextCategory,
  level: number,
  section: 'paragraph' | 'run',
  input: object,
  previous: object | undefined,
  origin: string,
): { forward: MasterTextStylePatch; inverse: MasterTextStylePatch }[] {
  const pairs: { forward: MasterTextStylePatch; inverse: MasterTextStylePatch }[] = [];
  for (const field of Object.keys(input)) {
    const next = (input as Record<string, unknown>)[field];
    const before = (previous as Record<string, unknown> | undefined)?.[field];
    if (next === null && before === undefined || next !== null && sameValue(next, before)) continue;
    const path = ['masters', masterId, 'ovr', 'textStyles', category, level, section, field] as const;
    const forward = next === null
      ? { op: 'del' as const, path, origin }
      : { op: 'set' as const, path, value: structuredClone(next), origin };
    const inverse = before === undefined
      ? { op: 'del' as const, path, origin }
      : { op: 'set' as const, path, value: structuredClone(before), origin };
    pairs.push({
      forward: forward as MasterTextStylePatch,
      inverse: inverse as MasterTextStylePatch,
    });
  }
  return pairs;
}

export function setMasterTextStylePatches(
  doc: EditDoc,
  command: SetMasterTextStyleCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能编辑母版文字默认值');
  assertDataObject(command.target, ['kind', 'id'], 'SetMasterTextStyle.target');
  if (command.target.kind !== 'master' || !doc.masters[command.target.id]) {
    throw new Error(`找不到母版：${String(command.target.id)}`);
  }
  if (!CATEGORIES.includes(command.category)) throw new Error(`未知母版文字类别：${String(command.category)}`);
  if (!Number.isInteger(command.level) || command.level < 0 || command.level > 8) {
    throw new Error('SetMasterTextStyle.level 必须是 0–8 的整数');
  }
  if (command.paragraph === undefined && command.run === undefined) {
    throw new Error('SetMasterTextStyle 至少需要 paragraph 或 run');
  }
  if (command.paragraph !== undefined) {
    assertParagraphPropertyInput(command.paragraph, 'SetMasterTextStyle.paragraph');
    if (own(command.paragraph, 'level')) throw new Error('母版文字层级只能由 level 指定');
    if (command.paragraph.bullet?.kind === 'blip') {
      throw new Error('母版文字默认值暂不接受图片项目符号');
    }
  }
  if (command.run !== undefined) {
    assertRunPropertyOverrides(command.run, 'SetMasterTextStyle.run');
    if (own(command.run, 'link')) throw new Error('母版文字默认值不接受超链接');
  }
  const before = doc.masters[command.target.id].ovr.textStyles?.[command.category]?.[command.level];
  const pairs = [
    ...(command.paragraph === undefined ? [] : fieldPatches(
      command.target.id, command.category, command.level, 'paragraph', command.paragraph,
      before?.paragraph, origin,
    )),
    ...(command.run === undefined ? [] : fieldPatches(
      command.target.id, command.category, command.level, 'run', command.run,
      before?.run, origin,
    )),
  ];
  return { forward: pairs.map(({ forward }) => forward), inverse: pairs.map(({ inverse }) => inverse).reverse() };
}

export function validateMasterTextStylePatch(
  doc: EditDoc,
  patch: MasterTextStylePatch,
  index: number,
): void {
  assertDataObject(
    patch,
    patch.op === 'set' ? ['op', 'path', 'value', 'origin'] : ['op', 'path', 'origin'],
    `Patch ${index}`,
  );
  const [, masterId, , , category, level, section, field] = patch.path;
  if (!doc.masters[masterId] || !CATEGORIES.includes(category)
    || !Number.isInteger(level) || level < 0 || level > 8) {
    throw new Error(`Patch ${index} 指向无效母版文字层级`);
  }
  if (section === 'paragraph') {
    if ((field as string) === 'level') throw new Error(`Patch ${index} 不能覆盖母版段落层级身份`);
    const input = { [field]: patch.op === 'set' ? patch.value : null };
    assertParagraphPropertyOverrides(input, `Patch ${index}.value`);
    const bullet = (input as { readonly bullet?: { readonly kind?: string } }).bullet;
    if (bullet?.kind === 'blip') throw new Error(`Patch ${index} 不支持母版图片项目符号`);
  } else {
    if ((field as string) === 'link') throw new Error(`Patch ${index} 不能写入母版文字超链接`);
    assertRunPropertyOverrides(
      { [field]: patch.op === 'set' ? patch.value : null }, `Patch ${index}.value`,
    );
  }
}

function prune(record: EditDoc['masters'][string], category: MasterTextCategory, level: number): void {
  const overrides = record.ovr.textStyles;
  const levelValue = overrides?.[category]?.[level];
  if (levelValue?.paragraph && !Object.keys(levelValue.paragraph).length) delete levelValue.paragraph;
  if (levelValue?.run && !Object.keys(levelValue.run).length) delete levelValue.run;
  if (levelValue && !Object.keys(levelValue).length) delete overrides?.[category]?.[level];
  if (overrides?.[category] && !Object.keys(overrides[category]!).length) delete overrides[category];
  if (overrides && !Object.keys(overrides).length) delete record.ovr.textStyles;
}

export function applyMasterTextStylePatch(doc: EditDoc, patch: MasterTextStylePatch): void {
  const [, masterId, , , category, level, section, field] = patch.path;
  const record = doc.masters[masterId];
  const levelValue = (((record.ovr.textStyles ??= {})[category] ??= {})[level] ??= {});
  const fields = ((levelValue[section] ??= {}) as Record<string, unknown>);
  if (patch.op === 'set') fields[field] = structuredClone(patch.value);
  else delete fields[field];
  prune(record, category, level);
}
