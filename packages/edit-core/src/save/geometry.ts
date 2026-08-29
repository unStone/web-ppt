import type {
  CustomGeometry, CustomGeometryCommand, CustomGeometryPoint, CustomGeometryScalar,
} from '@web-ppt/core';
import { own } from '../data-validation';
import { insertXmlChildUnchecked, removeXmlChild, replaceXmlChildren } from '../xml/nodes';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import { setXmlAttribute } from '../xml/mutate';
import type { XmlDocument, XmlElement } from '../xml/types';
import type { ElementRecord } from '../types';
import { locateElementHost } from './xfrm';
import { namespacedElement } from './xml-element';

const coordinate = (value: number, label: string): string => {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded)) throw new Error(`${label} 超出 OOXML 安全整数范围`);
  return String(rounded);
};

const expression = (value: CustomGeometryScalar, label: string): string => {
  if (!value.expression || value.expression.length > 4096) throw new Error(`${label} 的公式无效`);
  return value.expression;
};

function point(parent: XmlElement, value: CustomGeometryPoint, label: string): void {
  const node = namespacedElement(parent, DRAWINGML_NS, 'pt');
  setXmlAttribute(node, 'x', expression(value.x, `${label}.x`));
  setXmlAttribute(node, 'y', expression(value.y, `${label}.y`));
  insertXmlChildUnchecked(parent, node);
}

function pathCommand(parent: XmlElement, command: CustomGeometryCommand, label: string): void {
  const names = {
    move: 'moveTo', line: 'lnTo', cubic: 'cubicBezTo', quadratic: 'quadBezTo', arc: 'arcTo',
    close: 'close',
  } as const;
  const node = namespacedElement(parent, DRAWINGML_NS, names[command.type]);
  if (command.type === 'arc') {
    setXmlAttribute(node, 'wR', expression(command.widthRadius, `${label}.wR`));
    setXmlAttribute(node, 'hR', expression(command.heightRadius, `${label}.hR`));
    setXmlAttribute(node, 'stAng', expression(command.startAngle, `${label}.stAng`));
    setXmlAttribute(node, 'swAng', expression(command.sweepAngle, `${label}.swAng`));
  } else command.points.forEach((value, index) => point(node, value, `${label}.points[${index}]`));
  insertXmlChildUnchecked(parent, node);
}

function pathList(parent: XmlElement, geometry: CustomGeometry): XmlElement {
  const list = namespacedElement(parent, DRAWINGML_NS, 'pathLst');
  geometry.paths.forEach((value, pathIndex) => {
    const path = namespacedElement(list, DRAWINGML_NS, 'path');
    setXmlAttribute(path, 'w', coordinate(value.width, `paths[${pathIndex}].width`));
    setXmlAttribute(path, 'h', coordinate(value.height, `paths[${pathIndex}].height`));
    setXmlAttribute(path, 'fill', value.fill);
    setXmlAttribute(path, 'stroke', value.stroke ? '1' : '0');
    setXmlAttribute(path, 'extrusionOk', value.extrusionOk ? '1' : '0');
    value.commands.forEach((command, commandIndex) =>
      pathCommand(path, command, `paths[${pathIndex}].commands[${commandIndex}]`));
    if (value.closed) insertXmlChildUnchecked(path, namespacedElement(path, DRAWINGML_NS, 'close'));
    insertXmlChildUnchecked(list, path);
  });
  return list;
}

function emptyList(parent: XmlElement, name: string): XmlElement {
  const list = namespacedElement(parent, DRAWINGML_NS, name);
  insertXmlChildUnchecked(parent, list);
  return list;
}

function newCustomGeometry(properties: XmlElement, geometry: CustomGeometry): XmlElement {
  const custom = namespacedElement(properties, DRAWINGML_NS, 'custGeom');
  emptyList(custom, 'avLst');
  emptyList(custom, 'gdLst');
  emptyList(custom, 'ahLst');
  emptyList(custom, 'cxnLst');
  const rect = namespacedElement(custom, DRAWINGML_NS, 'rect');
  for (const [name, value] of Object.entries({ l: '0', t: '0', r: 'r', b: 'b' })) {
    setXmlAttribute(rect, name, value);
  }
  insertXmlChildUnchecked(custom, rect);
  insertXmlChildUnchecked(custom, pathList(custom, geometry));
  return custom;
}

function shapeProperties(document: XmlDocument, record: ElementRecord): XmlElement {
  const { host } = locateElementHost(document, record);
  const properties = findXmlChild(host, { localName: 'spPr', namespaceUri: PRESENTATIONML_NS });
  if (!properties) throw new Error(`元素 ${record.id} 缺少 p:spPr`);
  return properties;
}

export function hasGeometryOverride(record: ElementRecord): boolean {
  return own(record.ovr, 'geometry');
}

/** 来源 custGeom 只换 pathLst；调整公式、手柄、连接点和未知扩展继续占原槽位。 */
export function patchElementGeometry(document: XmlDocument, record: ElementRecord): void {
  if (!hasGeometryOverride(record)) return;
  const geometry = record.ovr.geometry!;
  const properties = shapeProperties(document, record);
  const current = xmlElementChildren(properties).find((child) =>
    child.namespaceUri === DRAWINGML_NS && ['custGeom', 'prstGeom'].includes(child.localName));
  if (!current) throw new Error(`元素 ${record.id} 缺少来源几何节点`);
  if (current.localName === 'custGeom') {
    const existing = findXmlChild(current, { localName: 'pathLst', namespaceUri: DRAWINGML_NS });
    if (!existing) throw new Error(`元素 ${record.id} 的 custGeom 缺少 pathLst`);
    replaceXmlChildren(current, existing, [pathList(current, geometry)]);
    return;
  }
  const replacement = newCustomGeometry(properties, geometry);
  replaceXmlChildren(properties, current, [replacement]);
  // 同一 spPr 内不允许第二个几何节点；畸形来源也收敛成显式转换结果。
  for (const child of [...xmlElementChildren(properties)]) {
    if (child !== replacement && child.namespaceUri === DRAWINGML_NS
      && ['custGeom', 'prstGeom'].includes(child.localName)) removeXmlChild(properties, child);
  }
}
