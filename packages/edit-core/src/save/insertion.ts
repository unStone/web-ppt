import { cloneXmlNodeWithNamespaceClosure, removeXmlChild } from '../xml/nodes';
import { insertXmlChild } from '../xml/order';
import { findXmlAttribute, findXmlChild, findXmlDescendant, xmlElementChildren } from '../xml/query';
import { setXmlAttribute } from '../xml/mutate';
import { parseXmlTree } from '../xml/tree';
import type { XmlDocument, XmlElement } from '../xml/types';
import type { EditDoc, ElementRecord, RemovedElementRecord } from '../types';
import { elementOrder } from '../element-order';
import { compareFractionalIndex } from '../fractional-index';
import { elementNonVisualProperties, locateElementHost, locateElementHosts } from './xfrm';
import { materializeElementOverrides } from './materialize';
import { patchRemovedElement } from './remove-element';
import type { HyperlinkSaveContext } from './hyperlink';
import { isCanvasRoot } from '../design-target';

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
  for (const spid of source?.unmodeledSpids ?? []) activeSpids.add(spid);
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
  options: {
    skipInsertions?: ReadonlySet<string>;
    skipReparents?: ReadonlySet<string>;
    scope?: ReadonlySet<string>;
    links?: HyperlinkSaveContext;
    sourceOnly?: boolean;
  } = {},
): void {
  const inserted = patchInsertedElements(document, doc, records, options.skipInsertions, options.sourceOnly);
  patchReparentedElements(document, doc, records, options.skipReparents);
  // 解组要先把仍存活的孩子移出来源组，再删除旧组宿主。
  for (const removal of removals) patchRemovedElement(document, removal);
  if (!options.sourceOnly) materializeElementOverrides(document, doc, part, records, options.scope, inserted, options.links);
}

/** 从来源基线构造当前有效元素树，供复制原始宿主及其所有后代。 */
export function materializeElementRoots(
  doc: EditDoc,
  roots: readonly ElementRecord[],
  source: Uint8Array,
  sourceOnly = false,
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
  materializeElementTreeState(document, doc, part, records, removals, { scope, sourceOnly });
  // 剪贴板复制的是逻辑对象：把备用分支的别名收敛到模型身份，粘贴时一起分配新 spid。
  for (const record of records) {
    if (record.meta.editable !== 'frame' || record.meta.origin?.part !== part) continue;
    for (const properties of elementNonVisualProperties(document, record)) {
      setXmlAttribute(properties, 'id', String(record.meta.origin.spid));
    }
  }
  return document;
}

export function materializeInsertionFragment(doc: EditDoc, record: ElementRecord, sourceOnly = false): XmlDocument {
  const source = record.meta.insertion!;
  const declarations = Object.entries(source.namespaces)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');
  const wrapper = parseXmlTree(`<clipboard${declarations}>${source.markup}</clipboard>`);
  const host = xmlElementChildren(wrapper.root)[0];
  if (!host || xmlElementChildren(wrapper.root).length !== 1) {
    throw new Error(`新建元素 ${record.id} 的 OOXML 宿主片段无效`);
  }
  const spids = new Map(Object.entries(source.spids));
  const pending = new Set(spids.keys());
  const relationships = new Map((source.relationships ?? [])
    .map((relationship) => [relationship.sourceId, relationship.targetId]));
  const visit = (element: XmlElement): void => {
    if (element.localName === 'cNvPr') {
      const id = findXmlAttribute(element, { localName: 'id', namespaceUri: null });
      const next = id && spids.get(id.value);
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
  const records = source.containsDescendants === false ? [record] : collectRecords(doc, [record.id]);
  const scope = new Set(records.map((current) => current.id));
  const part = record.meta.origin!.part;
  pruneInactiveInsertionHosts(wrapper, source, records, part);
  const removals = Object.values(doc.removedElements).filter((removed) =>
    removed.meta.origin?.part === part && scope.has(removed.parent));
  const roots = new Set([record.id]);
  materializeElementTreeState(wrapper, doc, part, records, removals, {
    skipInsertions: roots, skipReparents: roots, scope, sourceOnly,
  });
  return wrapper;
}

function detachedHost(doc: EditDoc, record: ElementRecord, sourceOnly: boolean, parent: XmlElement): XmlElement {
  const wrapper = materializeInsertionFragment(doc, record, sourceOnly);
  const host = xmlElementChildren(wrapper.root)[0]!;
  // 片段在临时祖先上绑定前缀；移入页面前必须带走闭包，否则浏览器会拒绝整页 XML。
  return cloneXmlNodeWithNamespaceClosure(host, parent);
}

function targetParent(document: XmlDocument, doc: EditDoc, record: ElementRecord): XmlElement {
  if (doc.slides[record.parent] || doc.layouts[record.parent] || doc.masters[record.parent]) {
    const common = findXmlDescendant(document.root, { localName: 'cSld' });
    const tree = common && findXmlChild(common, { localName: 'spTree' });
    if (!tree) throw new Error(`目标画布缺少 p:spTree：${record.id}`);
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
  sourceOnly = false,
): Set<string> {
  const materialized = new Set<string>();
  const candidates = new Set(records
    .filter((record) => record.meta.insertion && !skip.has(record.id))
    .map((record) => record.id));
  const depth = (record: ElementRecord): number => {
    let value = 0;
    let parent = record.parent;
    while (!isCanvasRoot(doc, parent)) {
      value++;
      const ancestor = doc.elements[parent];
      if (!ancestor) break;
      parent = ancestor.parent;
    }
    return value;
  };
  for (const record of [...records].sort((left, right) => {
    const depthOrder = depth(left) - depth(right);
    if (depthOrder) return depthOrder;
    // Record 目录的插入顺序取决于补丁到达先后；持久化顺序只能信模型的分数序。
    if (left.parent === right.parent) return compareFractionalIndex(elementOrder(left), elementOrder(right));
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  })) {
    if (!candidates.has(record.id)) continue;
    let ancestor = record.parent;
    let covered = false;
    while (!isCanvasRoot(doc, ancestor)) {
      if (candidates.has(ancestor) && doc.elements[ancestor]?.meta.insertion?.containsDescendants !== false) {
        covered = true;
        break;
      }
      const parent = doc.elements[ancestor];
      if (!parent) break;
      ancestor = parent.parent;
    }
    if (covered) continue;
    const parent = targetParent(document, doc, record);
    insertXmlChild(parent, detachedHost(doc, record, sourceOnly, parent));
    const mark = (id: string): void => {
      if (materialized.has(id)) return;
      materialized.add(id);
      for (const child of doc.elements[id]?.children ?? []) mark(child);
    };
    mark(record.id);
  }
  return materialized;
}

/** 层级编辑移动原宿主本身，未知扩展、关系引用与 spid 因此都不需要重建。 */
export function patchReparentedElements(
  document: XmlDocument,
  doc: EditDoc,
  records: readonly ElementRecord[],
  skip?: ReadonlySet<string>,
): void {
  // 粘贴片段里的可编辑孩子没有独立插入来源，仍须按当前父链移动；只读兼容投影不拆壳。
  const moved = records.filter((record) => !skip?.has(record.id)
    && (record.meta.sourceParent !== undefined
      || (record.meta.created && !record.meta.insertion && record.meta.origin && record.meta.editable !== 'none')));
  if (!moved.length) return;
  const located = locateElementHosts(document, moved);
  for (const record of moved) {
    const location = located.get(record.id)!;
    const target = targetParent(document, doc, record);
    if (location.parent === target) continue;
    if (!removeXmlChild(location.parent, location.host)) throw new Error(`无法移动元素宿主：${record.id}`);
    insertXmlChild(target, location.host);
  }
}
