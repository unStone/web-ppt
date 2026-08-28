import type { Fill, LineEnd, Stroke } from '@web-ppt/core';
import { own } from '../data-validation';
import { strokeDashName } from '../shape-stroke';
import type { ElementRecord } from '../types';
import { insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import type { XmlDocument, XmlElement } from '../xml/types';
import { namespacedElement } from './xml-element';
import { locateElementHost } from './xfrm';
import { appendDrawingColor } from './drawing-color';
import { patchBackgroundImageFill } from './background-image';

const FILL_NAMES = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']);
const LINE_CONTROLLED = new Set([
  ...FILL_NAMES, 'prstDash', 'custDash', 'round', 'bevel', 'miter', 'headEnd', 'tailEnd',
]);

export function appendVectorFill(
  properties: XmlElement,
  fill: Exclude<Fill, { type: 'image' }>,
): void {
  const node = namespacedElement(properties, DRAWINGML_NS,
    fill.type === 'none' ? 'noFill'
      : fill.type === 'solid' ? 'solidFill'
        : fill.type === 'gradient' ? 'gradFill' : 'pattFill');
  insertXmlInOrder(properties, node);
  if (fill.type === 'none') return;
  if (fill.type === 'solid') {
    appendDrawingColor(node, fill.color);
    return;
  }
  if (fill.type === 'gradient') {
    setXmlAttribute(node, 'rotWithShape', '1');
    const list = namespacedElement(node, DRAWINGML_NS, 'gsLst');
    insertXmlChildUnchecked(node, list);
    for (const stop of fill.stops) {
      const item = namespacedElement(list, DRAWINGML_NS, 'gs');
      setXmlAttribute(item, 'pos', String(Math.round(stop.pos * 100000)));
      insertXmlChildUnchecked(list, item);
      appendDrawingColor(item, stop.color);
    }
    const direction = namespacedElement(node, DRAWINGML_NS, fill.radial ? 'path' : 'lin');
    if (fill.radial) setXmlAttribute(direction, 'path', 'circle');
    else {
      setXmlAttribute(direction, 'ang', String(Math.round(fill.angle * 60000)));
      setXmlAttribute(direction, 'scaled', '1');
    }
    insertXmlChildUnchecked(node, direction);
    return;
  }
  setXmlAttribute(node, 'prst', fill.preset);
  const foreground = namespacedElement(node, DRAWINGML_NS, 'fgClr');
  insertXmlChildUnchecked(node, foreground);
  appendDrawingColor(foreground, fill.fg);
  const background = namespacedElement(node, DRAWINGML_NS, 'bgClr');
  insertXmlChildUnchecked(node, background);
  appendDrawingColor(background, fill.bg);
}

export function removeDrawingFillChildren(properties: XmlElement): void {
  for (const child of xmlElementChildren(properties)) {
    if (child.namespaceUri === DRAWINGML_NS && FILL_NAMES.has(child.localName)) {
      removeXmlChild(properties, child);
    }
  }
}

function lineEnd(line: XmlElement, name: 'headEnd' | 'tailEnd', value: LineEnd): void {
  const node = namespacedElement(line, DRAWINGML_NS, name);
  setXmlAttribute(node, 'type', value.type);
  setXmlAttribute(node, 'w', value.w === 2 ? 'sm' : value.w === 5 ? 'lg' : 'med');
  setXmlAttribute(node, 'len', value.h === 2 ? 'sm' : value.h === 5 ? 'lg' : 'med');
  insertXmlInOrder(line, node);
}

function patchLine(properties: XmlElement, stroke: Stroke | null, materializeDefaults = true): void {
  let line = findXmlChild(properties, { localName: 'ln', namespaceUri: DRAWINGML_NS });
  if (!line) {
    line = namespacedElement(properties, DRAWINGML_NS, 'ln');
    insertXmlInOrder(properties, line);
  }
  for (const child of xmlElementChildren(line)) {
    if (child.namespaceUri === DRAWINGML_NS && LINE_CONTROLLED.has(child.localName)) {
      removeXmlChild(line, child);
    }
  }
  for (const name of ['w', 'cap', 'cmpd'] as const) removeXmlAttribute(line, name);
  if (!stroke) {
    const none = namespacedElement(line, DRAWINGML_NS, 'noFill');
    insertXmlInOrder(line, none);
    return;
  }
  setXmlAttribute(line, 'w', String(Math.round(stroke.width * 9525)));
  const cap = stroke.cap;
  if (cap !== undefined || materializeDefaults) {
    const value = cap ?? 'butt';
    setXmlAttribute(line, 'cap', value === 'butt' ? 'flat' : value === 'round' ? 'rnd' : 'sq');
  }
  if (stroke.compound !== undefined || materializeDefaults) {
    setXmlAttribute(line, 'cmpd', stroke.compound ?? 'sng');
  }
  const solid = namespacedElement(line, DRAWINGML_NS, 'solidFill');
  insertXmlInOrder(line, solid);
  appendDrawingColor(solid, stroke.color);
  const dashName = strokeDashName(stroke);
  if (dashName || materializeDefaults) {
    const dash = namespacedElement(line, DRAWINGML_NS, 'prstDash');
    setXmlAttribute(dash, 'val', dashName ?? 'solid');
    insertXmlInOrder(line, dash);
  }
  if (stroke.join !== undefined || materializeDefaults) {
    const joinName = stroke.join ?? 'miter';
    const join = namespacedElement(line, DRAWINGML_NS, joinName === 'round' ? 'round'
      : joinName === 'bevel' ? 'bevel' : 'miter');
    insertXmlInOrder(line, join);
  }
  const noEnd: LineEnd = { type: 'none', w: 3, h: 3 };
  if (stroke.head !== undefined || materializeDefaults) lineEnd(line, 'headEnd', stroke.head ?? noEnd);
  if (stroke.tail !== undefined || materializeDefaults) lineEnd(line, 'tailEnd', stroke.tail ?? noEnd);
}

function shapeProperties(document: XmlDocument, record: ElementRecord): XmlElement {
  const { host } = locateElementHost(document, record);
  const properties = findXmlChild(host, { localName: 'spPr', namespaceUri: PRESENTATIONML_NS });
  if (!properties) throw new Error(`元素 ${record.id} 缺少 p:spPr`);
  return properties;
}

/** 目标版式不再提供占位符时，把旧版式的有效矢量填充固定到页面宿主。 */
export function materializeElementFill(
  document: XmlDocument,
  record: ElementRecord,
  fill: Exclude<Fill, { type: 'image' }> | null,
): void {
  const properties = shapeProperties(document, record);
  removeDrawingFillChildren(properties);
  appendVectorFill(properties, fill ?? { type: 'none' });
}

export function materializeElementImageFill(
  document: XmlDocument,
  record: ElementRecord,
  fill: Extract<Fill, { type: 'image' }>,
  relationshipId: string,
): void {
  patchBackgroundImageFill(shapeProperties(document, record), fill, relationshipId, false);
}

export function materializeElementStroke(
  document: XmlDocument,
  record: ElementRecord,
  stroke: Stroke | null,
): void {
  patchLine(shapeProperties(document, record), stroke, false);
}

export function hasShapeFormatOverrides(record: ElementRecord): boolean {
  return own(record.ovr, 'fill') || own(record.ovr, 'stroke');
}

export function patchElementShapeFormat(document: XmlDocument, record: ElementRecord): void {
  if (!hasShapeFormatOverrides(record)) return;
  const properties = shapeProperties(document, record);
  if (own(record.ovr, 'fill')) {
    removeDrawingFillChildren(properties);
    appendVectorFill(properties, record.ovr.fill!);
  }
  if (own(record.ovr, 'stroke')) patchLine(properties, record.ovr.stroke ?? null);
}
