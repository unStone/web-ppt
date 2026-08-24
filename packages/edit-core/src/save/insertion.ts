import { insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { findXmlAttribute, findXmlChild, findXmlDescendant, xmlElementChildren } from '../xml/query';
import { setXmlAttribute } from '../xml/mutate';
import { parseXmlTree } from '../xml/tree';
import type { XmlDocument, XmlElement } from '../xml/types';
import type { EditDoc, ElementRecord, RemovedElementRecord } from '../types';
import { locateElementHost, locateElementHosts } from './xfrm';
import { materializeElementOverrides } from './materialize';
import { patchRemovedElement } from './remove-element';

const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const escapeAttribute = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function collectRecords(doc: EditDoc, roots: readonly string[]): ElementRecord[] {
  const records: ElementRecord[] = [];
  const visit = (id: string): void => {
    const current = doc.elements[id];
    if (!current) throw new Error(`新建元素树引用不存在的元素：${id}`);
    records.push(current);
    for (const child of current.children ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  return records;
}

/** created 后代删除不留 tombstone；用插入时固化的 spid 映射剪掉失活宿主。 */
function pruneInactiveInsertionHosts(
  document: XmlDocument,
  source: ElementRecord['meta']['insertion'],
  records: readonly ElementRecord[],
  part: string,
): void {
  const activeSpids = new Set(records.flatMap((record) =>
    record.meta.origin?.part === part ? [record.meta.origin.spid] : []));
  const inactive = Object.values(source!.spids).filter((spid) => !activeSpids.has(spid));
  if (!inactive.length) return;
  const probes = inactive.map((spid) => ({
    id: `inactive-${spid}`,
    meta: { editable: 'full' as const, origin: { part, spid } },
  }));
  const inactiveHosts = new Set([...locateElementHosts(document, probes).values()]
    .map((location) => location.host));
  const prune = (parent: XmlElement): void => {
    for (const child of [...xmlElementChildren(parent)]) {
      if (inactiveHosts.has(child)) removeXmlChild(parent, child);
      else prune(child);
    }
  };
  prune(document.root);
}

/** 删除、插入、覆盖的先后顺序与整页保存一致；复制片段也复用这一条物化路径。 */
export function materializeElementTreeState(
  document: XmlDocument,
  doc: EditDoc,
  part: string,
  records: readonly ElementRecord[],
  removals: readonly RemovedElementRecord[],
  options: { skipInsertions?: ReadonlySet<string>; scope?: ReadonlySet<string> } = {},
): void {
  for (const removal of removals) patchRemovedElement(document, removal);
  patchInsertedElements(document, doc, records, options.skipInsertions);
  materializeElementOverrides(document, doc, part, records, options.scope);
}

/** 从来源基线构造当前有效元素树，供复制原始宿主及其所有后代。 */
export function materializeElementRoots(
  doc: EditDoc,
  roots: readonly ElementRecord[],
  source: Uint8Array,
): XmlDocument {
  const document = parseXmlTree(source);
  const records = collectRecords(doc, roots.map((record) => record.id));
  const scope = new Set(records.map((record) => record.id));
  const part = roots[0]?.meta.origin?.part;
  if (!part || roots.some((record) => record.meta.origin?.part !== part)) {
    throw new Error('复制元素树缺少统一的 OOXML 来源 part');
  }
  const removals = Object.values(doc.removedElements).filter((record) =>
    record.meta.origin?.part === part && scope.has(record.parent));
  materializeElementTreeState(document, doc, part, records, removals, { scope });
  return document;
}

export function materializeInsertionFragment(doc: EditDoc, record: ElementRecord): XmlDocument {
  const source = record.meta.insertion!;
  const declarations = Object.entries(source.namespaces)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');
  const wrapper = parseXmlTree(`<clipboard${declarations}>${source.markup}</clipboard>`);
  const host = xmlElementChildren(wrapper.root)[0];
  if (!host || xmlElementChildren(wrapper.root).length !== 1) {
    throw new Error(`新建元素 ${record.id} 的 OOXML 宿主片段无效`);
  }
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
  const records = collectRecords(doc, [record.id]);
  const scope = new Set(records.map((current) => current.id));
  const part = record.meta.origin!.part;
  pruneInactiveInsertionHosts(wrapper, source, records, part);
  const removals = Object.values(doc.removedElements).filter((removed) =>
    removed.meta.origin?.part === part && scope.has(removed.parent));
  materializeElementTreeState(wrapper, doc, part, records, removals, {
    skipInsertions: new Set([record.id]), scope,
  });
  return wrapper;
}

function detachedHost(doc: EditDoc, record: ElementRecord): XmlElement {
  const wrapper = materializeInsertionFragment(doc, record);
  const host = xmlElementChildren(wrapper.root)[0]!;
  if (!removeXmlChild(wrapper.root, host)) throw new Error(`无法分离新建元素宿主：${record.id}`);
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
export function patchInsertedElements(
  document: XmlDocument,
  doc: EditDoc,
  records: readonly ElementRecord[],
  skip: ReadonlySet<string> = new Set(),
): void {
  const candidates = new Set(records
    .filter((record) => record.meta.insertion && !skip.has(record.id))
    .map((record) => record.id));
  for (const record of records) {
    if (!candidates.has(record.id)) continue;
    let ancestor = record.parent;
    let covered = false;
    while (!doc.slides[ancestor]) {
      if (candidates.has(ancestor)) {
        covered = true;
        break;
      }
      const parent = doc.elements[ancestor];
      if (!parent) break;
      ancestor = parent.parent;
    }
    if (covered) continue;
    insertXmlChildUnchecked(targetParent(document, doc, record), detachedHost(doc, record));
  }
}
