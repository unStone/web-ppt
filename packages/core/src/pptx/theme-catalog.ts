import type {
  PresentationTheme, ThemeColorScheme, ThemeFontCollection, ThemeFontScheme,
} from '../types';
import { THEME_COLOR_SLOTS } from '../types';
import { attr, kid, kids, walk } from '../xml';
import { parseColor, parseCssRgb } from './color';
import type { Rels } from './slide-inheritance';

const EMPTY_COLOR = 'rgb(0,0,0)';

function fontCollection(source: Element | null): ThemeFontCollection {
  const scripts: Record<string, string> = {};
  for (const font of kids(source, 'font')) {
    const script = attr(font, 'script');
    const typeface = attr(font, 'typeface');
    if (script && typeface) scripts[script] = typeface;
  }
  return {
    latin: attr(kid(source, 'latin'), 'typeface') ?? '',
    ea: attr(kid(source, 'ea'), 'typeface') ?? '',
    cs: attr(kid(source, 'cs'), 'typeface') ?? '',
    scripts,
  };
}

/** 同一份解析结果同时供公开目录与继承求值使用，避免两套主题语义悄悄漂移。 */
export function parseThemeSource(root: Element | null, id = ''): PresentationTheme {
  const scheme = walk(root, 'themeElements', 'clrScheme');
  const colors = Object.fromEntries(THEME_COLOR_SLOTS.map((slot) => {
    const color = kid(kid(scheme, slot), 'srgbClr')
      ?? kid(kid(scheme, slot), 'sysClr')
      ?? kid(kid(scheme, slot), 'prstClr')
      ?? kid(kid(scheme, slot), 'scrgbClr')
      ?? kid(kid(scheme, slot), 'hslClr');
    return [slot, color ? parseColor(color, { theme: {}, clrMap: {} }) : EMPTY_COLOR];
  })) as unknown as ThemeColorScheme;
  const fontScheme = walk(root, 'themeElements', 'fontScheme');
  const fonts: ThemeFontScheme = {
    major: fontCollection(kid(fontScheme, 'majorFont')),
    minor: fontCollection(kid(fontScheme, 'minorFont')),
  };
  return { id, name: attr(root, 'name') ?? id, colors, fonts };
}

/** 继承求值仍使用 OOXML 的六位十六进制颜色表。 */
export function themeColorsForInheritance(theme: PresentationTheme): Record<string, string> {
  return Object.fromEntries(Object.entries(theme.colors).map(([slot, color]) => {
    const [r, g, b] = parseCssRgb(color);
    return [slot, [r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()];
  }));
}

export interface ThemeCatalog {
  themes: PresentationTheme[];
  themeByMaster: Readonly<Record<string, string>>;
}

/** 主题按母版声明顺序曝光；共享主题 part 只出现一次。 */
export function parseThemeCatalog(
  presentation: Element,
  presentationRelationships: Rels,
  xml: (path: string) => Element | null,
  relationships: (path: string) => Rels,
): ThemeCatalog {
  const themes: PresentationTheme[] = [];
  const themeByMaster: Record<string, string> = {};
  const seen = new Set<string>();
  for (const masterId of kids(kid(presentation, 'sldMasterIdLst'), 'sldMasterId')) {
    const masterRid = attr(masterId, 'r:id');
    const masterPath = masterRid ? presentationRelationships[masterRid]?.target : null;
    if (!masterPath) continue;
    const theme = Object.values(relationships(masterPath)).find((rel) => rel.type.endsWith('/theme'))?.target;
    if (!theme) continue;
    themeByMaster[masterPath] = theme;
    if (seen.has(theme)) continue;
    seen.add(theme);
    themes.push(parseThemeSource(xml(theme), theme));
  }
  return { themes, themeByMaster };
}
