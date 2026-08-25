import { findPlaceholderByIdentity } from '@web-ppt/core';
import { resolveRelationshipTarget } from '../clipboard-source';
import type { EditDoc, ElementRecord, SlideRecord } from '../types';
import { parseXmlTree } from '../xml/tree';
import { findXmlAttribute, findXmlChild, xmlElementChildren } from '../xml/query';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import type { XmlDocument, XmlElement } from '../xml/types';
import { relationshipPartFor } from './clipboard-parts';

function child(parent: XmlElement | null, localName: string, namespaceUri?: string): XmlElement | null {
  return parent && findXmlChild(parent, {
    localName, ...(namespaceUri ? { namespaceUri } : {}),
  });
}

function attr(element: XmlElement | null, localName: string): string | null {
  return element ? findXmlAttribute(element, { localName })?.value ?? null : null;
}

function placeholderOf(host: XmlElement) {
  const nonVisual = xmlElementChildren(host).find((candidate) => [
    'nvSpPr', 'nvPicPr', 'nvCxnSpPr', 'nvGraphicFramePr',
  ].includes(candidate.localName)) ?? null;
  const ph = child(child(nonVisual, 'nvPr', PRESENTATIONML_NS), 'ph', PRESENTATIONML_NS);
  if (!ph) return null;
  const idx = attr(ph, 'idx');
  return { type: attr(ph, 'type') ?? 'obj', ...(idx === null ? {} : { idx }) };
}

function placeholderGeometry(
  document: XmlDocument | null,
  query: NonNullable<ElementRecord['meta']['ph']>,
): XmlElement | undefined {
  if (!document) return undefined;
  const shapeTree = child(
    child(document.root, 'cSld', PRESENTATIONML_NS), 'spTree', PRESENTATIONML_NS,
  );
  if (!shapeTree) return undefined;
  const host = findPlaceholderByIdentity(
    xmlElementChildren(shapeTree).filter((candidate) => [
      'sp', 'pic', 'cxnSp', 'graphicFrame',
    ].includes(candidate.localName)),
    placeholderOf,
    query,
  );
  const properties = host ? child(host, 'spPr', PRESENTATIONML_NS) : null;
  return child(properties, 'custGeom', DRAWINGML_NS)
    ?? child(properties, 'prstGeom', DRAWINGML_NS)
    ?? undefined;
}

/** 保存期间按 part 缓存保留型 XML；继承 custGeom 复制公式树，而不是从烘焙 path 反推。 */
export function createLayoutFallbackGeometryResolver(doc: EditDoc) {
  const documents = new Map<string, XmlDocument | null>();
  const document = (part: string): XmlDocument | null => {
    if (!documents.has(part)) {
      const source = doc.package?.parts[part];
      documents.set(part, source ? parseXmlTree(source) : null);
    }
    return documents.get(part) ?? null;
  };
  const masterPart = (layoutPart: string): string | null => {
    const relationships = document(relationshipPartFor(layoutPart));
    const relation = relationships && xmlElementChildren(relationships.root).find((candidate) =>
      candidate.localName === 'Relationship' && attr(candidate, 'Type')?.endsWith('/slideMaster'));
    const target = relation ? attr(relation, 'Target') : null;
    return target ? resolveRelationshipTarget(layoutPart, target) : null;
  };
  return (slide: SlideRecord, record: ElementRecord): XmlElement | undefined => {
    const layoutPart = slide.sourceLayoutId;
    const query = record.meta.ph;
    if (!layoutPart || !query) return undefined;
    return placeholderGeometry(document(layoutPart), query)
      ?? (masterPart(layoutPart)
        ? placeholderGeometry(document(masterPart(layoutPart)!), query) : undefined);
  };
}
