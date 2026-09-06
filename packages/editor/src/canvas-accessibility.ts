import { slideText } from '@web-ppt/core';
import { queryElementAltText, querySelectionPane } from '@web-ppt/edit-core';
import type { Editor, ElementId, SelectionPaneItem } from '@web-ppt/edit-core';
import type { EditorSession } from './session';
import type { SlideEditor } from './slide-editor-types';

/** 视觉分区会被增量替换，辅助技术的对象身份与焦点必须独立且稳定。 */
class CanvasAccessibility {
  private readonly list: HTMLDivElement;
  private readonly nodes = new Map<ElementId, HTMLDivElement>();
  private serial = 0;

  constructor(private readonly root: HTMLElement, private readonly staticLayer: HTMLElement,
    private readonly editor: Editor, private readonly prefix: string) {
    this.list = root.ownerDocument.createElement('div');
    this.list.dataset.pptAccessibility = '';
    this.list.role = 'listbox';
    this.list.setAttribute('aria-multiselectable', 'true');
    Object.assign(this.list.style, { position: 'absolute', width: '1px', height: '1px',
      overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' });
    root.append(this.list);
  }

  sync(slideId: string, edit: boolean): void {
    this.root.role = edit ? 'application' : 'document';
    this.staticLayer.setAttribute('aria-hidden', String(edit));
    this.list.hidden = !edit;
    this.root.removeAttribute('aria-activedescendant');
    if (!edit) return;
    this.list.setAttribute('aria-label', this.root.getAttribute('aria-label') ?? 'Slide objects');
    const children = new Map<ElementId | null, SelectionPaneItem[]>();
    for (const item of querySelectionPane(this.editor.doc, slideId)) {
      const siblings = children.get(item.parentId) ?? [];
      siblings.unshift(item); children.set(item.parentId, siblings);
    }
    const ordered: SelectionPaneItem[] = [];
    const visit = (parent: ElementId | null) => {
      for (const item of children.get(parent) ?? []) {
        if (item.hidden || item.editable === 'none') continue;
        ordered.push(item); visit(item.id);
      }
    };
    visit(null);
    const ids = new Set(ordered.map((item) => item.id));
    for (const [id, node] of this.nodes) if (!ids.has(id)) { node.remove(); this.nodes.delete(id); }
    const selection = this.editor.selection;
    const selected = new Set(selection.kind === 'elements' ? selection.ids : []);
    let previous: HTMLDivElement | null = null;
    for (const item of ordered) {
      let node = this.nodes.get(item.id);
      if (!node) {
        node = this.root.ownerDocument.createElement('div'); node.role = 'option';
        node.id = `${this.prefix}at-${++this.serial}`; node.dataset.pptAccessibleId = item.id;
        this.nodes.set(item.id, node);
      }
      if (node.previousElementSibling !== previous || node.parentElement !== this.list) {
        this.list.insertBefore(node, previous ? previous.nextElementSibling : this.list.firstElementChild);
      }
      node.onclick = () => {
        this.editor.select({ kind: 'elements', ids: [item.id], enteredGroup: item.parentId });
        this.root.focus({ preventScroll: true });
      };
      const alt = queryElementAltText(this.editor.doc, item.id);
      const element = this.editor.effectiveElement(item.id);
      const text = element.kind === 'group' ? '' : slideText({ background: null, elements: [element] });
      const label = [...new Set([item.name, alt.title, alt.descr, text].filter(Boolean))].join(' · ');
      if (node.textContent !== label) node.textContent = label;
      node.setAttribute('aria-selected', String(selected.has(item.id)));
      node.setAttribute('aria-disabled', String(item.locked));
      if (selected.has(item.id) && !this.root.hasAttribute('aria-activedescendant')) {
        this.root.setAttribute('aria-activedescendant', node.id);
      }
      previous = node;
    }
  }

  destroy(): void { this.list.remove(); }
}

/** 产品可在挂载后启用；不使用辅助对象目录的宿主不承担其模型遍历与 DOM 成本。 */
export function createCanvasAccessibility(session: EditorSession, view: SlideEditor): { dispose(): void } {
  const layer = view.element.querySelector<HTMLElement>('[data-ppt-layer=static]')!;
  const rootRole = view.element.getAttribute('role'), hidden = layer.getAttribute('aria-hidden');
  const controller = new CanvasAccessibility(view.element, layer, session.editor,
    `webppt-${++viewSerial}-`);
  const sync = () => { if (!view.destroyed) controller.sync(view.slideId, view.mode === 'edit'); };
  const unsubscribe = session.editor.subscribe(sync);
  const observer = new view.element.ownerDocument.defaultView!.MutationObserver(sync);
  observer.observe(layer, { childList: true });
  observer.observe(view.element, { attributes: true, attributeFilter: ['data-mode', 'aria-label'] });
  sync();
  return { dispose() {
    unsubscribe(); observer.disconnect(); controller.destroy();
    view.element.removeAttribute('aria-activedescendant');
    if (rootRole === null) view.element.removeAttribute('role'); else view.element.setAttribute('role', rootRole);
    if (hidden === null) layer.removeAttribute('aria-hidden'); else layer.setAttribute('aria-hidden', hidden);
  } };
}
let viewSerial = 0;
