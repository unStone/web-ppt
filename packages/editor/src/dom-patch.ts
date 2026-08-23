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

  const rendered = renderElementToSvg(editor.effectiveElement(id), {
    textMode, idPrefix: `${idPrefix}${id}-`,
  });
  const markup = svgChildren(staticLayer.ownerDocument, rendered.markup);
  if (markup.length !== 1) return false;
  const next = markup[0];
  bindElementIdentities(next, editor.doc, [id]);
  const nextDefs = svgChildren(staticLayer.ownerDocument, rendered.defs);
  for (const node of nextDefs) node.dataset.editDefs = id;

  const staleDefs = new Set([...ownedDefs(defs, id), ...initialDefs(defs, current)]);
  for (const node of staleDefs) node.remove();
  defs.append(...nextDefs);
  current.replaceWith(next);
  return true;
}
