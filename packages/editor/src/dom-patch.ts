import { renderElementToSvg } from '@web-ppt/core';
import type { Editor, ElementId } from '@web-ppt/edit-core';
import { bindElementIdentities, findElementPartition } from './dom-identity';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgChildren(document: Document, markup: string): SVGElement[] {
  const wrapper = document.createElementNS(SVG_NS, 'svg');
  wrapper.innerHTML = markup;
  return [...wrapper.children] as SVGElement[];
}

function ownedDefs(defs: SVGDefsElement, id: ElementId): Element[] {
  return [...defs.children].filter((node) => (node as SVGElement).dataset.editDefs === id);
}

function referencedIds(root: Element): Set<string> {
  const ids = new Set<string>();
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of element.attributes) {
      for (const match of attribute.value.matchAll(/url\(\s*["']?#([^"')\s]+)["']?\s*\)/g)) ids.add(match[1]);
      if (attribute.localName === 'href' && attribute.value.startsWith('#')) ids.add(attribute.value.slice(1));
    }
  }
  return ids;
}

function initialDefs(defs: SVGDefsElement, current: Element): Element[] {
  const definitions = [...defs.querySelectorAll<SVGElement>('[id]')];
  const remove = new Set<Element>();
  const pending = [...referencedIds(current)];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const definition = definitions.find((node) => node.id === id);
    if (!definition) continue;
    let partition: Element = definition;
    while (partition.parentNode && partition.parentNode !== defs) partition = partition.parentNode as Element;
    if (remove.has(partition)) continue;
    remove.add(partition);
    for (const dependency of referencedIds(partition)) pending.push(dependency);
  }
  return [...remove];
}

function renderElementParts(
  staticLayer: HTMLElement,
  editor: Editor,
  id: ElementId,
  idPrefix: string,
  textMode: 'html' | 'svg',
): { next: SVGElement; nextDefs: SVGElement[] } | null {
  const rendered = renderElementToSvg(editor.effectiveElement(id), {
    textMode, idPrefix: `${idPrefix}${id}-`,
  });
  const markup = svgChildren(staticLayer.ownerDocument, rendered.markup);
  if (markup.length !== 1) return null;
  const next = markup[0];
  bindElementIdentities(next, editor.doc, [id]);
  const nextDefs = svgChildren(staticLayer.ownerDocument, rendered.defs);
  for (const node of nextDefs) node.dataset.editDefs = id;
  return { next, nextDefs };
}

/** markup 与它引用的 defs 在同一同步提交中换代，浏览器没有机会绘制半个状态。 */
export function patchElement(
  staticLayer: HTMLElement,
  editor: Editor,
  id: ElementId,
  idPrefix: string,
  textMode: 'html' | 'svg',
): boolean {
  const current = findElementPartition(staticLayer, id);
  const svg = staticLayer.querySelector<SVGSVGElement>('svg');
  const defs = svg?.querySelector<SVGDefsElement>('defs');
  if (!current || !svg || !defs) return false;

  const rendered = renderElementParts(staticLayer, editor, id, idPrefix, textMode);
  if (!rendered) return false;

  const staleDefs = new Set([...ownedDefs(defs, id), ...initialDefs(defs, current)]);
  for (const node of staleDefs) node.remove();
  defs.append(...rendered.nextDefs);
  current.replaceWith(rendered.next);
  return true;
}

/** 删除结构节点时只移除其 markup/defs 分区，未触碰兄弟必须保留 DOM 身份。 */
export function removeElementPartition(staticLayer: HTMLElement, id: ElementId): boolean {
  const current = findElementPartition(staticLayer, id);
  const defs = staticLayer.querySelector<SVGDefsElement>('svg defs');
  if (!current || !defs) return false;
  const staleDefs = new Set([...ownedDefs(defs, id), ...initialDefs(defs, current)]);
  for (const node of staleDefs) node.remove();
  current.remove();
  return true;
}

/** 撤销删除时以模型兄弟 z 序寻找稳定锚点；空父容器交给整页回退。 */
export function insertElementPartition(
  staticLayer: HTMLElement,
  editor: Editor,
  id: ElementId,
  idPrefix: string,
  textMode: 'html' | 'svg',
): boolean {
  const record = editor.doc.elements[id];
  const siblings = editor.doc.slides[record?.parent]?.children
    ?? editor.doc.elements[record?.parent]?.children;
  if (!record || !siblings) return false;
  const index = siblings.indexOf(id);
  if (index < 0) return false;
  let anchor: SVGElement | null = null;
  let before = true;
  for (let at = index + 1; at < siblings.length && !anchor; at++) {
    anchor = findElementPartition(staticLayer, siblings[at]);
  }
  if (!anchor) {
    before = false;
    for (let at = index - 1; at >= 0 && !anchor; at--) {
      anchor = findElementPartition(staticLayer, siblings[at]);
    }
  }
  const defs = staticLayer.querySelector<SVGDefsElement>('svg defs');
  if (!anchor || !defs) return false;
  const rendered = renderElementParts(staticLayer, editor, id, idPrefix, textMode);
  if (!rendered) return false;
  defs.append(...rendered.nextDefs);
  if (before) anchor.before(rendered.next);
  else anchor.after(rendered.next);
  return true;
}

/** 按模型目标序倒序移动受影响分区；锚点标记保证末元素不会越过非元素装饰节点。 */
export function reorderElementPartitions(
  staticLayer: HTMLElement,
  editor: Editor,
  ids: ReadonlySet<ElementId>,
): boolean {
  const partitions = new Map(
    [...staticLayer.querySelectorAll<SVGElement>('[data-edit-root]')]
      .map((node) => [node.dataset.editRoot!, node] as const),
  );
  const parents = new Map<string, ElementId[]>();
  for (const id of ids) {
    const record = editor.doc.elements[id];
    if (!record) continue;
    const moved = parents.get(record.parent) ?? [];
    moved.push(id);
    parents.set(record.parent, moved);
  }
  for (const [parentId, moved] of parents) {
    const siblings = editor.doc.slides[parentId]?.children ?? editor.doc.elements[parentId]?.children;
    if (!siblings) return false;
    const nodes = siblings.map((id) => partitions.get(id) ?? null);
    if (nodes.some((node) => !node)) return false;
    const parent = nodes[0]?.parentNode;
    if (!parent || nodes.some((node) => node!.parentNode !== parent)) return false;
    const boundary = staticLayer.ownerDocument.createComment('web-ppt-order-boundary');
    const nodeSet = new Set(nodes);
    let currentLast: Node | null = null;
    for (const child of parent.childNodes) {
      if (nodeSet.has(child as SVGElement)) currentLast = child;
    }
    if (!currentLast) return false;
    // 锚点必须跟在旧 DOM 的末节点后；目标置顶时，它在模型里已是末节点，但 DOM 里仍可能是首节点。
    parent.insertBefore(boundary, currentLast.nextSibling);
    const movedSet = new Set(moved);
    for (let index = siblings.length - 1; index >= 0; index--) {
      if (!movedSet.has(siblings[index])) continue;
      parent.insertBefore(nodes[index]!, nodes[index + 1] ?? boundary);
    }
    boundary.remove();
  }
  return true;
}
