import type { PresentationTheme, ThemeColorScheme, ThemeFontCollection } from '../types';
import type { Scheme } from './escher';

const rgb = (hex: string | undefined): string => {
  const value = (hex ?? '000000').padStart(6, '0');
  return `rgb(${parseInt(value.slice(0, 2), 16) || 0},${parseInt(value.slice(2, 4), 16) || 0},${parseInt(value.slice(4, 6), 16) || 0})`;
};

const fontCollection = (latin: string, ea: string): ThemeFontCollection => ({
  latin, ea, cs: '', scripts: {},
});

/** 旧格式只有 8 个语义色槽；映射到 12 槽时复用最接近的旧槽，不凭空创造新配色。 */
export function legacyPresentationTheme(
  scheme: Scheme,
  fonts: { majorLatin: string; majorEa: string; minorLatin: string; minorEa: string },
): PresentationTheme {
  const colors: ThemeColorScheme = {
    lt1: rgb(scheme[0]), dk1: rgb(scheme[1]),
    lt2: rgb(scheme[2]), dk2: rgb(scheme[3]),
    accent1: rgb(scheme[4]), accent2: rgb(scheme[5]),
    accent3: rgb(scheme[2]), accent4: rgb(scheme[3]),
    accent5: rgb(scheme[6]), accent6: rgb(scheme[7]),
    hlink: rgb(scheme[6]), folHlink: rgb(scheme[7]),
  };
  return {
    id: 'ppt:theme:1', name: 'PowerPoint 97-2003', colors,
    fonts: {
      major: fontCollection(fonts.majorLatin, fonts.majorEa),
      minor: fontCollection(fonts.minorLatin, fonts.minorEa),
    },
  };
}
