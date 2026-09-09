import { sourcePartBytes } from '@web-ppt/edit-core';
import type { ChartEnv } from '@web-ppt/core';
import type { EditDoc, ElementId } from '../types';
import { findXmlAttribute, parseXmlTree, xmlElementChildren } from '@web-ppt/edit-core/xml';
import { isPresentationNamespace, PACKAGE_REL_NS } from './xml-namespaces';

export const chartSourceBytes = sourcePartBytes;

export type ChartRelationships = Record<string, { type: string; target: string; external?: true }>;
const relationshipCache = new WeakMap<Uint8Array, Map<string, ChartRelationships>>();

const DEFAULT_COLOR_MAP: Record<string, string> = {
  bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2',
  accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4',
  accent5: 'accent5', accent6: 'accent6', hlink: 'hlink', folHlink: 'folHlink',
};

export function chartRelationshipPart(part: string): string {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const stack = base.slice(0, base.lastIndexOf('/') + 1).split('/').filter(Boolean);
  for (const segment of target.split('/')) {
    if (segment === '..') stack.pop();
    else if (segment && segment !== '.') stack.push(segment);
  }
  return stack.join('/');
}

export function chartRelationships(doc: EditDoc, part: string): ChartRelationships {
  const bytes = chartSourceBytes(doc, chartRelationshipPart(part));
  if (!bytes) return {};
  let entries = relationshipCache.get(bytes);
  if (!entries) { entries = new Map(); relationshipCache.set(bytes, entries); }
  const cached = entries.get(part);
  if (cached) return cached;
  const result: ChartRelationships = Object.create(null);
  for (const node of xmlElementChildren(parseXmlTree(bytes).root, {
    localName: 'Relationship', namespaceUri: PACKAGE_REL_NS,
  })) {
    const id = findXmlAttribute(node, { localName: 'Id', namespaceUri: null })?.value;
    const type = findXmlAttribute(node, { localName: 'Type', namespaceUri: null })?.value;
    const target = findXmlAttribute(node, { localName: 'Target', namespaceUri: null })?.value;
    const external = findXmlAttribute(node, {
      localName: 'TargetMode', namespaceUri: null,
    })?.value === 'External';
    if (id && type && target) result[id] = { type, target: external ? target : resolvePart(part, target), ...(external ? { external: true as const } : {}) };
  }
  entries.set(part, result);
  return result;
}

function owningSlide(doc: EditDoc, id: ElementId) {
  let parent: string | undefined = doc.elements[id]?.parent;
  while (parent && doc.elements[parent]) parent = doc.elements[parent].parent;
  return parent ? doc.slides[parent] : undefined;
}

const hex = (color: string): string => {
  const values = color.match(/rgba?\(([^)]+)\)/)?.[1].split(',').slice(0, 3)
    .map((value) => Math.max(0, Math.min(255, Math.round(Number(value.trim())))));
  return values?.length === 3 && values.every(Number.isFinite)
    ? values.map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()
    : color.replace('#', '');
};

export function chartRenderContext(doc: EditDoc, id: ElementId, part: string): ChartEnv {
  const slide = owningSlide(doc, id);
  const layout = slide?.layoutId ? doc.layouts[slide.layoutId] : undefined;
  const master = layout ? doc.masters[layout.origin.masterPart] : undefined;
  const themeId = layout?.themeId ?? master?.themeId;
  const theme = themeId ? doc.themes[themeId] : undefined;
  const colors = { ...theme?.src.colors, ...theme?.ovr.colors };
  const fonts = structuredClone(theme?.src.fonts ?? {
    major: { latin: '', ea: '', cs: '', scripts: {} },
    minor: { latin: '', ea: '', cs: '', scripts: {} },
  });
  for (const family of ['major', 'minor'] as const) {
    Object.assign(fonts[family], theme?.ovr.fonts?.[family]);
  }
  const clrMap = { ...DEFAULT_COLOR_MAP };
  const masterBytes = master && chartSourceBytes(doc, master.id);
  const masterRoot = masterBytes ? parseXmlTree(masterBytes).root : null;
  const map = masterRoot && isPresentationNamespace(masterRoot.namespaceUri)
    ? xmlElementChildren(masterRoot).find((item) =>
      item.localName === 'clrMap' && item.namespaceUri === masterRoot.namespaceUri)
    : null;
  for (const attribute of map?.attributes ?? []) clrMap[attribute.localName] = attribute.value;
  return {
    ctx: { theme: Object.fromEntries(Object.entries(colors).map(([key, value]) => [key, hex(value)])), clrMap },
    fonts,
    rels: structuredClone(chartRelationships(doc, part)),
  };
}
