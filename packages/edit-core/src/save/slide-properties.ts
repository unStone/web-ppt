import { own } from '../data-validation';
import { assertVectorFill } from '../shape-fill';
import { assertSlideImageFill } from '../commands/slide-property';
import { relationshipPartFor, resolveRelationshipTarget } from '../clipboard-source';
import type { EditDoc, SlideRecord } from '../types';
import { cloneXmlNodeWithNamespaceClosure, removeXmlChild } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { findXmlAttribute, findXmlChild, xmlElementChildren } from '../xml/query';
import { parseXmlTree } from '../xml/tree';
import type { XmlDocument, XmlElement } from '../xml/types';
import { appendVectorFill, removeDrawingFillChildren } from './shape-format';
import { patchBackgroundImageFill } from './background-image';
import { namespacedElement } from './xml-element';
import { patchSlideTransition } from './transition';
import { patchSlideAnimations } from './animation';

const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function remapRelationshipIds(root: XmlElement, record: SlideRecord): void {
  const mapping = new Map(record.backgroundImage?.relationships
    .map((relationship) => [relationship.sourceId, relationship.targetId] as const) ?? []);
  const visit = (element: XmlElement): void => {
    for (const attribute of element.attributes) {
      const target = attribute.namespaceUri === OFFICE_REL_NS ? mapping.get(attribute.value) : null;
      if (target) setXmlAttribute(element, attribute.name, target, attribute.quote);
    }
    for (const child of xmlElementChildren(element)) visit(child);
  };
  visit(root);
}

export function hasSlidePropertyOverrides(record: SlideRecord): boolean {
  return own(record.ovr, 'background') || own(record.ovr, 'hidden')
    || own(record.ovr, 'transition') || own(record.ovr, 'animations');
}

function commonSlide(document: XmlDocument, record: SlideRecord): XmlElement {
  const common = findXmlChild(document.root, {
    localName: 'cSld', namespaceUri: PRESENTATIONML_NS,
  });
  if (!common) throw new Error(`幻灯片 ${record.id} 缺少 p:cSld`);
  return common;
}

function relatedPart(doc: EditDoc, part: string, relationSuffix: string): string | null {
  const bytes = doc.package?.parts[relationshipPartFor(part)];
  if (!bytes) return null;
  const relation = xmlElementChildren(parseXmlTree(bytes).root, { localName: 'Relationship' })
    .find((node) => findXmlAttribute(node, { localName: 'Type', namespaceUri: null })
      ?.value.endsWith(relationSuffix));
  const target = relation
    && findXmlAttribute(relation, { localName: 'Target', namespaceUri: null })?.value;
  return target ? resolveRelationshipTarget(part, target) : null;
}

function backgroundFromPart(doc: EditDoc, part: string): { found: boolean; image: XmlElement | null } {
  const bytes = doc.package?.parts[part];
  if (!bytes) return { found: false, image: null };
  const common = findXmlChild(parseXmlTree(bytes).root, {
    localName: 'cSld', namespaceUri: PRESENTATIONML_NS,
  });
  const background = common && findXmlChild(common, {
    localName: 'bg', namespaceUri: PRESENTATIONML_NS,
  });
  if (!background) return { found: false, image: null };
  const properties = findXmlChild(background, {
    localName: 'bgPr', namespaceUri: PRESENTATIONML_NS,
  });
  const image = properties && findXmlChild(properties, {
    localName: 'blipFill', namespaceUri: DRAWINGML_NS,
  });
  return { found: true, image: image ? background : null };
}

/** 继承背景首次物化必须从真正生效的版式/母版节点克隆，不能用有损 Fill 反向猜 XML。 */
function inheritedImageBackground(doc: EditDoc, record: SlideRecord): XmlElement | null {
  if (record.src.background?.type !== 'image' || !record.layoutId) return null;
  const master = relatedPart(doc, record.layoutId, '/slideMaster');
  for (const part of [record.layoutId, master]) {
    if (!part) continue;
    const candidate = backgroundFromPart(doc, part);
    // OOXML 继承在第一份显式背景处停止；不能越过 bgRef/非图片 bgPr 误取母版。
    if (candidate.found) return candidate.image;
  }
  return null;
}

function patchBackground(
  document: XmlDocument,
  doc: EditDoc,
  record: SlideRecord,
): void {
  if (!own(record.ovr, 'background')) return;
  const fill = record.ovr.background;
  if (fill?.type === 'image') assertSlideImageFill(fill, `幻灯片 ${record.id} 的背景覆盖`);
  else assertVectorFill(fill, `幻灯片 ${record.id} 的背景覆盖`);
  const common = commonSlide(document, record);
  let background = findXmlChild(common, {
    localName: 'bg', namespaceUri: PRESENTATIONML_NS,
  });
  if (!background) {
    const inherited = fill.type === 'image' ? inheritedImageBackground(doc, record) : null;
    background = inherited
      ? cloneXmlNodeWithNamespaceClosure(inherited)
      : namespacedElement(common, PRESENTATIONML_NS, 'bg');
    if (inherited) remapRelationshipIds(background, record);
    insertXmlInOrder(common, background);
  }
  let properties = findXmlChild(background, {
    localName: 'bgPr', namespaceUri: PRESENTATIONML_NS,
  });
  for (const child of [...xmlElementChildren(background)]) {
    if (child.namespaceUri === PRESENTATIONML_NS && child.localName === 'bgRef') {
      removeXmlChild(background, child);
    }
  }
  if (!properties) {
    properties = namespacedElement(background, PRESENTATIONML_NS, 'bgPr');
    insertXmlInOrder(background, properties);
  }
  if (fill.type === 'image') {
    const imageBackground = record.backgroundImage;
    if (!imageBackground) throw new Error(`幻灯片 ${record.id} 的图片背景缺少关系`);
    patchBackgroundImageFill(
      properties, fill, imageBackground.imageRelationshipId, imageBackground.sourcePart !== undefined,
    );
  } else {
    removeDrawingFillChildren(properties);
    appendVectorFill(properties, fill);
  }
}

export function patchSlideProperties(document: XmlDocument, doc: EditDoc, record: SlideRecord): void {
  if (!hasSlidePropertyOverrides(record)) return;
  if (own(record.ovr, 'hidden')) {
    if (record.ovr.hidden) setXmlAttribute(document.root, 'show', '0');
    else removeXmlAttribute(document.root, 'show');
  }
  if (own(record.ovr, 'transition')) {
    const layoutTransition = record.layoutId ? doc.layouts[record.layoutId]?.transition : undefined;
    patchSlideTransition(
      document, record.ovr.transition!, layoutTransition !== undefined,
    );
  }
  if (own(record.ovr, 'animations')) {
    patchSlideAnimations(document, doc, record, record.ovr.animations!);
  }
  patchBackground(document, doc, record);
}
