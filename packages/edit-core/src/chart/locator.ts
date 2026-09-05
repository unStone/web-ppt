import type { EditDoc, ElementId } from '../types';
import { findXmlAttribute, parseXmlTree, xmlElementChildren } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import { chartRelationships } from './context';
import {
  CHART_NS, DRAWING_NS, OFFICE_REL_NS, PRESENTATION_NS,
  STRICT_CHART_NS, STRICT_DRAWING_NS, STRICT_OFFICE_REL_NS, STRICT_PRESENTATION_NS,
} from './xml-namespaces';

interface LocatorCache {
  readonly package: EditDoc['package'];
  readonly entries: Map<ElementId, string | null>;
}

const cache = new WeakMap<EditDoc, LocatorCache>();
const child = (node: XmlElement | null, name: string, namespaceUri: string): XmlElement | null => {
  const matches = node ? xmlElementChildren(node).filter((item) =>
    item.localName === name && item.namespaceUri === namespaceUri) : [];
  return matches.length === 1 ? matches[0] : null;
};
const attr = (node: XmlElement | null, name: string, namespaceUri: string | null = null): string | null =>
  node ? findXmlAttribute(node, { localName: name, namespaceUri })?.value ?? null : null;

function graphicFrames(root: XmlElement, presentation: string): XmlElement[] {
  const tree = child(child(root, 'cSld', presentation), 'spTree', presentation);
  const result: XmlElement[] = [];
  const collect = (container: XmlElement | null): void => {
    if (!container) return;
    for (const item of xmlElementChildren(container)) {
      if (item.namespaceUri !== presentation) continue;
      if (item.localName === 'graphicFrame') result.push(item);
      else if (item.localName === 'grpSp') collect(item);
    }
  }
  collect(tree);
  return result;
}

function owningSlide(doc: EditDoc, id: ElementId) {
  let parent: string | undefined = doc.elements[id]?.parent;
  while (parent && doc.elements[parent]) parent = doc.elements[parent].parent;
  return parent ? doc.slides[parent] : undefined;
}

/** 图表身份由原 frame 的 spid + OPC 关系推导，默认编辑模型不为按需能力常驻字段。 */
export function chartPartForElement(doc: EditDoc, id: ElementId): string | null {
  let state = cache.get(doc);
  if (!state || state.package !== doc.package) {
    state = { package: doc.package, entries: new Map() };
    cache.set(doc, state);
  }
  const entries = state.entries;
  if (entries.has(id)) return entries.get(id) ?? null;
  const record = doc.elements[id];
  const origin = record?.meta.origin;
  if (!record || record.src.kind !== 'group' || record.meta.editable !== 'frame' || !origin) {
    entries.set(id, null);
    return null;
  }
  const sourcePart = owningSlide(doc, id)?.creation?.duplicateSourcePart ?? origin.part;
  const bytes = doc.saveState.baselines[sourcePart] ?? doc.package?.parts[sourcePart];
  if (!bytes) { entries.set(id, null); return null; }
  let result: string | null = null;
  const root = parseXmlTree(bytes).root;
  const dialect = root.namespaceUri === STRICT_PRESENTATION_NS
    ? {
      chart: STRICT_CHART_NS, drawing: STRICT_DRAWING_NS,
      presentation: STRICT_PRESENTATION_NS, relationship: STRICT_OFFICE_REL_NS,
    }
    : root.namespaceUri === PRESENTATION_NS
      ? {
        chart: CHART_NS, drawing: DRAWING_NS,
        presentation: PRESENTATION_NS, relationship: OFFICE_REL_NS,
      }
      : null;
  if (!dialect) { entries.set(id, null); return null; }
  const relationships = chartRelationships(doc, sourcePart);
  for (const frame of graphicFrames(root, dialect.presentation)) {
    const nonVisual = child(frame, 'nvGraphicFramePr', dialect.presentation);
    const cNvPr = child(nonVisual, 'cNvPr', dialect.presentation);
    const shapeId = attr(cNvPr, 'id');
    if (shapeId === null || Number(shapeId) !== origin.spid) continue;
    const graphic = child(frame, 'graphic', dialect.drawing);
    const data = child(graphic, 'graphicData', dialect.drawing);
    if (attr(data, 'uri') !== dialect.chart) break;
    const chart = child(data, 'chart', dialect.chart);
    const relationshipId = chart?.attributes.find((item) => item.localName === 'id'
      && item.namespaceUri === dialect.relationship)?.value ?? '';
    const relationship = relationships[relationshipId];
    if (relationship?.type.endsWith('/chart')) result = relationship.target;
    break;
  }
  entries.set(id, result);
  return result;
}
