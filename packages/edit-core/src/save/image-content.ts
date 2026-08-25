import { own } from '../data-validation';
import type { ElementRecord, ImageCrop } from '../types';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { findXmlChild } from '../xml/query';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import { insertXmlChildUnchecked } from '../xml/nodes';
import type { XmlDocument, XmlElement } from '../xml/types';
import { namespacedElement } from './xml-element';
import { locateElementHost } from './xfrm';

function blipFill(document: XmlDocument, record: ElementRecord): XmlElement {
  const { host } = locateElementHost(document, record);
  const fill = findXmlChild(host, { localName: 'blipFill', namespaceUri: PRESENTATIONML_NS });
  if (!fill) throw new Error(`图片 ${record.id} 缺少 p:blipFill`);
  return fill;
}

function patchCrop(fill: XmlElement, crop: ImageCrop): void {
  const previous = findXmlChild(fill, { localName: 'srcRect', namespaceUri: DRAWINGML_NS });
  const node = previous ?? namespacedElement(fill, DRAWINGML_NS, 'srcRect');
  for (const field of ['l', 't', 'r', 'b'] as const) {
    setXmlAttribute(node, field, String(Math.round(crop[field] * 100000)));
  }
  // 已有节点可能携带未来版本扩展；只改已知四边，不能用重建换掉未知属性与子节点。
  if (previous) return;
  const before = findXmlChild(fill, { localName: 'tile', namespaceUri: DRAWINGML_NS })
    ?? findXmlChild(fill, { localName: 'stretch', namespaceUri: DRAWINGML_NS });
  if (before) insertXmlChildUnchecked(fill, node, before);
  else insertXmlInOrder(fill, node);
}

export function hasImageContentOverrides(record: ElementRecord): boolean {
  return own(record.ovr, 'crop') || !!record.meta.imageReplacement;
}

export function patchElementImageContent(document: XmlDocument, record: ElementRecord): void {
  if (!hasImageContentOverrides(record)) return;
  if (record.src.kind !== 'image') throw new Error(`元素 ${record.id} 不是图片`);
  const fill = blipFill(document, record);
  if (record.meta.imageReplacement) {
    const blip = findXmlChild(fill, { localName: 'blip', namespaceUri: DRAWINGML_NS });
    if (!blip) throw new Error(`图片 ${record.id} 缺少 a:blip`);
    setXmlAttribute(blip, 'r:embed', record.meta.imageReplacement.relationships[0].targetId);
    removeXmlAttribute(blip, 'r:link');
  }
  if (own(record.ovr, 'crop')) patchCrop(fill, record.ovr.crop!);
}
