import { attr, kid, walk } from '../xml';
import type { ColorCtx } from './color';
import { extractLstStyle } from './text';
import type { LevelStyles, ThemeFonts } from './text';

export type Rels = Record<string, { type: string; target: string }>;

export interface PptxPackageReader {
  xml(path: string): Element | null;
  rels(partPath: string): Rels;
  blobUrl(path: string, mime: string): string | null;
  mediaUrl(path: string): string | null;
}

export interface Theme {
  colors: Record<string, string>;
  fonts: ThemeFonts;
  fillStyles: Element[];
  lnStyles: Element[];
  effectStyles: Element[];
  bgFillStyles: Element[];
}

export interface PhInfo {
  type: string | null;
  idx: string | null;
  sp: Element;
}

export interface Env {
  pkg: PptxPackageReader;
  ctx: ColorCtx;
  theme: Theme;
  rels: Rels;
  partPath: string;
  docDefaults: LevelStyles;
  masterStyles: { title: LevelStyles; body: LevelStyles; other: LevelStyles };
  layoutPh: PhInfo[];
  masterPh: PhInfo[];
  slideNum: number;
  tableStyles: Element | null;
  hiddenPh: Set<string>;
  slideIdMap: Record<string, number>;
  edit: boolean;
}

export interface SlideInheritance {
  layoutPath: string | null;
  layoutRoot: Element | null;
  masterPath: string | null;
  masterRoot: Element | null;
  masterTree: Element | null;
  layoutTree: Element | null;
  envFor: (partPath: string | null, phAware: boolean) => Env;
}

export function relByType(rels: Rels, suffix: string): string | null {
  for (const relationship of Object.values(rels)) {
    if (relationship.type.endsWith(suffix)) return relationship.target;
  }
  return null;
}

function parseTheme(root: Element | null): Theme {
  const colors: Record<string, string> = {};
  const scheme = walk(root, 'themeElements', 'clrScheme');
  if (scheme) {
    for (let current = scheme.firstElementChild; current; current = current.nextElementSibling) {
      const color = current.firstElementChild;
      if (!color) continue;
      colors[current.localName] = color.localName === 'srgbClr'
        ? (attr(color, 'val') ?? '000000')
        : (attr(color, 'lastClr') ?? (attr(color, 'val') === 'window' ? 'FFFFFF' : '000000'));
    }
  }
  const fontScheme = walk(root, 'themeElements', 'fontScheme');
  const font = (name: string): { latin: string | null; ea: string | null; cs: string | null } => {
    const source = kid(fontScheme, name);
    return {
      latin: attr(kid(source, 'latin'), 'typeface') || null,
      ea: attr(kid(source, 'ea'), 'typeface') || null,
      cs: attr(kid(source, 'cs'), 'typeface') || null,
    };
  };
  const format = walk(root, 'themeElements', 'fmtScheme');
  const elements = (name: string): Element[] => {
    const out: Element[] = [];
    for (let current = kid(format, name)?.firstElementChild ?? null;
      current; current = current.nextElementSibling) out.push(current);
    return out;
  };
  return {
    colors,
    fonts: { major: font('majorFont'), minor: font('minorFont') },
    fillStyles: elements('fillStyleLst'),
    lnStyles: elements('lnStyleLst'),
    effectStyles: elements('effectStyleLst'),
    bgFillStyles: elements('bgFillStyleLst'),
  };
}

function collectPh(tree: Element | null): PhInfo[] {
  const out: PhInfo[] = [];
  for (const shape of Array.from(tree?.children ?? []).filter((node) => node.localName === 'sp')) {
    const placeholder = walk(shape, 'nvSpPr', 'nvPr', 'ph');
    if (placeholder) {
      out.push({ type: attr(placeholder, 'type'), idx: attr(placeholder, 'idx'), sp: shape });
    }
  }
  return out;
}

export const PH_EQUIV: Readonly<Record<string, readonly string[]>> = {
  title: ['title', 'ctrTitle'], ctrTitle: ['ctrTitle', 'title'],
  body: ['body', 'subTitle', 'obj'], subTitle: ['subTitle', 'body'], obj: ['obj', 'body'],
};

export function findPh(list: PhInfo[], type: string | null, idx: string | null): Element | null {
  if (idx !== null) {
    const matched = list.find((placeholder) => placeholder.idx === idx);
    if (matched) return matched.sp;
  }
  if (type) {
    for (const candidate of PH_EQUIV[type] ?? [type]) {
      const matched = list.find((placeholder) => placeholder.type === candidate);
      if (matched) return matched.sp;
    }
  }
  if (!type && idx === null) return list.find((placeholder) => placeholder.type === 'body')?.sp ?? null;
  return null;
}

export function slideInheritance(
  pkg: PptxPackageReader,
  slideRoot: Element | null,
  layoutPath: string | null,
  presentationRoot: Element,
  docDefaults: LevelStyles,
  tableStyles: Element | null,
  slideIdMap: Record<string, number>,
  slideNum: number,
  edit: boolean,
): SlideInheritance {
  const layoutRoot = layoutPath ? pkg.xml(layoutPath) : null;
  const layoutRels = layoutPath ? pkg.rels(layoutPath) : {};
  const masterPath = layoutPath ? relByType(layoutRels, '/slideMaster') : null;
  const masterRoot = masterPath ? pkg.xml(masterPath) : null;
  const masterRels = masterPath ? pkg.rels(masterPath) : {};
  const themePath = masterPath ? relByType(masterRels, '/theme') : null;
  const theme = parseTheme(themePath ? pkg.xml(themePath) : null);
  const clrMap: Record<string, string> = {};
  const clrMapElement = kid(masterRoot, 'clrMap');
  if (clrMapElement) {
    for (const attribute of Array.from(clrMapElement.attributes)) clrMap[attribute.localName] = attribute.value;
  }
  const override = walk(slideRoot, 'clrMapOvr', 'overrideClrMapping')
    ?? walk(layoutRoot, 'clrMapOvr', 'overrideClrMapping');
  if (override) for (const attribute of Array.from(override.attributes)) clrMap[attribute.localName] = attribute.value;
  const ctx: ColorCtx = { theme: theme.colors, clrMap };
  if (!docDefaults.def && !docDefaults.lvls.length) {
    const defaults = extractLstStyle(kid(presentationRoot, 'defaultTextStyle'), ctx, theme.fonts);
    docDefaults.def = defaults.def;
    docDefaults.lvls = defaults.lvls;
  }
  const textStyles = kid(masterRoot, 'txStyles');
  const masterStyles = {
    title: extractLstStyle(kid(textStyles, 'titleStyle'), ctx, theme.fonts),
    body: extractLstStyle(kid(textStyles, 'bodyStyle'), ctx, theme.fonts),
    other: extractLstStyle(kid(textStyles, 'otherStyle'), ctx, theme.fonts),
  };
  const masterTree = walk(masterRoot, 'cSld', 'spTree');
  const layoutTree = walk(layoutRoot, 'cSld', 'spTree');
  const layoutPh = collectPh(layoutTree);
  const masterPh = collectPh(masterTree);
  const hiddenPh = new Set<string>();
  const headerFooter = kid(layoutRoot, 'hf') ?? kid(masterRoot, 'hf');
  if (headerFooter) {
    for (const type of ['sldNum', 'ftr', 'dt', 'hdr']) {
      if (attr(headerFooter, type) === '0') hiddenPh.add(type);
    }
  }
  const envFor = (partPath: string | null, phAware: boolean): Env => ({
    pkg, ctx, theme, rels: partPath ? pkg.rels(partPath) : {}, partPath: partPath ?? '',
    docDefaults, masterStyles, layoutPh: phAware ? layoutPh : [], masterPh: phAware ? masterPh : [],
    slideNum, tableStyles, hiddenPh, slideIdMap, edit,
  });
  return { layoutPath, layoutRoot, masterPath, masterRoot, masterTree, layoutTree, envFor };
}
