import type { XmlAttribute, XmlDocument, XmlElement, XmlNode } from './types';

export interface XmlNodeState {
  raw: string;
  parent: XmlDocument | XmlElement | null;
  dirty: boolean;
}

export interface XmlAttributeState {
  source: boolean;
  present: boolean;
  changed: boolean;
  /** 起点含属性名前的空白，删除时不会留下双空格。 */
  start: number;
  nameStart: number;
  valueStart: number;
  valueEnd: number;
  end: number;
}

export interface XmlElementState extends XmlNodeState {
  openRaw: string;
  closeRaw: string;
  sourceSelfClosing: boolean;
  sourceAttributes: XmlAttribute[];
  namespaces: ReadonlyMap<string, string>;
}

export const nodeStates = new WeakMap<XmlDocument | XmlNode, XmlNodeState>();
export const elementStates = new WeakMap<XmlElement, XmlElementState>();
export const attributeStates = new WeakMap<XmlAttribute, XmlAttributeState>();

export function nodeState(node: XmlDocument | XmlNode): XmlNodeState {
  const state = nodeStates.get(node);
  if (!state) throw new Error('XML 节点不属于保留型 XML 树');
  return state;
}

export function elementState(element: XmlElement): XmlElementState {
  const state = elementStates.get(element);
  if (!state) throw new Error('XML 元素不属于保留型 XML 树');
  return state;
}

export function markXmlDirty(node: XmlDocument | XmlNode): void {
  let current: XmlDocument | XmlNode | null = node;
  while (current) {
    const state = nodeState(current);
    if (state.dirty) break;
    state.dirty = true;
    current = state.parent;
  }
}
