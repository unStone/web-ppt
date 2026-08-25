import type { Fill } from '@web-ppt/core';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import { insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS } from '../xml/qname';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import type { XmlElement } from '../xml/types';
import { namespacedElement } from './xml-element';

type ImageFill = Extract<Fill, { type: 'image' }>;
const FILL_NAMES = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']);

function drawingChild(parent: XmlElement, name: string): XmlElement | null {
  return findXmlChild(parent, { localName: name, namespaceUri: DRAWINGML_NS });
}

function ensureBefore(
  parent: XmlElement,
  name: string,
  beforeNames: readonly string[] = [],
): XmlElement {
  const found = drawingChild(parent, name);
  if (found) return found;
  const node = namespacedElement(parent, DRAWINGML_NS, name);
  const before = xmlElementChildren(parent).find((child) =>
    child.namespaceUri === DRAWINGML_NS && beforeNames.includes(child.localName));
  insertXmlChildUnchecked(parent, node, before ?? null);
  return node;
}

function patchAlpha(blip: XmlElement, alpha: number | undefined): void {
  const node = drawingChild(blip, 'alphaModFix');
  if (alpha === undefined) {
    if (node) removeXmlChild(blip, node);
    return;
  }
  const target = node ?? ensureBefore(blip, 'alphaModFix', ['extLst']);
  setXmlAttribute(target, 'amt', String(Math.round(alpha * 100000)));
}

function hasUnknownCropContent(node: XmlElement): boolean {
  return node.attributes.some((attribute) => !['l', 't', 'r', 'b'].includes(attribute.localName))
    || xmlElementChildren(node).length > 0;
}

function patchCrop(fill: XmlElement, crop: ImageFill['crop']): void {
  const current = drawingChild(fill, 'srcRect');
  if (!crop) {
    if (!current) return;
    for (const field of ['l', 't', 'r', 'b']) removeXmlAttribute(current, field);
    // 未知扩展留在原槽位；无扩展的空 srcRect 可直接删掉以保持最小 XML。
    if (!hasUnknownCropContent(current)) removeXmlChild(fill, current);
    return;
  }
  const node = current ?? ensureBefore(fill, 'srcRect', ['tile', 'stretch']);
  for (const field of ['l', 't', 'r', 'b'] as const) {
    setXmlAttribute(node, field, String(Math.round(crop[field] * 100000)));
  }
}

function patchPlacement(fill: XmlElement, image: ImageFill): void {
  const tile = drawingChild(fill, 'tile');
  const stretch = drawingChild(fill, 'stretch');
  if (image.tile) {
    if (stretch) removeXmlChild(fill, stretch);
    const target = tile ?? ensureBefore(fill, 'tile');
    setXmlAttribute(target, 'sx', String(Math.round(image.tile.sx * 100000)));
    setXmlAttribute(target, 'sy', String(Math.round(image.tile.sy * 100000)));
    setXmlAttribute(target, 'flip', image.tile.flip);
    setXmlAttribute(target, 'tx', String(Math.round((image.tile.tx ?? 0) * 9525)));
    setXmlAttribute(target, 'ty', String(Math.round((image.tile.ty ?? 0) * 9525)));
    setXmlAttribute(target, 'algn', image.tile.algn ?? 'tl');
    return;
  }
  if (tile) removeXmlChild(fill, tile);
  const target = stretch ?? ensureBefore(fill, 'stretch');
  ensureBefore(target, 'fillRect');
}

/** 已有 blipFill 原位修改，未知属性、效果和扩展不因编辑已知字段而丢失。 */
export function patchBackgroundImageFill(
  properties: XmlElement,
  image: ImageFill,
  relationshipId: string,
  preserveSourceDpi: boolean,
): void {
  let fill = drawingChild(properties, 'blipFill');
  for (const child of [...xmlElementChildren(properties)]) {
    if (child.namespaceUri !== DRAWINGML_NS || !FILL_NAMES.has(child.localName)) continue;
    if (child === fill) continue;
    removeXmlChild(properties, child);
  }
  if (!fill) {
    fill = namespacedElement(properties, DRAWINGML_NS, 'blipFill');
    insertXmlInOrder(properties, fill);
  }
  if (!preserveSourceDpi) removeXmlAttribute(fill, 'dpi');
  const blip = ensureBefore(fill, 'blip', ['srcRect', 'tile', 'stretch']);
  setXmlAttribute(blip, 'r:embed', relationshipId);
  removeXmlAttribute(blip, 'r:link');
  patchAlpha(blip, image.alpha);
  patchCrop(fill, image.crop);
  patchPlacement(fill, image);
}
