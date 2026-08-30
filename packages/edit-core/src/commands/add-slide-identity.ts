import { resolveRelationshipTarget } from '../clipboard-source';
import type { EditDoc } from '../types';
import { PRESENTATIONML_NS } from '../xml/qname';
import { findXmlAttribute, findXmlChild, xmlElementChildren } from '../xml/query';
import { parseXmlTree } from '../xml/tree';
import { allocateIdentityRange, ensureIdentityRange } from '../identity-allocation';

const decoder = new TextDecoder();
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAX_PRESENTATION_SLIDE_ID = 0x7fff_ffff;

/** 删除保存再撤销时 part 只存在 detached baseline；身份读取必须与保存重建使用同一真相源。 */
function sourcePart(doc: EditDoc, part: string): Uint8Array | undefined {
  return doc.saveState.baselines[part] ?? doc.package?.parts[part];
}

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
    const parts = [...Object.keys(pkg.parts), ...Object.keys(doc.saveState.baselines), ...Object.values(doc.slides)
      .flatMap((slide) => slide.origin ? [slide.origin.part] : [])];
    const highest = Math.max(0, ...parts.flatMap((part) => {
      const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(part);
      return match ? [Number(match[1])] : [];
    }));
    doc.identity.nextSlidePart = highest + 1;
  }
  if (doc.identity.nextPresentationSlideId === undefined) {
    const bytes = sourcePart(doc, 'ppt/presentation.xml');
    if (!bytes) throw new Error('PPTX 缺少 ppt/presentation.xml');
    const xml = decoder.decode(bytes);
    doc.identity.nextPresentationSlideId = Math.max(255,
      maximum(xml, /<(?:[A-Za-z_][\w.-]*:)?sldId\b[^>]*\bid\s*=\s*["'](\d+)["']/g)) + 1;
  }
  if (doc.identity.nextPresentationRelationship === undefined) {
    const bytes = sourcePart(doc, 'ppt/_rels/presentation.xml.rels');
    if (!bytes) throw new Error('PPTX 缺少 ppt/_rels/presentation.xml.rels');
    const xml = decoder.decode(bytes);
    doc.identity.nextPresentationRelationship = maximum(xml, /\bId\s*=\s*["']rId(\d+)["']/g) + 1;
  }
}

export function allocateSlideOpcIdentity(doc: EditDoc): {
  part: string;
  presentationSlideId: number;
  presentationRelationshipId: string;
} {
  initializeOpcIdentity(doc);
  const partNumber = allocateIdentityRange(
    doc.identity, 'slidePart', doc.identity.nextSlidePart!,
  ) ?? doc.identity.nextSlidePart!++;
  const presentationSlideId = allocateIdentityRange(
    doc.identity, 'presentationSlideId', doc.identity.nextPresentationSlideId!, MAX_PRESENTATION_SLIDE_ID,
  ) ?? doc.identity.nextPresentationSlideId!++;
  const relationshipNumber = allocateIdentityRange(
    doc.identity, 'presentationRelationship', doc.identity.nextPresentationRelationship!,
  ) ?? doc.identity.nextPresentationRelationship!++;
  doc.identity.nextSlidePart = Math.max(doc.identity.nextSlidePart!, partNumber + 1);
  doc.identity.nextPresentationSlideId = Math.max(
    doc.identity.nextPresentationSlideId!, presentationSlideId + 1,
  );
  doc.identity.nextPresentationRelationship = Math.max(
    doc.identity.nextPresentationRelationship!, relationshipNumber + 1,
  );
  if (!Number.isSafeInteger(partNumber) || partNumber <= 0
    || !Number.isSafeInteger(presentationSlideId) || presentationSlideId < 256
    || presentationSlideId > MAX_PRESENTATION_SLIDE_ID
    || !Number.isSafeInteger(relationshipNumber) || relationshipNumber <= 0) {
    throw new Error('演示文稿的新增页身份已耗尽');
  }
  return {
    part: `ppt/slides/slide${partNumber}.xml`,
    presentationSlideId,
    presentationRelationshipId: `rId${relationshipNumber}`,
  };
}

export function allocateNotesPart(doc: EditDoc): string {
  initializeOpcIdentity(doc);
  if (doc.identity.nextNotesPart === undefined) {
    const parts = [
      ...Object.keys(doc.package!.parts), ...Object.keys(doc.saveState.baselines),
      ...Object.values(doc.slides).flatMap((slide) =>
      slide.creation?.duplicateNotesPart ? [slide.creation.duplicateNotesPart] : [])];
    const highest = Math.max(0, ...parts.flatMap((part) => {
      const match = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(part);
      return match ? [Number(match[1])] : [];
    }));
    doc.identity.nextNotesPart = highest + 1;
  }
  const partNumber = allocateIdentityRange(
    doc.identity, 'notesPart', doc.identity.nextNotesPart,
  ) ?? doc.identity.nextNotesPart++;
  doc.identity.nextNotesPart = Math.max(doc.identity.nextNotesPart, partNumber + 1);
  if (!Number.isSafeInteger(partNumber) || partNumber <= 0) throw new Error('演示文稿的备注身份已耗尽');
  return `ppt/notesSlides/notesSlide${partNumber}.xml`;
}

/** 协同绑定期固化全部全局 OPC 数值区间，后续远端补丁不会改变本副本的分配边界。 */
export function prepareSlideOpcNamespaces(doc: EditDoc): void {
  initializeOpcIdentity(doc);
  ensureIdentityRange(doc.identity, 'slidePart', doc.identity.nextSlidePart!);
  ensureIdentityRange(
    doc.identity, 'presentationSlideId', doc.identity.nextPresentationSlideId!, MAX_PRESENTATION_SLIDE_ID,
  );
  ensureIdentityRange(
    doc.identity, 'presentationRelationship', doc.identity.nextPresentationRelationship!,
  );
  let firstNotesPart = doc.identity.nextNotesPart;
  if (firstNotesPart === undefined) {
    const parts = [
      ...Object.keys(doc.package!.parts), ...Object.keys(doc.saveState.baselines),
      ...Object.values(doc.slides).flatMap((slide) =>
        slide.notes ? [slide.notes.targetPart] : []),
    ];
    const highest = Math.max(0, ...parts.flatMap((part) => {
      const match = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(part);
      return match ? [Number(match[1])] : [];
    }));
    firstNotesPart = highest + 1;
  }
  // 预留区间不等于消费身份；保持 undefined，恢复验真才能区分“已准备”与“已新增备注”。
  ensureIdentityRange(doc.identity, 'notesPart', firstNotesPart);
}

export function presentationSlideIdForPart(doc: EditDoc, part: string): number | undefined {
  const created = Object.values(doc.slides).find((slide) => slide.origin?.part === part)?.creation;
  if (created) return created.presentationSlideId;
  if (!doc.package) return undefined;
  const relsBytes = sourcePart(doc, 'ppt/_rels/presentation.xml.rels');
  const presentationBytes = sourcePart(doc, 'ppt/presentation.xml');
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
