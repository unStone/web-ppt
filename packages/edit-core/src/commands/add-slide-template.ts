import type { ShapeElement, SlideElement, SlideLayoutTemplate } from '@web-ppt/core';
import { allocateElementId, elementMetaOf } from '../document';
import { initialFractionalIndex } from '../fractional-index';
import { hasDynamicSlideLink, hasDynamicSlideNumber } from '../dynamic-slide-fields';
import { fieldTextWithoutDirect } from '../field-text';
import type {
  EditDoc, EditableKind, ElementId, ElementInsertionSource, ElementRecord, SlideId,
} from '../types';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { findXmlAttribute, findXmlChild, xmlElementChildren } from '../xml/query';
import { removeXmlChild } from '../xml/nodes';
import { removeXmlAttribute } from '../xml/mutate';
import { parseXmlTree, serializeXmlNode } from '../xml/tree';
import type { XmlElement } from '../xml/types';

const FIELD_PLACEHOLDER_TYPES = new Set(['dt', 'ftr', 'sldNum', 'hdr']);

const xmlAttr = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const TEXT_FORMAT_CONTAINERS = new Set(['bodyPr', 'lstStyle', 'pPr', 'rPr', 'endParaRPr']);

/** 字段内容属于页面；克隆到页面的版式格式必须继续由新关系继承。 */
function stripFieldTextFormatting(node: XmlElement): void {
  if (node.namespaceUri === DRAWINGML_NS && TEXT_FORMAT_CONTAINERS.has(node.localName)) {
    for (const attribute of [...node.attributes]) {
      if (attribute.namespaceUri === null) removeXmlAttribute(node, attribute.name);
    }
    for (const child of [...xmlElementChildren(node)]) {
      if (child.namespaceUri === DRAWINGML_NS && child.localName !== 'extLst') {
        removeXmlChild(node, child);
      }
    }
  }
  for (const child of [...xmlElementChildren(node)]) stripFieldTextFormatting(child);
}

function hostWithSpid(root: XmlElement, spid: number): XmlElement | null {
  for (const child of xmlElementChildren(root)) {
    if (child.namespaceUri === PRESENTATIONML_NS && child.localName === 'sp') {
      const nonVisual = findXmlChild(child, { localName: 'nvSpPr', namespaceUri: PRESENTATIONML_NS });
      const properties = nonVisual && findXmlChild(nonVisual, {
        localName: 'cNvPr', namespaceUri: PRESENTATIONML_NS,
      });
      if (properties
        && findXmlAttribute(properties, { localName: 'id', namespaceUri: null })?.value === String(spid)) {
        return child;
      }
    }
    const nested = hostWithSpid(child, spid);
    if (nested) return nested;
  }
  return null;
}

function fieldPlaceholderInsertion(
  doc: EditDoc,
  element: ShapeElement,
  spid: number,
): ElementInsertionSource {
  const origin = element.editInfo?.origin;
  const bytes = origin && doc.package?.parts[origin.part];
  if (!origin || !bytes) throw new Error('字段占位符缺少可读取的版式来源');
  const document = parseXmlTree(bytes);
  const host = hostWithSpid(document.root, origin.spid);
  if (!host) throw new Error(`版式字段占位符 spid ${origin.spid} 不存在`);
  const shapeProperties = findXmlChild(host, {
    localName: 'spPr', namespaceUri: PRESENTATIONML_NS,
  });
  const inheritedShapeChildren = new Set([
    'xfrm', 'prstGeom', 'custGeom', 'noFill', 'solidFill', 'gradFill', 'blipFill',
    'pattFill', 'grpFill', 'ln', 'effectLst', 'effectDag', 'scene3d', 'sp3d',
  ]);
  for (const child of shapeProperties ? [...xmlElementChildren(shapeProperties)] : []) {
    if (child.namespaceUri === DRAWINGML_NS && inheritedShapeChildren.has(child.localName)) {
      removeXmlChild(shapeProperties!, child);
    }
  }
  const style = findXmlChild(host, { localName: 'style', namespaceUri: PRESENTATIONML_NS });
  if (style) removeXmlChild(host, style);
  const textBody = findXmlChild(host, { localName: 'txBody', namespaceUri: PRESENTATIONML_NS });
  if (textBody) stripFieldTextFormatting(textBody);
  const namespaces = Object.fromEntries(document.root.attributes
    .filter((attribute) => attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:'))
    .map((attribute) => [attribute.name, attribute.value]));
  return { markup: serializeXmlNode(host), namespaces, spids: { [String(origin.spid)]: spid } };
}

function placeholderInsertion(
  doc: EditDoc,
  element: ShapeElement,
  spid: number,
): ElementInsertionSource {
  const ph = element.editInfo?.placeholder;
  if (!ph) throw new Error('版式占位符缺少语义身份');
  if (FIELD_PLACEHOLDER_TYPES.has(ph.type)) {
    return fieldPlaceholderInsertion(doc, element, spid);
  }
  const attrs = ` type="${xmlAttr(ph.type)}"${ph.idx === undefined ? '' : ` idx="${xmlAttr(ph.idx)}"`}`;
  return {
    markup: `<p:sp>
<p:nvSpPr><p:cNvPr id="${spid}" name="${xmlAttr(element.name ?? `占位符 ${spid}`)}"/><p:cNvSpPr/><p:nvPr><p:ph${attrs}/></p:nvPr></p:nvSpPr>
<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>
</p:sp>`,
    namespaces: { 'xmlns:a': DRAWINGML_NS, 'xmlns:p': PRESENTATIONML_NS },
    spids: { [String(spid)]: spid },
  };
}

export function layoutTemplateRecords(
  doc: EditDoc,
  layout: SlideLayoutTemplate,
  slideId: SlideId,
  slidePart: string,
): {
  children: ElementId[];
  records: Record<ElementId, ElementRecord>;
  dynamicSlideNumbers: ElementId[];
  dynamicSlideLinks: ElementId[];
  nextSpid: number;
} {
  const records: Record<ElementId, ElementRecord> = Object.create(null);
  const dynamicSlideNumbers: ElementId[] = [];
  const dynamicSlideLinks: ElementId[] = [];
  let nextSpid = 2;
  const add = (
    element: SlideElement,
    parent: SlideId | ElementId,
    index: number,
    inherited: EditableKind,
  ): ElementId => {
    const id = allocateElementId(doc);
    const source = structuredClone(element);
    let meta = elementMetaOf(source, inherited, 'pptx', slidePart);
    if (source.kind === 'shape' && element.kind === 'shape' && source.editInfo?.placeholder) {
      const placeholder = source.editInfo.placeholder;
      const spid = nextSpid++;
      source.id = spid;
      source.editInfo = { ...source.editInfo, origin: { part: slidePart, spid } };
      source.text = FIELD_PLACEHOLDER_TYPES.has(placeholder.type) && source.text
        ? fieldTextWithoutDirect(source.text) : null;
      // 这些位来自版式节点本身；克隆成页面占位符后仍是继承值，不能伪装成页面直设。
      const {
        inherited: _inherited, placeholderDirect: _layoutDirect, ...writableMeta
      } = meta;
      meta = {
        ...writableMeta, editable: 'full', created: true,
        origin: { part: slidePart, spid }, ph: placeholder,
        ...(FIELD_PLACEHOLDER_TYPES.has(placeholder.type) ? { fieldPlaceholder: true as const } : {}),
        textTemplate: source.editInfo.textTemplate ?? structuredClone(layout.defaultShape.textTemplate),
        insertion: placeholderInsertion(doc, element, spid),
      };
    }
    const record: ElementRecord = {
      id, parent, z: initialFractionalIndex(index), src: source, ovr: {}, meta,
    };
    records[id] = record;
    if (hasDynamicSlideNumber(source)) dynamicSlideNumbers.push(id);
    if (hasDynamicSlideLink(source)) dynamicSlideLinks.push(id);
    if (source.kind === 'group') {
      record.children = source.children.map((child, childIndex) =>
        add(child, id, childIndex, meta.editable));
    }
    return id;
  };
  const children = layout.elements.map((element, index) => add(element, slideId, index, 'full'));
  return { children, records, dynamicSlideNumbers, dynamicSlideLinks, nextSpid };
}
