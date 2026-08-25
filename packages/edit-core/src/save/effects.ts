import type { Effects } from '@web-ppt/core';
import { own } from '../data-validation';
import type { ElementRecord } from '../types';
import { removeXmlChild } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import { setXmlAttribute } from '../xml/mutate';
import type { XmlDocument, XmlElement } from '../xml/types';
import { appendDrawingColor } from './drawing-color';
import { namespacedElement } from './xml-element';
import { locateElementHost } from './xfrm';

const emu = (value: number): string => String(Math.round(value * 9525));
const fixed = (value: number): string => String(Math.round(value * 100000));

function addEffect(list: XmlElement, name: string): XmlElement {
  const node = namespacedElement(list, DRAWINGML_NS, name);
  insertXmlInOrder(list, node);
  return node;
}

function appendShadow(list: XmlElement, shadow: NonNullable<Effects['shadow']>): void {
  const node = addEffect(list, shadow.inner ? 'innerShdw' : 'outerShdw');
  const distance = Math.hypot(shadow.dx, shadow.dy);
  let direction = Math.round(Math.atan2(shadow.dy, shadow.dx) * 180 / Math.PI * 60000);
  direction = ((direction % 21600000) + 21600000) % 21600000;
  setXmlAttribute(node, 'blurRad', emu(shadow.blur));
  setXmlAttribute(node, 'dist', emu(distance));
  setXmlAttribute(node, 'dir', String(direction));
  appendDrawingColor(node, shadow.color);
}

function appendReflection(list: XmlElement, reflection: NonNullable<Effects['reflection']>): void {
  const node = addEffect(list, 'reflection');
  setXmlAttribute(node, 'blurRad', '0');
  setXmlAttribute(node, 'stA', fixed(reflection.alpha));
  setXmlAttribute(node, 'stPos', '0');
  setXmlAttribute(node, 'endA', '0');
  setXmlAttribute(node, 'endPos', fixed(reflection.size));
  setXmlAttribute(node, 'dist', emu(reflection.distance));
  setXmlAttribute(node, 'dir', '5400000');
  // PowerPoint 与 LibreOffice 都依赖 fadeDir 才会把 endPos 解释为垂直淡出，而非退化为不可见预设。
  setXmlAttribute(node, 'fadeDir', '5400000');
  setXmlAttribute(node, 'sy', '-100000');
  setXmlAttribute(node, 'algn', 'bl');
  setXmlAttribute(node, 'rotWithShape', '0');
}

function appendEffects(list: XmlElement, effects: Effects): void {
  if (effects.glow) {
    const glow = addEffect(list, 'glow');
    setXmlAttribute(glow, 'rad', emu(effects.glow.radius));
    appendDrawingColor(glow, effects.glow.color);
  }
  if (effects.shadow) appendShadow(list, effects.shadow);
  if (effects.reflection) appendReflection(list, effects.reflection);
  if (effects.softEdge !== undefined) {
    const softEdge = addEffect(list, 'softEdge');
    setXmlAttribute(softEdge, 'rad', emu(effects.softEdge));
  }
}

function shapeProperties(document: XmlDocument, record: ElementRecord): XmlElement {
  const { host } = locateElementHost(document, record);
  const localName = record.src.kind === 'group' ? 'grpSpPr' : 'spPr';
  const properties = findXmlChild(host, { localName, namespaceUri: PRESENTATIONML_NS });
  if (!properties) throw new Error(`元素 ${record.id} 缺少 p:${localName}`);
  return properties;
}

export function hasEffectsOverride(record: ElementRecord): boolean {
  return own(record.ovr, 'effects');
}

export function materializeElementEffects(
  document: XmlDocument,
  record: ElementRecord,
  effects: Effects,
): void {
  const properties = shapeProperties(document, record);
  let list = findXmlChild(properties, { localName: 'effectLst', namespaceUri: DRAWINGML_NS });
  const dag = findXmlChild(properties, { localName: 'effectDag', namespaceUri: DRAWINGML_NS });
  if (dag) removeXmlChild(properties, dag);
  if (!list) {
    list = namespacedElement(properties, DRAWINGML_NS, 'effectLst');
    insertXmlInOrder(properties, list);
  }
  // SetEffects 是完整替换；保留 effectLst 自身未知属性和宿主邻接节点，但不混入旧效果图。
  for (const child of xmlElementChildren(list)) removeXmlChild(list, child);
  appendEffects(list, effects);
}

export function patchElementEffects(document: XmlDocument, record: ElementRecord): void {
  if (!hasEffectsOverride(record)) return;
  materializeElementEffects(document, record, record.ovr.effects ?? {});
}
