import {
  normalizeExternalLinkTarget, queryElementLink, queryRunLink,
} from '@web-ppt/edit-core';
import type {
  Editor, LinkSourceValue, LinkTarget, RunLinkState, SlideId,
} from '@web-ppt/edit-core';
import type {
  EditorMode, LinkFollowHandler, LinkFollowSource,
} from './slide-editor-types';

interface SlideLinkControllerOptions {
  editor: Editor;
  root: HTMLElement;
  mode(): EditorMode;
  slideId(): SlideId;
  setSlide(slideId: SlideId): void;
  queryRunLink(): RunLinkState | null;
  onFollow?: LinkFollowHandler;
}

function relativeTarget(
  order: readonly SlideId[], current: SlideId, action: Extract<LinkSourceValue, { kind: 'relative' }>['action'],
): SlideId | null {
  if (!order.length) return null;
  const currentIndex = Math.max(0, order.indexOf(current));
  const index = action === 'next' ? currentIndex + 1
    : action === 'previous' ? currentIndex - 1
    : action === 'first' ? 0 : order.length - 1;
  return order[Math.max(0, Math.min(order.length - 1, index))] ?? null;
}

/** 单个 view 独占路由状态；共享的只有 headless 文档与选区。 */
export class SlideLinkController {
  constructor(private readonly options: SlideLinkControllerOptions) {}

  readonly click = (event: MouseEvent): void => {
    const node = this.eventLinkNode(event.target);
    if (!node) return;
    // edit 点击只交给 pointer 选择，click 阶段必须截断浏览器原生导航。
    event.preventDefault();
    if (this.options.mode() !== 'view' || node.hasAttribute('data-unsafe-href')) return;
    const value = this.valueFromNode(node);
    if (value) this.followValue(value, 'view', event);
  };

  readonly keydown = (event: KeyboardEvent): void => {
    if (this.options.mode() !== 'view' || event.key !== 'Enter') return;
    const node = this.eventLinkNode(event.target);
    if (!node || node.hasAttribute('data-unsafe-href')) return;
    const value = this.valueFromNode(node);
    if (!value) return;
    event.preventDefault();
    this.followValue(value, 'view', event);
  };

  follow(target?: LinkTarget): boolean {
    if (target) {
      const normalized = target.kind === 'external'
        ? normalizeExternalLinkTarget(target.href)
        : this.options.editor.doc.slides[target.slideId] ? { ...target } : null;
      return normalized ? this.perform(normalized, 'api') : false;
    }
    return this.followSelection('api');
  }

  followSelection(source: LinkFollowSource, event?: KeyboardEvent): boolean {
    const value = this.selectedValue();
    return value ? this.followValue(value, source, event) : false;
  }

  private eventLinkNode(target: EventTarget | null): Element | null {
    const view = this.options.root.ownerDocument.defaultView;
    if (!view || !(target instanceof view.Element)) return null;
    const node = target.closest('[data-slide],a[href],[data-unsafe-href]');
    return node && this.options.root.contains(node) ? node : null;
  }

  private selectedValue(): LinkSourceValue | null {
    const selection = this.options.editor.selection;
    if (selection.kind === 'text') {
      const before = (left: typeof selection.anchor, right: typeof selection.focus): boolean =>
        left.p < right.p || (left.p === right.p && (left.r < right.r
          || (left.r === right.r && left.off <= right.off)));
      const state = this.options.queryRunLink() ?? queryRunLink(
        this.options.editor.doc, selection.id,
        before(selection.anchor, selection.focus)
          ? { from: selection.anchor, to: selection.focus }
          : { from: selection.focus, to: selection.anchor },
        selection.cell,
      );
      return state && !state.mixed && state.followable ? state.value : null;
    }
    if (selection.kind !== 'elements' || !selection.ids.length
      || selection.ids.some((id) => {
        const kind = this.options.editor.doc.elements[id]?.src.kind;
        return kind !== 'shape' && kind !== 'image';
      })) return null;
    const state = queryElementLink(this.options.editor.doc, selection.ids);
    return !state.mixed && state.followable ? state.value : null;
  }

  private valueFromNode(node: Element): LinkSourceValue | null {
    const rawSlide = node.getAttribute('data-slide');
    if (rawSlide) {
      if (['next', 'previous', 'first', 'last'].includes(rawSlide)) {
        return { kind: 'relative', action: rawSlide as 'next' | 'previous' | 'first' | 'last' };
      }
      const index = Number(rawSlide) - 1;
      const slideId = Number.isInteger(index) ? this.options.editor.doc.slideOrder[index] : undefined;
      return slideId ? { kind: 'slide', slideId } : null;
    }
    const href = node.getAttribute('href');
    return href ? normalizeExternalLinkTarget(href) : null;
  }

  private followValue(
    value: LinkSourceValue, source: LinkFollowSource, event?: MouseEvent | KeyboardEvent,
  ): boolean {
    if (value.kind === 'unsupported') return false;
    const target = value.kind === 'relative'
      ? relativeTarget(this.options.editor.doc.slideOrder, this.options.slideId(), value.action)
      : value.kind === 'slide' ? value.slideId : null;
    if (value.kind !== 'external') {
      return target && this.options.editor.doc.slides[target]
        ? this.perform({ kind: 'slide', slideId: target }, source, event) : false;
    }
    const normalized = normalizeExternalLinkTarget(value.href);
    return normalized ? this.perform(normalized, source, event) : false;
  }

  private perform(
    target: LinkTarget, source: LinkFollowSource, event?: MouseEvent | KeyboardEvent,
  ): boolean {
    if (this.options.onFollow?.(structuredClone(target), { source, ...(event ? { event } : {}) }) === true) {
      return true;
    }
    if (target.kind === 'slide') {
      this.options.setSlide(target.slideId);
      return true;
    }
    const opened = this.options.root.ownerDocument.defaultView
      ?.open(target.href, '_blank', 'noopener,noreferrer');
    if (opened) opened.opener = null;
    return true;
  }
}
