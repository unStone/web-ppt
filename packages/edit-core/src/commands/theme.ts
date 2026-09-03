import { THEME_COLOR_SLOTS } from '@web-ppt/core';
import { assertDataObject, own } from '../data-validation';
import {
  assertThemeColor, assertThemeFont, isThemeColorSlot, normalizeThemeColor,
} from '../theme';
import type { EditDoc, ThemeFontCollectionOverrides } from '../types';
import type { CommandPatches } from './types';
import type {
  SetThemeCommand, ThemeColorPatch, ThemeFontPatch, ThemePatch,
} from './theme-types';

const FONT_FIELDS = ['latin', 'ea', 'cs'] as const;

export function isThemePatch(patch: { readonly path: readonly unknown[] }): patch is ThemePatch {
  return patch.path[0] === 'themes' && patch.path[2] === 'ovr'
    && (patch.path[3] === 'colors' || patch.path[3] === 'fonts');
}

function commandPatch<P extends ThemePatch>(
  path: P['path'],
  value: string | null,
  previous: string | undefined,
  origin: string,
): { forward: ThemePatch; inverse: ThemePatch } | null {
  if (value === null && previous === undefined) return null;
  if (value !== null && value === previous) return null;
  const forward = value === null
    ? { op: 'del' as const, path, origin }
    : { op: 'set' as const, path, value, origin };
  const inverse = previous === undefined
    ? { op: 'del' as const, path, origin }
    : { op: 'set' as const, path, value: previous, origin };
  return { forward: forward as ThemePatch, inverse: inverse as ThemePatch };
}

function assertFontCommand(value: unknown, label: string): void {
  assertDataObject(value, [...FONT_FIELDS, 'scripts'], label);
  const font = value as NonNullable<SetThemeCommand['fontScheme']>['major'];
  for (const field of FONT_FIELDS) {
    const next = font?.[field];
    if (next !== undefined && next !== null) assertThemeFont(next, `${label}.${field}`);
  }
  if (font?.scripts === undefined) return;
  assertDataObject(font.scripts, Object.keys(font.scripts), `${label}.scripts`);
  for (const [script, typeface] of Object.entries(font.scripts)) {
    if (!/^[A-Za-z]{4}$/.test(script)) throw new Error(`${label}.scripts 的脚本代码无效：${script}`);
    if (typeface !== null) assertThemeFont(typeface, `${label}.scripts.${script}`);
  }
}

export function setThemePatches(
  doc: EditDoc,
  command: SetThemeCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly || doc.meta.source !== 'pptx' || !doc.package) {
    throw new Error('只读或非 OOXML 编辑文档不能编辑主题');
  }
  const record = doc.themes[command.id];
  if (!record) throw new Error(`找不到主题：${String(command.id)}`);
  if (command.clrScheme === undefined && command.fontScheme === undefined) {
    throw new Error('SetTheme 至少需要 clrScheme 或 fontScheme');
  }
  const pairs: { forward: ThemePatch; inverse: ThemePatch }[] = [];
  if (command.clrScheme !== undefined) {
    assertDataObject(command.clrScheme, THEME_COLOR_SLOTS, 'SetTheme.clrScheme');
    for (const [slotText, input] of Object.entries(command.clrScheme)) {
      if (!isThemeColorSlot(slotText)) throw new Error(`未知主题色槽：${slotText}`);
      if (input !== null) assertThemeColor(input, `SetTheme.clrScheme.${slotText}`);
      const next = input === null ? null : normalizeThemeColor(input);
      const path = ['themes', record.id, 'ovr', 'colors', slotText] as const;
      const pair = commandPatch<ThemeColorPatch>(path, next, record.ovr.colors?.[slotText], origin);
      if (pair) pairs.push(pair);
    }
  }
  if (command.fontScheme !== undefined) {
    assertDataObject(command.fontScheme, ['major', 'minor'], 'SetTheme.fontScheme');
    for (const role of ['major', 'minor'] as const) {
      const font = command.fontScheme[role];
      if (font === undefined) continue;
      assertFontCommand(font, `SetTheme.fontScheme.${role}`);
      const previous = record.ovr.fonts?.[role];
      for (const field of FONT_FIELDS) {
        if (!own(font, field)) continue;
        const path = ['themes', record.id, 'ovr', 'fonts', role, field] as const;
        const pair = commandPatch<ThemeFontPatch>(path, font[field] ?? null, previous?.[field], origin);
        if (pair) pairs.push(pair);
      }
      for (const [script, typeface] of Object.entries(font.scripts ?? {})) {
        const path = ['themes', record.id, 'ovr', 'fonts', role, 'scripts', script] as const;
        const pair = commandPatch<ThemeFontPatch>(path, typeface, previous?.scripts?.[script], origin);
        if (pair) pairs.push(pair);
      }
    }
  }
  return { forward: pairs.map((pair) => pair.forward), inverse: pairs.map((pair) => pair.inverse).reverse() };
}

export function validateThemePatch(doc: EditDoc, patch: ThemePatch, index: number): void {
  const expectedLength = patch.path[3] === 'colors' ? 5 : patch.path[5] === 'scripts' ? 7 : 6;
  assertDataObject(
    patch,
    patch.op === 'set' ? ['op', 'path', 'value', 'origin'] : ['op', 'path', 'origin'],
    `Patch ${index}`,
  );
  if (patch.path.length !== expectedLength || !own(doc.themes, patch.path[1])) {
    throw new Error(`Patch ${index} 指向无效主题字段`);
  }
  if (patch.path[3] === 'colors') {
    if (!isThemeColorSlot(patch.path[4])) throw new Error(`Patch ${index} 指向未知主题色槽`);
    if (patch.op === 'set') assertThemeColor(patch.value, `Patch ${index}.value`);
    return;
  }
  const role = patch.path[4];
  if (role !== 'major' && role !== 'minor') throw new Error(`Patch ${index} 的主题字体集合无效`);
  if (patch.path[5] === 'scripts') {
    if (!/^[A-Za-z]{4}$/.test(patch.path[6])) throw new Error(`Patch ${index} 的脚本代码无效`);
  } else if (!FONT_FIELDS.includes(patch.path[5])) {
    throw new Error(`Patch ${index} 的主题字体字段无效`);
  }
  if (patch.op === 'set') assertThemeFont(patch.value, `Patch ${index}.value`);
}

function pruneFont(record: EditDoc['themes'][string], role: 'major' | 'minor'): void {
  const font = record.ovr.fonts?.[role];
  if (font?.scripts && !Object.keys(font.scripts).length) delete font.scripts;
  if (font && !Reflect.ownKeys(font).length) delete record.ovr.fonts?.[role];
  if (record.ovr.fonts && !Reflect.ownKeys(record.ovr.fonts).length) delete record.ovr.fonts;
}

export function applyThemePatch(doc: EditDoc, patch: ThemePatch): void {
  const record = doc.themes[patch.path[1]];
  if (patch.path[3] === 'colors') {
    if (patch.op === 'set') (record.ovr.colors ??= {})[patch.path[4]] = patch.value;
    else {
      delete record.ovr.colors?.[patch.path[4]];
      if (record.ovr.colors && !Object.keys(record.ovr.colors).length) delete record.ovr.colors;
    }
    return;
  }
  const role = patch.path[4];
  const font = ((record.ovr.fonts ??= {})[role] ??= {}) as ThemeFontCollectionOverrides;
  if (patch.path[5] === 'scripts') {
    if (patch.op === 'set') (font.scripts ??= {})[patch.path[6]] = patch.value;
    else delete font.scripts?.[patch.path[6]];
  } else if (patch.op === 'set') font[patch.path[5]] = patch.value;
  else delete font[patch.path[5]];
  pruneFont(record, role);
}
