import { THEME_COLOR_SLOTS } from '@web-ppt/core';
import type {
  ThemeColorScheme, ThemeColorSlot, ThemeFontCollection, ThemeFontScheme,
} from '@web-ppt/core';
import { assertDataObject, own } from './data-validation';
import { assertDrawingColor, normalizeDrawingColor } from './shape-fill';
import type {
  EditDoc, ThemeFontCollectionOverrides, ThemeOverrides, ThemeRecord, ThemeState,
} from './types';

const colorSlots = new Set<string>(THEME_COLOR_SLOTS);
const FONT_FIELDS = ['latin', 'ea', 'cs'] as const;

function effectiveFont(
  source: ThemeFontCollection,
  override: ThemeFontCollectionOverrides | undefined,
): ThemeFontCollection {
  return {
    latin: override?.latin ?? source.latin,
    ea: override?.ea ?? source.ea,
    cs: override?.cs ?? source.cs,
    scripts: { ...source.scripts, ...override?.scripts },
  };
}

export function effectiveTheme(record: ThemeRecord): { colors: ThemeColorScheme; fonts: ThemeFontScheme } {
  return {
    colors: { ...record.src.colors, ...record.ovr.colors },
    fonts: {
      major: effectiveFont(record.src.fonts.major, record.ovr.fonts?.major),
      minor: effectiveFont(record.src.fonts.minor, record.ovr.fonts?.minor),
    },
  };
}

export function themeHasOverrides(record: ThemeRecord): boolean {
  return !!Object.keys(record.ovr.colors ?? {}).length
    || !!Object.values(record.ovr.fonts ?? {}).some((font) =>
      FONT_FIELDS.some((field) => own(font ?? {}, field)) || !!Object.keys(font?.scripts ?? {}).length);
}

export function queryTheme(doc: EditDoc, id: string): ThemeState {
  const record = doc.themes[id];
  if (!record) throw new Error(`主题不存在：${id}`);
  const effective = effectiveTheme(record);
  return {
    id, name: record.name,
    colors: structuredClone(effective.colors),
    fonts: structuredClone(effective.fonts),
    source: structuredClone(record.src),
    mixed: false,
    direct: themeHasOverrides(record),
  };
}

export function listThemes(doc: EditDoc): ThemeState[] {
  return doc.themeOrder.map((id) => queryTheme(doc, id));
}

export function assertThemeColor(value: unknown, label: string): asserts value is string {
  assertDrawingColor(value, label);
  if (normalizeDrawingColor(value).startsWith('rgba(')) throw new Error(`${label} 不支持透明度`);
}

export function normalizeThemeColor(value: string): string {
  return normalizeDrawingColor(value);
}

export function assertThemeFont(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} 必须是不超过 256 字符的字体名`);
  }
}

export function assertThemeOverrides(value: unknown, label: string): asserts value is ThemeOverrides {
  assertDataObject(value, ['colors', 'fonts'], label);
  const input = value as ThemeOverrides;
  if (input.colors !== undefined) {
    assertDataObject(input.colors, THEME_COLOR_SLOTS, `${label}.colors`);
    for (const [slot, color] of Object.entries(input.colors)) {
      if (!colorSlots.has(slot)) throw new Error(`${label}.colors.${slot} 不是标准主题色槽`);
      assertThemeColor(color, `${label}.colors.${slot}`);
    }
  }
  if (input.fonts === undefined) return;
  assertDataObject(input.fonts, ['major', 'minor'], `${label}.fonts`);
  for (const role of ['major', 'minor'] as const) {
    const font = input.fonts[role];
    if (font === undefined) continue;
    assertDataObject(font, [...FONT_FIELDS, 'scripts'], `${label}.fonts.${role}`);
    for (const field of FONT_FIELDS) {
      if (font[field] !== undefined) assertThemeFont(font[field], `${label}.fonts.${role}.${field}`);
    }
    if (font.scripts === undefined) continue;
    assertDataObject(font.scripts, Object.keys(font.scripts), `${label}.fonts.${role}.scripts`);
    for (const [script, typeface] of Object.entries(font.scripts)) {
      if (!/^[A-Za-z]{4}$/.test(script)) throw new Error(`${label} 的脚本代码无效：${script}`);
      assertThemeFont(typeface, `${label}.fonts.${role}.scripts.${script}`);
    }
  }
}

export function isThemeColorSlot(value: string): value is ThemeColorSlot {
  return colorSlots.has(value);
}
