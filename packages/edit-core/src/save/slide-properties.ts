import { own } from '../data-validation';
import { assertVectorFill } from '../shape-fill';
import type { SlideRecord } from '../types';
import { removeXmlChild } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import { PRESENTATIONML_NS } from '../xml/qname';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import type { XmlDocument, XmlElement } from '../xml/types';
import { appendVectorFill, removeDrawingFillChildren } from './shape-format';
import { namespacedElement } from './xml-element';

export function hasSlidePropertyOverrides(record: SlideRecord): boolean {
  return own(record.ovr, 'background') || own(record.ovr, 'hidden');
}

function commonSlide(document: XmlDocument, record: SlideRecord): XmlElement {
  const common = findXmlChild(document.root, {
    localName: 'cSld', namespaceUri: PRESENTATIONML_NS,
  });
  if (!common) throw new Error(`幻灯片 ${record.id} 缺少 p:cSld`);
  return common;
}

function patchBackground(document: XmlDocument, record: SlideRecord): void {
  if (!own(record.ovr, 'background')) return;
  const fill = record.ovr.background;
  assertVectorFill(fill, `幻灯片 ${record.id} 的背景覆盖`);
  const common = commonSlide(document, record);
  let background = findXmlChild(common, {
    localName: 'bg', namespaceUri: PRESENTATIONML_NS,
  });
  if (!background) {
    background = namespacedElement(common, PRESENTATIONML_NS, 'bg');
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
  removeDrawingFillChildren(properties);
  appendVectorFill(properties, fill);
}

export function patchSlideProperties(document: XmlDocument, record: SlideRecord): void {
  if (!hasSlidePropertyOverrides(record)) return;
  if (own(record.ovr, 'hidden')) {
    if (record.ovr.hidden) setXmlAttribute(document.root, 'show', '0');
    else removeXmlAttribute(document.root, 'show');
  }
  patchBackground(document, record);
}
