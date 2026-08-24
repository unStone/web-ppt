import { insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { findXmlAttribute, findXmlChild, findXmlDescendant, xmlElementChildren } from '../xml/query';
import { setXmlAttribute } from '../xml/mutate';
import { parseXmlTree } from '../xml/tree';
import type { XmlDocument, XmlElement } from '../xml/types';
import type { EditDoc, ElementRecord } from '../types';
import { locateElementHost } from './xfrm';

const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const escapeAttribute = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function detachedHost(record: ElementRecord): XmlElement {
  const source = record.meta.insertion!;
  const declarations = Object.entries(source.namespaces)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');
  const wrapper = parseXmlTree(`<clipboard${declarations}>${source.markup}</clipboard>`);
  const host = xmlElementChildren(wrapper.root)[0];
  if (!host || xmlElementChildren(wrapper.root).length !== 1) {
    throw new Error(`新建元素 ${record.id} 的 OOXML 宿主片段无效`);
  }
  if (!removeXmlChild(wrapper.root, host)) throw new Error(`无法分离新建元素宿主：${record.id}`);
  const pending = new Map(Object.entries(source.spids));
  const relationships = new Map((source.relationships ?? [])
    .map((relationship) => [relationship.sourceId, relationship.targetId]));
  const visit = (element: XmlElement): void => {
    if (element.localName === 'cNvPr') {
      const id = findXmlAttribute(element, { localName: 'id', namespaceUri: null });
      const next = id && pending.get(id.value);
      if (id && next !== undefined) {
        const previous = id.value;
        setXmlAttribute(element, id.name, String(next));
        pending.delete(previous);
      }
    }
    for (const attribute of element.attributes) {
      if (attribute.namespaceUri !== OFFICE_REL_NS) continue;
      const target = relationships.get(attribute.value);
      if (target) setXmlAttribute(element, attribute.name, target);
    }
    for (const child of xmlElementChildren(element)) visit(child);
  };
  visit(host);
  if (pending.size) throw new Error(`新建元素 ${record.id} 的 spid 无法完整重映射`);
  return host;
}

function targetParent(document: XmlDocument, doc: EditDoc, record: ElementRecord): XmlElement {
  if (doc.slides[record.parent]) {
    const common = findXmlDescendant(document.root, { localName: 'cSld' });
    const tree = common && findXmlChild(common, { localName: 'spTree' });
    if (!tree) throw new Error(`目标幻灯片缺少 p:spTree：${record.id}`);
    return tree;
  }
  const parent = doc.elements[record.parent];
  if (!parent || parent.src.kind !== 'group') throw new Error(`新建元素父级不是组合：${record.id}`);
  return locateElementHost(document, parent).host;
}

/** 新宿主先进入目标树，后续变换与层级补丁才能继续复用统一的 spid 定位。 */
export function patchInsertedElements(document: XmlDocument, doc: EditDoc, records: readonly ElementRecord[]): void {
  for (const record of records) {
    if (!record.meta.insertion) continue;
    insertXmlChildUnchecked(targetParent(document, doc, record), detachedHost(record));
  }
}
