import { resolveRelationshipTarget } from '../clipboard-source';
import type { EditDoc } from '../types';
import { PRESENTATIONML_NS } from '../xml/qname';
import { findXmlAttribute, findXmlChild, xmlElementChildren } from '../xml/query';
import { parseXmlTree } from '../xml/tree';

const decoder = new TextDecoder();
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function maximum(source: string, pattern: RegExp): number {
  let value = 0;
  for (const match of source.matchAll(pattern)) {
    const candidate = Number(match[1]);
    if (Number.isSafeInteger(candidate)) value = Math.max(value, candidate);
  }
  return value;
}

function initializeOpcIdentity(doc: EditDoc): void {
  const pkg = doc.package;
  if (!pkg) throw new Error('新增页需要可写 OOXML 包');
  if (doc.identity.nextSlidePart === undefined) {
    const parts = [...Object.keys(pkg.parts), ...Object.values(doc.slides)
      .flatMap((slide) => slide.origin ? [slide.origin.part] : [])];
    const highest = Math.max(0, ...parts.flatMap((part) => {
      const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(part);
      return match ? [Number(match[1])] : [];
    }));
    doc.identity.nextSlidePart = highest + 1;
  }
  if (doc.identity.nextPresentationSlideId === undefined) {
    const xml = decoder.decode(pkg.parts['ppt/presentation.xml']);
    doc.identity.nextPresentationSlideId = Math.max(255,
      maximum(xml, /<(?:[A-Za-z_][\w.-]*:)?sldId\b[^>]*\bid\s*=\s*["'](\d+)["']/g)) + 1;
  }
  if (doc.identity.nextPresentationRelationship === undefined) {
    const xml = decoder.decode(pkg.parts['ppt/_rels/presentation.xml.rels']);
    doc.identity.nextPresentationRelationship = maximum(xml, /\bId\s*=\s*["']rId(\d+)["']/g) + 1;
  }
}

export function allocateSlideOpcIdentity(doc: EditDoc): {
  part: string;
  presentationSlideId: number;
  presentationRelationshipId: string;
} {
  initializeOpcIdentity(doc);
  const partNumber = doc.identity.nextSlidePart!++;
  const presentationSlideId = doc.identity.nextPresentationSlideId!++;
  const relationshipNumber = doc.identity.nextPresentationRelationship!++;
  if (!Number.isSafeInteger(partNumber) || partNumber <= 0
    || !Number.isSafeInteger(presentationSlideId) || presentationSlideId < 256
    || presentationSlideId > 0xffffffff
    || !Number.isSafeInteger(relationshipNumber) || relationshipNumber <= 0) {
    throw new Error('演示文稿的新增页身份已耗尽');
  }
  return {
    part: `ppt/slides/slide${partNumber}.xml`,
    presentationSlideId,
    presentationRelationshipId: `rId${relationshipNumber}`,
  };
}

export function presentationSlideIdForPart(doc: EditDoc, part: string): number | undefined {
  const created = Object.values(doc.slides).find((slide) => slide.origin?.part === part)?.creation;
  if (created) return created.presentationSlideId;
  const pkg = doc.package;
  if (!pkg) return undefined;
  const relsBytes = pkg.parts['ppt/_rels/presentation.xml.rels'];
  const presentationBytes = pkg.parts['ppt/presentation.xml'];
  if (!relsBytes || !presentationBytes) return undefined;
  let rid: string | undefined;
  for (const relationship of xmlElementChildren(
    parseXmlTree(relsBytes).root, { localName: 'Relationship' },
  )) {
    const target = findXmlAttribute(relationship, { localName: 'Target', namespaceUri: null })?.value;
    const mode = findXmlAttribute(relationship, { localName: 'TargetMode', namespaceUri: null })?.value;
    const type = findXmlAttribute(relationship, { localName: 'Type', namespaceUri: null })?.value;
    if (target && mode !== 'External' && type?.endsWith('/slide')
      && resolveRelationshipTarget('ppt/presentation.xml', target) === part) {
      rid = findXmlAttribute(relationship, { localName: 'Id', namespaceUri: null })?.value;
      break;
    }
  }
  if (!rid) return undefined;
  const presentation = parseXmlTree(presentationBytes).root;
  const list = findXmlChild(presentation, { localName: 'sldIdLst', namespaceUri: PRESENTATIONML_NS });
  const node = list && xmlElementChildren(list, { localName: 'sldId', namespaceUri: PRESENTATIONML_NS })
    .find((candidate) => findXmlAttribute(candidate, {
      localName: 'id', namespaceUri: OFFICE_REL_NS,
    })?.value === rid);
  const value = Number(node && findXmlAttribute(node, { localName: 'id', namespaceUri: null })?.value);
  return Number.isSafeInteger(value) && value >= 256 ? value : undefined;
}
