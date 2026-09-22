/**
 * 查找标字必须投影到已经画好的 DOM。
 * 改 render/ 会把编辑标记带进所有预览；官方 Reading View 也不走那条路。
 * Chrome 对 foreignObject 里的 HTML 不画 ::highlight，所以可见层用 Range 的盒子叠上去。
 */

export const SEARCH_HIGHLIGHT_NAME = 'ppt-find';
export const SEARCH_LAYER_CLASS = 'ppt-find-layer';
export const SEARCH_BOX_CLASS = 'ppt-find-box';
export const SEARCH_CURRENT_CLASS = 'ppt-find-current';

/** 关着的备注仍在 DOM 里。把它算进「下一处」，Enter 会走进看不见的字。 */
export function isSearchRootVisible(root: ParentNode): boolean {
  if (!(root instanceof Element)) return true;
  return root.closest('[hidden]') === null;
}

type HighlightRegistry = {
  delete(name: string): boolean;
  get(name: string): Highlight | undefined;
  set(name: string, highlight: Highlight): void;
};

function highlightRegistry(): HighlightRegistry | undefined {
  const css = globalThis.CSS as { highlights?: HighlightRegistry } | undefined;
  return css?.highlights;
}

function pointAt(
  nodes: ReadonlyArray<{ node: Text; start: number }>,
  index: number,
): { node: Text; offset: number } {
  for (const item of nodes) {
    const end = item.start + item.node.data.length;
    if (index <= end) return { node: item.node, offset: index - item.start };
  }
  throw new Error(`查找高亮偏移超出文本：${index}`);
}

function textContainers(root: ParentNode): Element[] {
  const htmlBodies = [...root.querySelectorAll('foreignObject')];
  const svgTexts = [...root.querySelectorAll('text')].filter((node) => !node.closest('foreignObject'));
  const found = [...htmlBodies, ...svgTexts];
  return found.length ? found : (root instanceof Element ? [root] : []);
}

function rangesInContainer(container: Element, query: string): Range[] {
  const nodes: Array<{ node: Text; start: number }> = [];
  let full = '';
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (!(current instanceof Text) || !current.data) continue;
    if (current.parentElement?.closest('title, desc, script, style')) continue;
    nodes.push({ node: current, start: full.length });
    full += current.data;
  }
  if (!nodes.length) return [];
  const lower = full.toLowerCase();
  const needle = query.toLowerCase();
  const ranges: Range[] = [];
  let from = 0;
  while (from < lower.length) {
    const index = lower.indexOf(needle, from);
    if (index < 0) break;
    const start = pointAt(nodes, index);
    const end = pointAt(nodes, index + needle.length);
    const range = container.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    ranges.push(range);
    from = index + needle.length;
  }
  return ranges;
}

function overlayDocument(roots: readonly ParentNode[]): Document | undefined {
  for (const root of roots) {
    if ('ownerDocument' in root && root.ownerDocument) return root.ownerDocument;
    if ('nodeType' in root && root.nodeType === 9) return root as Document;
  }
  return globalThis.document;
}

function clearOverlayLayers(doc: Document | undefined): void {
  if (!doc) return;
  for (const layer of doc.querySelectorAll(`.${SEARCH_LAYER_CLASS}`)) layer.remove();
}

function scrollRangeIntoView(range: Range): void {
  const node = range.startContainer;
  const el = node instanceof Element ? node : node.parentElement;
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function paintOverlay(root: ParentNode, ranges: Range[], activeLocal: number): void {
  if (!(root instanceof Element) || !ranges.length) return;
  const doc = root.ownerDocument;
  const layer = doc.createElement('div');
  layer.className = SEARCH_LAYER_CLASS;
  layer.setAttribute('aria-hidden', 'true');
  const origin = root.getBoundingClientRect();
  ranges.forEach((range, index) => {
    const current = index === activeLocal;
    const rects = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
    for (const rect of rects) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const box = doc.createElement('i');
      box.className = current ? `${SEARCH_BOX_CLASS} ${SEARCH_CURRENT_CLASS}` : SEARCH_BOX_CLASS;
      box.style.left = `${rect.left - origin.left}px`;
      box.style.top = `${rect.top - origin.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      layer.append(box);
    }
    if (current) scrollRangeIntoView(range);
  });
  if (layer.childElementCount) root.append(layer);
}

export function collectSearchRanges(root: ParentNode, query: string): Range[] {
  const needle = query.trim();
  if (!needle) throw new Error('空查询不能标字');
  return textContainers(root).flatMap((container) => rangesInContainer(container, needle));
}

export function clearSearchHighlight(doc?: Document): void {
  highlightRegistry()?.delete(SEARCH_HIGHLIGHT_NAME);
  clearOverlayLayers(doc ?? globalThis.document);
}

export function applySearchHighlight(roots: readonly ParentNode[], query: string, activeIndex = 0): number {
  clearSearchHighlight(overlayDocument(roots));
  const needle = query.trim();
  if (!needle) return 0;
  const grouped = roots.map((root) => ({ root, ranges: collectSearchRanges(root, needle) }));
  const painted = grouped.flatMap((group) => group.ranges);
  if (!painted.length) return 0;
  if (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= painted.length) {
    throw new Error(`查找当前命中越界：${activeIndex}，共 ${painted.length} 处`);
  }
  let seen = 0;
  for (const group of grouped) {
    paintOverlay(group.root, group.ranges, activeIndex - seen);
    seen += group.ranges.length;
  }
  const registry = highlightRegistry();
  if (registry && typeof Highlight !== 'undefined') {
    registry.set(SEARCH_HIGHLIGHT_NAME, new Highlight(painted[activeIndex]));
  }
  return painted.length;
}

export function searchHighlightCount(): number {
  const highlight = highlightRegistry()?.get(SEARCH_HIGHLIGHT_NAME);
  return highlight ? [...highlight].length : 0;
}

export function searchOverlayBoxCount(doc: Document = globalThis.document): number {
  return doc.querySelectorAll(`.${SEARCH_BOX_CLASS}`).length;
}
