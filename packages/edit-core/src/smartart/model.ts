import { sha256 } from '@web-ppt/core';
import { parseXmlTree, serializeXmlTree, xmlElementChildren, createXmlElement, createXmlText,
  insertXmlChildUnchecked as append, removeXmlChild, setXmlAttribute,
  cloneXmlNodeWithNamespaceClosure as clone } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import { assertDataObject, assertDataArray } from '../data-validation';

export const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
export const DSP = 'http://schemas.microsoft.com/office/drawing/2008/diagram';
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const children = (node: XmlElement | null, name?: string) => node ? xmlElementChildren(node)
  .filter((n) => n.namespaceUri === node.namespaceUri && (!name || n.localName === name)) : [];
export const child = (node: XmlElement | null, name: string) => children(node, name)[0] ?? null;
export const attr = (node: XmlElement | null, name: string) => node?.attributes.find((a) => a.localName === name && !a.namespaceUri)?.value;
const content = (node: XmlElement): string => node.children.map((c): string => c.type === 'text' || c.type === 'cdata'
  ? c.value : c.type === 'element' ? content(c) : '').join('');
const descendants = (node: XmlElement, namespace: string, name: string): XmlElement[] => {
  const pending = [node], result: XmlElement[] = [];
  while (pending.length) { const current = pending.shift()!; if (current.namespaceUri === namespace && current.localName === name) result.push(current); else pending.unshift(...xmlElementChildren(current)); }
  return result;
};
export interface SmartArtNode { id: string; parentId: string | null; text: string }
export function readSmartArtNodes(xml: string): SmartArtNode[] {
  const root = parseXmlTree(xml).root;
  if (root.namespaceUri !== DGM || root.localName !== 'dataModel') throw new Error('对象没有 SmartArt 数据模型');
  const points = children(child(root, 'ptLst'), 'pt'), connections = children(child(root, 'cxnLst'), 'cxn');
  const rootId = attr(points.find((n) => attr(n, 'type') === 'doc') ?? null, 'modelId');
  const nodes = points.filter((n) => !attr(n, 'type') || attr(n, 'type') === 'node').map((pt) => {
    const id = attr(pt, 'modelId'); if (!id) throw new Error('SmartArt 节点缺少身份');
    const relations = connections.filter((c) => (!attr(c, 'type') || attr(c, 'type') === 'parOf') && attr(c, 'destId') === id);
    if (relations.length > 1) throw new Error('SmartArt 节点有多个父节点');
    const parent = attr(relations[0] ?? null, 'srcId');
    const text = child(pt, 't');
    return { id, parentId: parent && parent !== rootId ? parent : null,
      text: text ? descendants(text, A, 'p').map((p) => descendants(p, A, 't').map(content).join('')).join('\n') : '',
      order: Number(attr(relations[0] ?? null, 'srcOrd') ?? 0) };
  });
  return nodes.sort((a, b) => a.order - b.order).map(({ order: _, ...node }) => node);
}
export function normalizeNodes(value: unknown): SmartArtNode[] {
  assertDataArray(value, 'SmartArt 节点');
  if (!value.length || value.length > 1000) throw new Error('SmartArt 需要 1–1000 个节点');
  const ids = new Set<string>();
  for (const raw of value) {
    assertDataObject(raw, ['id', 'parentId', 'text'], 'SmartArt 节点');
    const node = raw as Record<string, unknown>;
    if (typeof node.id !== 'string' || !node.id || node.id.length > 128 || ids.has(node.id)
      || /[\u0000-\u001f\ud800-\udfff]/u.test(node.id)) throw new Error('SmartArt 节点身份无效');
    ids.add(node.id);
    if (node.parentId !== null && typeof node.parentId !== 'string') throw new Error('SmartArt 父节点身份无效');
    if (typeof node.text !== 'string' || node.text.length > 32767
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(node.text)) throw new Error('SmartArt 文字无效');
  }
  const nodes = value as SmartArtNode[], byId = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    let parent = node.parentId; const ancestors = new Set([node.id]);
    while (parent !== null) {
      if (!ids.has(parent) || ancestors.has(parent) || ancestors.size > 12) throw new Error('SmartArt 父子关系存在环、缺失或层级过深');
      ancestors.add(parent); parent = byId.get(parent)!.parentId;
    }
  }
  return structuredClone(nodes);
}
export const smartArtIdentity = (seed: string): string => {
  const hex = [...sha256(new TextEncoder().encode(seed)).slice(0, 16)].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`.toUpperCase();
};
const add = (parent: XmlElement, name: string, attrs: readonly (readonly [string, string])[] = []) => {
  const node = createXmlElement(`dgm:${name}`, { attributes: [['xmlns:dgm', DGM], ...attrs] });
  append(parent, node, child(parent, 'extLst')); return node;
};
export function replaceSmartArtText(point: XmlElement, text: string): void {
  const previous = child(point, 't'), template = previous ? clone(previous, point) : createXmlElement('dgm:t', { attributes: [['xmlns:dgm', DGM], ['xmlns:a', A]] });
  const property = previous && descendants(previous, A, 'rPr')[0];
  for (const paragraph of xmlElementChildren(template).filter((n) => n.namespaceUri === A && n.localName === 'p')) removeXmlChild(template, paragraph);
  if (!xmlElementChildren(template).some((n) => n.localName === 'bodyPr' && n.namespaceUri === A)) append(template, createXmlElement('a:bodyPr', { attributes: [['xmlns:a', A]] }), template.children[0] ?? null);
  for (const line of text.split('\n')) {
    const p = createXmlElement('a:p', { attributes: [['xmlns:a', A]] }), r = createXmlElement('a:r');
    append(template, p); append(p, r);
    if (property) append(r, clone(property, r));
    const t = createXmlElement('a:t', { attributes: [['xml:space', 'preserve']] }); append(r, t); append(t, createXmlText(line));
  }
  if (previous) removeXmlChild(point, previous); append(point, template, child(point, 'extLst'));
}

/** 数据点与 parent-of 关系写回 DiagramML；表现层/过渡点随结构重新生成。 */
export function writeSmartArtNodes(xml: string, nodes: SmartArtNode[]): string {
  const tree = parseXmlTree(xml), root = tree.root;
  const points = child(root, 'ptLst'), connections = child(root, 'cxnLst');
  if (!points || !connections) throw new Error('SmartArt 缺少点或连接列表');
  const original = new Map(children(points, 'pt').map((pt) => [attr(pt, 'modelId'), clone(pt, points)]));
  const texts = new Map(readSmartArtNodes(xml).map((node) => [node.id, node.text]));
  const docPoint = children(points, 'pt').find((pt) => attr(pt, 'type') === 'doc');
  const rootId = attr(docPoint ?? null, 'modelId') ?? smartArtIdentity('document');
  const identities = new Set([rootId]);
  for (const node of nodes) {
    if (!original.has(node.id) && !/^\{[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\}$/i.test(node.id)
      && !/^\d+$/.test(node.id)) throw new Error('新增 SmartArt 节点身份需要 GUID 或整数');
    for (const id of [node.id, smartArtIdentity(`parent:${node.id}`), smartArtIdentity(`sibling:${node.id}`)]) {
      if (identities.has(id)) throw new Error('SmartArt 内容节点与过渡节点身份冲突'); identities.add(id);
    }
  }
  for (const point of children(points, 'pt')) if (point !== docPoint) removeXmlChild(points, point);
  if (!docPoint) { const point = add(points, 'pt', [['modelId', rootId], ['type', 'doc']]); add(point, 'prSet'); add(point, 'spPr'); }
  for (const connection of children(connections, 'cxn')) removeXmlChild(connections, connection);
  const siblingCounts = new Map<string, number>();
  for (const node of nodes) {
    const previous = original.get(node.id), point = previous ?? add(points, 'pt', [['modelId', node.id]]);
    if (previous) append(points, point, child(points, 'extLst')); else { add(point, 'prSet'); add(point, 'spPr'); }
    setXmlAttribute(point, 'type', 'node');
    if (!previous || texts.get(node.id) !== node.text) replaceSmartArtText(point, node.text);
    const connectionId = smartArtIdentity(`connection:${node.id}`), par = smartArtIdentity(`parent:${node.id}`), sib = smartArtIdentity(`sibling:${node.id}`);
    for (const [id, type] of [[par, 'parTrans'], [sib, 'sibTrans']]) {
      const transition = add(points, 'pt', [['modelId', id], ['type', type], ['cxnId', connectionId]]); add(transition, 'prSet'); add(transition, 'spPr');
    }
    const parent = node.parentId ?? rootId, order = siblingCounts.get(parent) ?? 0; siblingCounts.set(parent, order + 1);
    add(connections, 'cxn', [['modelId', connectionId], ['type', 'parOf'], ['srcId', parent], ['destId', node.id],
      ['srcOrd', String(order)], ['destOrd', '0'], ['parTransId', par], ['sibTransId', sib]]);
  }
  return serializeXmlTree(tree);
}
