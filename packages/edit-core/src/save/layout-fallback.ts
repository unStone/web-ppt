import { PLACEHOLDER_DIRECT_BITS } from '@web-ppt/core';
import type { GeomSpec, SlideElement } from '@web-ppt/core';
import { cloneXmlNodeWithNamespaceClosure, insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import { setXmlAttribute } from '../xml/mutate';
import type { XmlDocument, XmlElement } from '../xml/types';
import type { ElementRecord } from '../types';
import { materializeElementEffects } from './effects';
import { materializeElementFill, materializeElementStroke } from './shape-format';
import { namespacedElement } from './xml-element';
import { locateElementHost, materializeElementXfrm } from './xfrm';

function shapeProperties(document: XmlDocument, record: ElementRecord): XmlElement {
  const { host } = locateElementHost(document, record);
  const properties = findXmlChild(host, { localName: 'spPr', namespaceUri: PRESENTATIONML_NS });
  if (!properties) throw new Error(`元素 ${record.id} 缺少 p:spPr`);
  return properties;
}

function materializeGeometry(
  document: XmlDocument,
  record: ElementRecord,
  geom: GeomSpec | undefined,
  sourceGeometry?: XmlElement,
): void {
  if (!geom && !sourceGeometry) return;
  const properties = shapeProperties(document, record);
  for (const child of [...xmlElementChildren(properties)]) {
    if (child.namespaceUri === DRAWINGML_NS && ['prstGeom', 'custGeom'].includes(child.localName)) {
      removeXmlChild(properties, child);
    }
  }
  if (sourceGeometry) {
    insertXmlInOrder(properties, cloneXmlNodeWithNamespaceClosure(sourceGeometry));
    return;
  }
  if (!geom) return;
  const preset = namespacedElement(properties, DRAWINGML_NS, 'prstGeom');
  setXmlAttribute(preset, 'prst', geom.preset);
  insertXmlInOrder(properties, preset);
  const adjustments = namespacedElement(preset, DRAWINGML_NS, 'avLst');
  insertXmlChildUnchecked(preset, adjustments);
  for (const name of Object.keys(geom.adj)) {
    const value = geom.adj[name] as number;
    const guide = namespacedElement(adjustments, DRAWINGML_NS, 'gd');
    setXmlAttribute(guide, 'name', name);
    setXmlAttribute(guide, 'fmla', `val ${Math.round(value)}`);
    insertXmlChildUnchecked(adjustments, guide);
  }
}

/**
 * 目标版式没有对应占位符时，只固定原来由旧版式继承的字段；页面本来直设的 XML 必须逐字保留。
 */
export function materializeLayoutFallback(
  document: XmlDocument,
  record: ElementRecord,
  effective: SlideElement,
  geom: GeomSpec | undefined,
  sourceGeometry?: XmlElement,
): void {
  const direct = record.meta.placeholderDirect ?? 0;
  const styled = !!(direct & PLACEHOLDER_DIRECT_BITS.style);
  if (!(direct & PLACEHOLDER_DIRECT_BITS.transform)) {
    materializeElementXfrm(document, record, effective);
  }
  if ((record.src.kind === 'shape' || record.src.kind === 'image')
    && !(direct & PLACEHOLDER_DIRECT_BITS.geometry)) {
    materializeGeometry(document, record, geom, sourceGeometry);
  }
  if (record.src.kind === 'shape' && effective.kind === 'shape') {
    if (!styled && !(direct & PLACEHOLDER_DIRECT_BITS.fill)) {
      materializeElementFill(
        document, record, effective.fill?.type === 'image' ? { type: 'none' } : effective.fill,
      );
    }
    if (!styled && !(direct & PLACEHOLDER_DIRECT_BITS.stroke) && effective.stroke) {
      materializeElementStroke(document, record, effective.stroke);
    }
  } else if (record.src.kind === 'image' && effective.kind === 'image'
    && !styled && !(direct & PLACEHOLDER_DIRECT_BITS.stroke) && effective.stroke) {
    materializeElementStroke(document, record, effective.stroke);
  }
  if ((record.src.kind === 'shape' || record.src.kind === 'image' || record.src.kind === 'group')
    && !styled && !(direct & PLACEHOLDER_DIRECT_BITS.effects)
    && effective.effects) {
    materializeElementEffects(document, record, effective.effects);
  }
}
