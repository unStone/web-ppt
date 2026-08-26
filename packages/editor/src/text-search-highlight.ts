import type { TextSearchMatch } from '@web-ppt/edit-core';
import { domPointAt } from './text-dom';

interface CountMarker {
  readonly element: SVGElement;
  readonly count: number;
}

function markerOf(node: Node): Element | null {
  const element = node.nodeType === node.ELEMENT_NODE ? node as Element : node.parentElement;
  return element?.closest('[data-ppt-search-r]') ?? null;
}

/** 命中框独立于 SVG 缩放层，必须把 viewport 坐标换回编辑器根坐标。 */
function appendRect(
  overlay: HTMLElement,
  rootRect: DOMRect,
  rect: DOMRect,
  exact: boolean,
): void {
  if (rect.width <= 0 || rect.height <= 0) return;
  const box = overlay.ownerDocument.createElement('div');
  box.dataset.pptSearchRange = '';
  box.dataset.pptSearchExact = String(exact);
  box.style.position = 'absolute';
  box.style.left = `${rect.left - rootRect.left}px`;
  box.style.top = `${rect.top - rootRect.top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
  box.style.boxSizing = 'border-box';
  box.style.border = '2px solid #f59e0b';
  box.style.borderRadius = '3px';
  box.style.background = 'rgba(245, 158, 11, 0.22)';
  overlay.append(box);
}

/** 只修改计数变化的元素和当前范围；导航不会重写整页命中 DOM。 */
export class TextSearchHighlightProjection {
  private readonly counts = new Map<string, CountMarker>();
  private readonly rangeMarkers = new Set<Element>();
  private currentSlide: string | null = null;
  private currentTarget: SVGElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly staticLayer: HTMLElement,
    private readonly overlay: HTMLElement,
  ) {}

  sync(
    matches: readonly TextSearchMatch[],
    current: TextSearchMatch | null,
    slideId: string,
  ): void {
    this.syncCounts(matches, slideId);
    this.syncCurrent(current, slideId);
  }

  clear(): void {
    this.clearCurrent();
    for (const marker of this.counts.values()) delete marker.element.dataset.pptSearchMatches;
    this.counts.clear();
    this.currentSlide = null;
  }

  private syncCounts(matches: readonly TextSearchMatch[], slideId: string): void {
    if (slideId !== this.currentSlide) {
      for (const marker of this.counts.values()) delete marker.element.dataset.pptSearchMatches;
      this.counts.clear();
      this.currentSlide = slideId;
    }
    const desired = new Map<string, number>();
    for (const match of matches) {
      if (match.slideId === slideId) desired.set(match.id, (desired.get(match.id) ?? 0) + 1);
    }
    for (const [id, marker] of this.counts) {
      if (desired.has(id) && marker.element.isConnected) continue;
      delete marker.element.dataset.pptSearchMatches;
      this.counts.delete(id);
    }
    let partitions: Map<string, SVGElement> | null = null;
    for (const [id, count] of desired) {
      const previous = this.counts.get(id);
      if (previous?.count === count && previous.element.isConnected) continue;
      if (!partitions) partitions = new Map(
        [...this.staticLayer.querySelectorAll<SVGElement>('[data-edit-root]')]
          .map((element) => [element.dataset.editRoot!, element]),
      );
      const element = partitions.get(id);
      if (!element) continue;
      element.dataset.pptSearchMatches = String(count);
      this.counts.set(id, { element, count });
    }
  }

  private syncCurrent(current: TextSearchMatch | null, slideId: string): void {
    for (const marker of this.rangeMarkers) delete (marker as HTMLElement).dataset.pptSearchCurrentRange;
    this.rangeMarkers.clear();
    this.overlay.replaceChildren();
    this.overlay.hidden = true;
    delete this.overlay.dataset.pptSearchExact;
    const target = current?.slideId === slideId ? this.counts.get(current.id)?.element ?? null : null;
    if (target !== this.currentTarget) {
      if (this.currentTarget) delete this.currentTarget.dataset.pptSearchCurrent;
      this.currentTarget = target;
      if (target) target.dataset.pptSearchCurrent = '';
    }
    if (!current || !target) return;
    const scope = current.cell
      ? target.querySelector<SVGElement>(`[data-table-cell="${current.cell.r}:${current.cell.c}"]`)
      : target;
    const from = scope ? domPointAt(scope, current.range.from, 'search') : null;
    const to = scope ? domPointAt(scope, current.range.to, 'search') : null;
    const range = target.ownerDocument.createRange();
    let exact = false;
    if (from && to) {
      try {
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        const rootRect = this.root.getBoundingClientRect();
        for (const rect of range.getClientRects()) appendRect(this.overlay, rootRect, rect, true);
        exact = this.overlay.childElementCount > 0;
        this.markRange(scope!, from.node, to.node);
      } catch { /* DOM 被宿主同步替换时，当前帧退回元素框；下一次同步会恢复精确范围。 */ }
    }
    if (!exact) appendRect(
      this.overlay, this.root.getBoundingClientRect(), target.getBoundingClientRect(), false,
    );
    this.overlay.dataset.pptSearchExact = String(exact);
    this.overlay.hidden = this.overlay.childElementCount === 0;
  }

  private markRange(scope: Element, start: Node, end: Node): void {
    const markers = [...scope.querySelectorAll<Element>('[data-ppt-search-r]')];
    const first = markers.indexOf(markerOf(start)!);
    const last = markers.indexOf(markerOf(end)!);
    if (first < 0 || last < 0) return;
    for (const marker of markers.slice(Math.min(first, last), Math.max(first, last) + 1)) {
      marker.setAttribute('data-ppt-search-current-range', '');
      this.rangeMarkers.add(marker);
    }
  }

  private clearCurrent(): void {
    if (this.currentTarget) delete this.currentTarget.dataset.pptSearchCurrent;
    this.currentTarget = null;
    for (const marker of this.rangeMarkers) marker.removeAttribute('data-ppt-search-current-range');
    this.rangeMarkers.clear();
    this.overlay.replaceChildren();
    this.overlay.hidden = true;
    delete this.overlay.dataset.pptSearchExact;
  }
}
