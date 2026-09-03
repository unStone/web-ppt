import type { ThemeColorSlot } from '@web-ppt/core';

export interface ThemeFontCommandValue {
  readonly latin?: string | null;
  readonly ea?: string | null;
  readonly cs?: string | null;
  readonly scripts?: Readonly<Record<string, string | null>>;
}

export interface SetThemeCommand {
  readonly type: 'SetTheme';
  readonly id: string;
  /** null 恢复该槽的来源值；未出现的槽保持当前覆盖。 */
  readonly clrScheme?: Readonly<Partial<Record<ThemeColorSlot, string | null>>>;
  readonly fontScheme?: {
    readonly major?: ThemeFontCommandValue;
    readonly minor?: ThemeFontCommandValue;
  };
}

export type ThemeColorPatch = {
  readonly op: 'set';
  readonly path: readonly ['themes', string, 'ovr', 'colors', ThemeColorSlot];
  readonly value: string;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['themes', string, 'ovr', 'colors', ThemeColorSlot];
  readonly origin: string;
};

export type ThemeFontPatch = {
  readonly op: 'set';
  readonly path: readonly ['themes', string, 'ovr', 'fonts', 'major' | 'minor', 'latin' | 'ea' | 'cs'];
  readonly value: string;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['themes', string, 'ovr', 'fonts', 'major' | 'minor', 'latin' | 'ea' | 'cs'];
  readonly origin: string;
} | {
  readonly op: 'set';
  readonly path: readonly ['themes', string, 'ovr', 'fonts', 'major' | 'minor', 'scripts', string];
  readonly value: string;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['themes', string, 'ovr', 'fonts', 'major' | 'minor', 'scripts', string];
  readonly origin: string;
};

export type ThemePatch = ThemeColorPatch | ThemeFontPatch;
