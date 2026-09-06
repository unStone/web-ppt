import { registeredEditExtensions } from '../extension-runtime';
import type { SlideElement } from '@web-ppt/core';
import type { ElementRecord } from '../types';
import type { XmlDocument } from '../xml/types';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import { removeXmlChild, insertXmlChildUnchecked } from '../xml/nodes';
import { setXmlAttribute } from '../xml/mutate';
import { insertXmlInOrder } from '../xml/order';
import { locateElementHost } from './xfrm';
import { namespacedElement } from './xml-element';
import { appendDrawingColor } from './drawing-color';

// XML 树的私有 WeakMap 属于创建它的模块实例，扩展必须用树所有者的操作器写入。
const xml = { findXmlChild, xmlElementChildren, removeXmlChild, insertXmlChildUnchecked,
  setXmlAttribute, insertXmlInOrder, locateElementHost, namespacedElement, appendDrawingColor };
export type EditElementXml = typeof xml;

export function hasElementExtensionOverrides(record: ElementRecord): boolean {
  return Object.keys(record.ovr.extensions ?? {}).some((key) => registeredEditExtensions().get(key)?.materialize);
}

export function materializeElementExtensions(tree: XmlDocument, record: ElementRecord, generated: boolean): void {
  for (const runtime of registeredEditExtensions().values()) runtime.materialize?.(tree, record, generated, xml);
}

export function extensionSupportsGenerated(element: SlideElement): boolean {
  return [...registeredEditExtensions().values()].some((runtime) => runtime.supportsGenerated?.(element));
}
