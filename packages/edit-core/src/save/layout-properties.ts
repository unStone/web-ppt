import { own } from '../data-validation';
import { assertVectorFill } from '../shape-fill';
import type { LayoutRecord } from '../types';
import { removeXmlChild } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { PRESENTATIONML_NS } from '../xml/qname';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import type { XmlDocument } from '../xml/types';
import { appendVectorFill, removeDrawingFillChildren } from './shape-format';
import { patchSlideTransition } from './transition';
import { namespacedElement } from './xml-element';

export function hasLayoutPropertyOverrides(record: LayoutRecord): boolean {
  return own(record.ovr, 'background') || own(record.ovr, 'transition');
}

export function patchLayoutProperties(document: XmlDocument, record: LayoutRecord): void {
  if (own(record.ovr, 'transition')) {
    // 设计目标中的 none 是显式屏蔽，必须留下空 transition 槽阻断继承。
    patchSlideTransition(document, record.ovr.transition!, true);
  }
  if (!own(record.ovr, 'background')) return;
  const fill = record.ovr.background!;
  assertVectorFill(fill, `版式 ${record.id} 的背景覆盖`);
  const common = findXmlChild(document.root, {
    localName: 'cSld', namespaceUri: PRESENTATIONML_NS,
  });
  if (!common) throw new Error(`版式 ${record.id} 缺少 p:cSld`);
  let background = findXmlChild(common, {
    localName: 'bg', namespaceUri: PRESENTATIONML_NS,
  });
  if (!background) {
    background = namespacedElement(common, PRESENTATIONML_NS, 'bg');
    insertXmlInOrder(common, background);
  }
  for (const child of [...xmlElementChildren(background)]) {
    if (child.namespaceUri === PRESENTATIONML_NS && child.localName === 'bgRef') {
      removeXmlChild(background, child);
    }
  }
  let properties = findXmlChild(background, {
    localName: 'bgPr', namespaceUri: PRESENTATIONML_NS,
  });
  if (!properties) {
    properties = namespacedElement(background, PRESENTATIONML_NS, 'bgPr');
    insertXmlInOrder(background, properties);
  }
  removeDrawingFillChildren(properties);
  appendVectorFill(properties, fill);
}
