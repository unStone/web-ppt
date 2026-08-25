import { relativeTarget, resolveRelationshipTarget } from '../clipboard-source';
import type { EditDoc, SlideRecord } from '../types';
import {
  createXmlElement, createXmlText, insertXmlChildUnchecked, removeXmlChild, reorderXmlChildren,
} from '../xml/nodes';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import { namespacedElement } from './xml-element';
import { findXmlAttribute, findXmlChild, findXmlDescendant, xmlElementChildren } from '../xml/query';
import { DRAWINGML_NS, POWERPOINT_2010_NS, PRESENTATIONML_NS } from '../xml/qname';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import type { XmlElement } from '../xml/types';
import { patchRelationshipPart } from './clipboard-parts';
import { removedSlidePartNames } from './remove-slide-parts';

const SLIDE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const NOTES_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';
const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
const LAYOUT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout';

export function createdSlides(doc: EditDoc): SlideRecord[] {
  return doc.slideOrder.map((id) => doc.slides[id]).filter((slide) => !!slide.creation);
}

export function emptySlideXml(): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`);
}

export function createdSlideRelationships(slide: SlideRecord, source?: Uint8Array): Uint8Array {
  if (!slide.creation || !slide.origin) throw new Error(`页面 ${slide.id} 不是可物化的新页`);
  return patchSlideLayoutRelationship(slide, source);
}

function availableRelationshipId(source?: Uint8Array): string {
  const used = new Set(source
    ? xmlElementChildren(parseXmlTree(source).root, { localName: 'Relationship' })
      .flatMap((node) => elementAttribute(node, 'Id') ?? [])
    : []);
  for (let serial = 1; ; serial++) if (!used.has(`rId${serial}`)) return `rId${serial}`;
}

/** 复用既有 rId，只改内部 Target；未知关系、属性与顺序均留在原树。 */
export function patchSlideLayoutRelationship(slide: SlideRecord, source?: Uint8Array): Uint8Array {
  if (!slide.origin || !slide.layoutId) throw new Error(`页面 ${slide.id} 缺少版式写回身份`);
  if (!source) {
    const id = slide.creation?.layoutRelationshipId ?? availableRelationshipId();
    return patchRelationshipPart(undefined, [{
      sourceId: id,
      targetId: id,
      type: LAYOUT_REL,
      target: relativeTarget(slide.origin.part, slide.layoutId),
    }]);
  }
  const tree = parseXmlTree(source);
  const relationships = xmlElementChildren(tree.root, { localName: 'Relationship' });
  const relation = relationships.find((node) => elementAttribute(node, 'Type')?.endsWith('/slideLayout')
    && elementAttribute(node, 'TargetMode') !== 'External'
    && (slide.creation === undefined
      || elementAttribute(node, 'Id') === slide.creation.layoutRelationshipId));
  if (!relation) {
    const id = slide.creation?.layoutRelationshipId ?? availableRelationshipId(source);
    return patchRelationshipPart(source, [{
      sourceId: id,
      targetId: id,
      type: LAYOUT_REL,
      target: relativeTarget(slide.origin.part, slide.layoutId),
    }]);
  }
  const target = relativeTarget(slide.origin.part, slide.layoutId);
  if (elementAttribute(relation, 'Target') === target
    && elementAttribute(relation, 'TargetMode') === undefined) return source;
  setXmlAttribute(relation, 'Target', target);
  removeXmlAttribute(relation, 'TargetMode');
  return serializeXmlTreeBytes(tree);
}

/** PowerPoint 会重算字段，LibreOffice 不一定；只刷新 a:fld 的缓存文字，不降级成普通 run。 */
export function patchSlideNumberFields(source: Uint8Array, slideNumber: number): Uint8Array {
  const tree = parseXmlTree(source);
  const value = String(slideNumber);
  let changed = false;
  const visit = (parent: XmlElement): void => {
    for (const child of xmlElementChildren(parent)) {
      if (child.namespaceUri === DRAWINGML_NS && child.localName === 'fld'
        && elementAttribute(child, 'type')?.toLowerCase() === 'slidenum') {
        const text = findXmlChild(child, { localName: 't', namespaceUri: DRAWINGML_NS });
        if (text && !(text.children.length === 1
          && text.children[0]?.type === 'text' && text.children[0].value === value)) {
          for (const node of [...text.children]) removeXmlChild(text, node);
          insertXmlChildUnchecked(text, createXmlText(value));
          changed = true;
        }
      }
      visit(child);
    }
  };
  visit(tree.root);
  return changed ? serializeXmlTreeBytes(tree) : source;
}

function relationshipTargets(source: Uint8Array): Map<string, string> {
  const targets = new Map<string, string>();
  for (const node of xmlElementChildren(parseXmlTree(source).root, { localName: 'Relationship' })) {
    const id = findXmlAttribute(node, { localName: 'Id', namespaceUri: null })?.value;
    const target = findXmlAttribute(node, { localName: 'Target', namespaceUri: null })?.value;
    const mode = findXmlAttribute(node, { localName: 'TargetMode', namespaceUri: null })?.value;
    if (id && target && mode !== 'External') targets.set(id, resolveRelationshipTarget('ppt/presentation.xml', target));
  }
  return targets;
}

function elementAttribute(element: XmlElement, localName: string): string | undefined {
  return findXmlAttribute(element, { localName, namespaceUri: null })?.value;
}

function insertBeforeTrailingUnknown(
  parent: XmlElement,
  child: XmlElement,
  knownLocalName: string,
  knownNamespace: string,
): void {
  const before = xmlElementChildren(parent).find((candidate) =>
    candidate.localName !== knownLocalName || candidate.namespaceUri !== knownNamespace) ?? null;
  insertXmlChildUnchecked(parent, child, before);
}

function patchSections(
  root: XmlElement,
  slides: readonly SlideRecord[],
  finalSlideIds: readonly number[],
  removedSlideIds: ReadonlySet<number>,
): void {
  const sectionList = findXmlDescendant(root, {
    localName: 'sectionLst', namespaceUri: POWERPOINT_2010_NS,
  });
  if (!sectionList) return;
  for (const section of xmlElementChildren(sectionList, {
    localName: 'section', namespaceUri: POWERPOINT_2010_NS,
  })) {
    const list = findXmlChild(section, {
      localName: 'sldIdLst', namespaceUri: POWERPOINT_2010_NS,
    });
    if (!list) continue;
    const sourceNodes = xmlElementChildren(list, {
      localName: 'sldId', namespaceUri: POWERPOINT_2010_NS,
    });
    // 先记录来源归属；锚点页本次同时删除时，副本仍应继承复制瞬间的 section。
    const members = new Set(sourceNodes.flatMap((node) => {
      const id = elementAttribute(node, 'id');
      return id ? [Number(id)] : [];
    }));
    for (const node of sourceNodes) {
      const id = Number(elementAttribute(node, 'id'));
      if (removedSlideIds.has(id)) removeXmlChild(list, node);
    }
    const existing = sourceNodes.filter((node) =>
      !removedSlideIds.has(Number(elementAttribute(node, 'id'))));
    let advanced = true;
    while (advanced) {
      advanced = false;
      for (const slide of slides) {
        const creation = slide.creation;
        if (!creation || members.has(creation.presentationSlideId)
          || creation.sectionAfterSlideId === undefined
          || !members.has(creation.sectionAfterSlideId)) continue;
        members.add(creation.presentationSlideId);
        advanced = true;
      }
    }
    const nodesById = new Map(existing.map((node) => [Number(elementAttribute(node, 'id')), node]));
    const desired = finalSlideIds.flatMap((id) => {
      if (!members.has(id)) return [];
      const current = nodesById.get(id);
      if (current) return [current];
      const node = namespacedElement(list, POWERPOINT_2010_NS, 'sldId');
      setXmlAttribute(node, 'id', String(id));
      nodesById.set(id, node);
      return [node];
    });
    // 调用方按最终页序传入所有页面；同锚点连续新增因此不会被逐次插入反转。
    for (const node of desired) {
      if (!xmlElementChildren(list).includes(node)) {
        insertBeforeTrailingUnknown(list, node, 'sldId', POWERPOINT_2010_NS);
      }
    }
    reorderXmlChildren(list, desired);
  }
}

export function patchPresentationSlides(
  source: Uint8Array,
  relationships: Uint8Array,
  doc: EditDoc,
): Uint8Array {
  const tree = parseXmlTree(source);
  const list = findXmlChild(tree.root, { localName: 'sldIdLst', namespaceUri: PRESENTATIONML_NS });
  if (!list) throw new Error('presentation.xml 缺少 p:sldIdLst');
  const targets = relationshipTargets(relationships);
  const existingByPart = new Map<string, XmlElement>();
  const removedParts = removedSlidePartNames(doc);
  const removedSlideIds = new Set<number>();
  for (const node of xmlElementChildren(list, { localName: 'sldId', namespaceUri: PRESENTATIONML_NS })) {
    const rid = findXmlAttribute(node, {
      localName: 'id', namespaceUri: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    })?.value;
    const part = rid ? targets.get(rid) : undefined;
    if (part && removedParts.has(part)) {
      const id = Number(elementAttribute(node, 'id'));
      if (Number.isFinite(id)) removedSlideIds.add(id);
      removeXmlChild(list, node);
    } else if (part) existingByPart.set(part, node);
  }
  const activeCreated = createdSlides(doc);
  const createdById = new Map(activeCreated.map((slide) => [slide.id, slide]));
  const desired = doc.slideOrder.map((id) => {
    const slide = doc.slides[id];
    const existing = slide.origin ? existingByPart.get(slide.origin.part) : undefined;
    if (existing) return existing;
    const created = createdById.get(id);
    if (!created?.creation) throw new Error(`页面 ${id} 无法映射到 presentation.xml`);
    const node = namespacedElement(list, PRESENTATIONML_NS, 'sldId');
    setXmlAttribute(node, 'id', String(created.creation.presentationSlideId));
    setXmlAttribute(node, 'r:id', created.creation.presentationRelationshipId);
    return node;
  });
  for (const node of desired) {
    if (!xmlElementChildren(list).includes(node)) {
      insertBeforeTrailingUnknown(list, node, 'sldId', PRESENTATIONML_NS);
    }
  }
  reorderXmlChildren(list, desired);
  patchSections(
    tree.root, activeCreated,
    desired.map((node) => Number(elementAttribute(node, 'id'))), removedSlideIds,
  );
  return serializeXmlTreeBytes(tree);
}

export function patchPresentationRelationships(source: Uint8Array, doc: EditDoc): Uint8Array {
  const tree = parseXmlTree(source);
  const removedParts = removedSlidePartNames(doc);
  for (const node of xmlElementChildren(tree.root, { localName: 'Relationship' })) {
    const type = elementAttribute(node, 'Type');
    const target = elementAttribute(node, 'Target');
    const mode = elementAttribute(node, 'TargetMode');
    if (type !== SLIDE_REL || !target || mode === 'External') continue;
    if (removedParts.has(resolveRelationshipTarget('ppt/presentation.xml', target))) {
      removeXmlChild(tree.root, node);
    }
  }
  return patchRelationshipPart(serializeXmlTreeBytes(tree), createdSlides(doc).map((slide) => ({
    sourceId: slide.creation!.presentationRelationshipId,
    targetId: slide.creation!.presentationRelationshipId,
    type: SLIDE_REL,
    target: relativeTarget('ppt/presentation.xml', slide.origin!.part),
  })));
}

export function patchSlideContentTypes(
  source: Uint8Array,
  doc: EditDoc,
  removedParts: ReadonlySet<string> = new Set(),
): Uint8Array {
  const tree = parseXmlTree(source);
  for (const node of xmlElementChildren(tree.root, { localName: 'Override' })) {
    const part = findXmlAttribute(node, { localName: 'PartName', namespaceUri: null })?.value;
    if (part && removedParts.has(part.replace(/^\//, ''))) removeXmlChild(tree.root, node);
  }
  const existing = new Set(xmlElementChildren(tree.root, { localName: 'Override' })
    .flatMap((node) => {
      const part = findXmlAttribute(node, { localName: 'PartName', namespaceUri: null })?.value;
      return part ? [part] : [];
    }));
  for (const slide of createdSlides(doc)) {
    const part = `/${slide.origin!.part}`;
    if (!existing.has(part)) {
      insertXmlChildUnchecked(tree.root, createXmlElement('Override', {
        attributes: [['PartName', part], ['ContentType', SLIDE_CONTENT_TYPE]],
      }));
      existing.add(part);
    }
    const notesPart = slide.notes?.targetPart;
    if (!notesPart || existing.has(`/${notesPart}`)) continue;
    insertXmlChildUnchecked(tree.root, createXmlElement('Override', {
      attributes: [['PartName', `/${notesPart}`], ['ContentType', NOTES_CONTENT_TYPE]],
    }));
    existing.add(`/${notesPart}`);
  }
  for (const slide of Object.values(doc.slides)) {
    const notesPart = slide.notes?.targetPart;
    if (!notesPart || existing.has(`/${notesPart}`)) continue;
    insertXmlChildUnchecked(tree.root, createXmlElement('Override', {
      attributes: [['PartName', `/${notesPart}`], ['ContentType', NOTES_CONTENT_TYPE]],
    }));
    existing.add(`/${notesPart}`);
  }
  return serializeXmlTreeBytes(tree);
}
