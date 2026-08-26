import { querySelectionPane } from '@web-ppt/edit-core';
import type {
  EditorChange, ElementId, Selection, SelectionPaneItem, SlideId,
} from '@web-ppt/edit-core';
import type { EditorSession } from './session';
import { sessionState } from './session-state';
import type {
  SelectionPane, SelectionPaneOptions,
} from './selection-pane-types';
import type { EditorMode } from './slide-editor-types';

interface PaneRow {
  readonly element: HTMLDivElement;
  readonly name: HTMLSpanElement;
  readonly expand: HTMLButtonElement | null;
  readonly visibility: HTMLButtonElement;
  readonly lock: HTMLButtonElement;
}

const itemById = (items: readonly SelectionPaneItem[]): Map<ElementId, SelectionPaneItem> =>
  new Map(items.map((item) => [item.id, item]));

function selectionIds(selection: Selection): ReadonlySet<ElementId> {
  if (selection.kind === 'elements') return new Set(selection.ids);
  if (selection.kind === 'text' || selection.kind === 'table') return new Set([selection.id]);
  return new Set();
}

class DomSelectionPane implements SelectionPane {
  readonly element: HTMLDivElement;
  private readonly tree: HTMLDivElement;
  private readonly session: EditorSession;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly rows = new Map<ElementId, PaneRow>();
  private readonly collapsed = new Set<ElementId>();
  private items: SelectionPaneItem[] = [];
  private itemsById = new Map<ElementId, SelectionPaneItem>();
  private currentSlide: SlideId;
  private currentMode: EditorMode;
  private focusId: ElementId | null = null;
  private renameInput: HTMLInputElement | null = null;
  private renameId: ElementId | null = null;
  private isDestroyed = false;
  private readonly unsubscribe: () => void;

  constructor(container: HTMLElement, session: EditorSession, options: SelectionPaneOptions = {}) {
    if (session.disposed) throw new Error('不能挂载已经释放的编辑会话');
    const slideId = options.slideId ?? session.editor.doc.slideOrder[0];
    if (!slideId || !session.editor.doc.slides[slideId]) throw new Error('找不到选择窗格的幻灯片');
    this.session = session;
    this.currentSlide = slideId;
    this.currentMode = options.mode ?? 'edit';
    this.onError = options.onError;
    const document = container.ownerDocument;
    this.element = document.createElement('div');
    this.element.dataset.webPptSelectionPane = '';
    this.element.style.overflow = 'auto';
    this.element.style.minWidth = '12rem';
    this.element.style.font = '13px/1.4 system-ui, sans-serif';
    this.tree = document.createElement('div');
    this.tree.role = 'tree';
    this.tree.setAttribute('aria-label', options.ariaLabel ?? '幻灯片对象');
    this.tree.tabIndex = -1;
    this.element.append(this.tree);
    this.rebuild();
    this.setMode(this.currentMode);
    this.unsubscribe = session.editor.subscribe((change) => this.update(change));
    try {
      container.append(this.element);
      sessionState(session).panes.add(this);
    } catch (error) {
      this.unsubscribe();
      this.element.remove();
      throw error;
    }
  }

  get slideId(): SlideId { return this.currentSlide; }
  get mode(): EditorMode { return this.currentMode; }
  get destroyed(): boolean { return this.isDestroyed; }

  setSlide(slideId: SlideId): void {
    if (!this.session.editor.doc.slides[slideId]) throw new Error(`找不到幻灯片：${slideId}`);
    if (slideId === this.currentSlide) return;
    this.cancelRename();
    this.currentSlide = slideId;
    this.focusId = null;
    this.rebuild();
  }

  setMode(mode: EditorMode): void {
    if (mode !== 'view' && mode !== 'edit') throw new Error(`未知编辑器模式：${String(mode)}`);
    if (mode === 'view') this.cancelRename();
    this.currentMode = mode;
    this.element.dataset.mode = mode;
    this.syncRows();
  }

  focusElement(id: ElementId): boolean {
    const row = this.rows.get(id)?.element;
    if (!row || row.hidden) return false;
    this.focusId = id;
    this.syncRovingTabIndex();
    row.focus();
    return true;
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.cancelRename();
    this.unsubscribe();
    sessionState(this.session).panes.delete(this);
    this.element.remove();
  }

  private rebuild(): void {
    const active = this.element?.ownerDocument.activeElement as HTMLElement | null;
    const restoreFocus = active?.closest<HTMLElement>('[data-pane-element]')?.dataset.paneElement
      ?? this.focusId;
    this.cancelRename();
    this.items = querySelectionPane(this.session.editor.doc, this.currentSlide);
    this.itemsById = itemById(this.items);
    this.rows.clear();
    this.tree.replaceChildren();
    const siblingGroups = new Map<ElementId | null, SelectionPaneItem[]>();
    for (const item of this.items) {
      const siblings = siblingGroups.get(item.parentId) ?? [];
      siblings.push(item);
      siblingGroups.set(item.parentId, siblings);
    }
    for (const item of this.items) {
      const row = this.createRow(item);
      const siblings = siblingGroups.get(item.parentId)!;
      row.element.setAttribute('aria-posinset', String(siblings.indexOf(item) + 1));
      row.element.setAttribute('aria-setsize', String(siblings.length));
      this.rows.set(item.id, row);
      this.tree.append(row.element);
    }
    this.focusId = restoreFocus && this.rows.has(restoreFocus)
      ? restoreFocus : this.selectedFocusId() ?? this.items[0]?.id ?? null;
    this.syncRows();
    if (restoreFocus && this.rows.has(restoreFocus)) this.rows.get(restoreFocus)!.element.focus();
  }

  private createRow(item: SelectionPaneItem): PaneRow {
    const document = this.tree.ownerDocument;
    const row = document.createElement('div');
    row.role = 'treeitem';
    row.dataset.paneElement = item.id;
    row.setAttribute('aria-level', String(item.depth + 1));
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '1.5rem minmax(5rem,1fr) 2rem 2rem';
    row.style.alignItems = 'center';
    row.style.minHeight = '2rem';
    row.style.paddingInlineStart = `${item.depth * 16}px`;

    let expand: HTMLButtonElement | null = null;
    if (item.hasChildren) {
      expand = document.createElement('button');
      expand.type = 'button';
      expand.dataset.paneAction = 'expand';
      expand.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleExpanded(item.id);
      });
      row.append(expand);
    } else {
      const spacer = document.createElement('span');
      spacer.setAttribute('aria-hidden', 'true');
      row.append(spacer);
    }
    const name = document.createElement('span');
    name.dataset.paneName = '';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    name.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      this.startRename(item.id);
    });
    row.append(name);
    const visibility = this.actionButton('visibility', () => this.toggleVisibility(item.id));
    const lock = this.actionButton('lock', () => this.toggleLock(item.id));
    row.append(visibility, lock);
    row.addEventListener('click', (event) => {
      if ((event.target as Element).closest('button,input')) return;
      this.activate(item.id);
    });
    row.addEventListener('focus', () => {
      this.focusId = item.id;
      this.syncRovingTabIndex();
    });
    row.addEventListener('keydown', (event) => this.keyDown(event, item.id));
    return { element: row, name, expand, visibility, lock };
  }

  private actionButton(action: string, run: () => void): HTMLButtonElement {
    const button = this.tree.ownerDocument.createElement('button');
    button.type = 'button';
    button.dataset.paneAction = action;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.run(run);
    });
    return button;
  }

  private update(change: EditorChange): void {
    if (!this.session.editor.doc.slides[this.currentSlide]) {
      const fallback = change.removedSlideFallbacks.get(this.currentSlide)
        ?? this.session.editor.doc.slideOrder[0];
      if (!fallback) return;
      this.currentSlide = fallback;
      this.focusId = null;
      this.rebuild();
      return;
    }
    if (this.structureChanged(change)) this.rebuild();
    else if ([...change.paneElements].some((id) =>
      this.rows.has(id) || this.belongsToCurrentSlide(id))) {
      this.items = querySelectionPane(this.session.editor.doc, this.currentSlide);
      this.itemsById = itemById(this.items);
      this.syncRows();
    } else {
      this.syncSelection();
    }
  }

  private structureChanged(change: EditorChange): boolean {
    if (change.renderSlides.has(this.currentSlide)) return true;
    for (const id of change.reorderedElements) {
      if (this.rows.has(id) || this.belongsToCurrentSlide(id)) return true;
    }
    for (const id of change.touchedElements) {
      if (this.rows.has(id) && !this.session.editor.doc.elements[id]) return true;
      if (!this.rows.has(id) && this.belongsToCurrentSlide(id)) return true;
    }
    return false;
  }

  private belongsToCurrentSlide(id: ElementId): boolean {
    let record = this.session.editor.doc.elements[id];
    const seen = new Set<ElementId>();
    while (record) {
      if (seen.has(record.id)) return false;
      seen.add(record.id);
      if (record.parent === this.currentSlide) return true;
      record = this.session.editor.doc.elements[record.parent];
    }
    return false;
  }

  private syncRows(): void {
    for (const item of this.items) {
      const row = this.rows.get(item.id);
      if (!row) continue;
      row.name.textContent = item.name;
      row.element.dataset.kind = item.kind;
      row.element.setAttribute('aria-label', this.rowLabel(item));
      row.element.toggleAttribute('data-locked', item.locked);
      row.element.toggleAttribute('data-hidden', item.hidden);
      if (row.expand) {
        const expanded = !this.collapsed.has(item.id);
        row.expand.textContent = expanded ? '▾' : '▸';
        row.expand.setAttribute('aria-label', `${expanded ? '折叠' : '展开'} ${item.name}`);
        row.element.setAttribute('aria-expanded', String(expanded));
      }
      const inheritedHidden = item.hidden && !item.ownHidden;
      row.visibility.textContent = item.hidden ? '○' : '●';
      row.visibility.title = inheritedHidden ? '由上级隐藏' : item.ownHidden ? '显示对象' : '隐藏对象';
      row.visibility.setAttribute('aria-label', `${row.visibility.title}：${item.name}`);
      row.visibility.setAttribute('aria-pressed', String(item.ownHidden));
      row.visibility.disabled = this.currentMode === 'view' || inheritedHidden;
      const inheritedLocked = item.locked && !item.ownLocked;
      row.lock.textContent = item.locked ? '🔒' : '🔓';
      row.lock.title = inheritedLocked ? '由上级锁定' : item.ownLocked ? '解锁对象' : '锁定对象';
      row.lock.setAttribute('aria-label', `${row.lock.title}：${item.name}`);
      row.lock.setAttribute('aria-pressed', String(item.ownLocked));
      row.lock.disabled = this.currentMode === 'view' || inheritedLocked;
    }
    this.applyCollapsedState();
    this.syncSelection();
  }

  private rowLabel(item: SelectionPaneItem): string {
    const state = [item.kind, item.hidden ? '已隐藏' : '可见', item.locked ? '已锁定' : '未锁定'];
    return `${item.name}，${state.join('，')}`;
  }

  private syncSelection(): void {
    const selected = selectionIds(this.session.editor.selection);
    for (const [id, row] of this.rows) {
      row.element.setAttribute('aria-selected', String(selected.has(id)));
    }
    this.syncRovingTabIndex();
  }

  private syncRovingTabIndex(): void {
    const fallback = this.visibleIds()[0] ?? null;
    if (!this.focusId || this.rows.get(this.focusId)?.element.hidden) this.focusId = fallback;
    for (const [id, row] of this.rows) row.element.tabIndex = id === this.focusId ? 0 : -1;
  }

  private selectedFocusId(): ElementId | null {
    const selected = selectionIds(this.session.editor.selection);
    return this.items.find((item) => selected.has(item.id))?.id ?? null;
  }

  private visibleIds(): ElementId[] {
    return this.items.filter((item) => !this.rows.get(item.id)?.element.hidden).map((item) => item.id);
  }

  private applyCollapsedState(): void {
    for (const item of this.items) {
      let parentId = item.parentId;
      let hidden = false;
      while (parentId) {
        if (this.collapsed.has(parentId)) { hidden = true; break; }
        parentId = this.itemsById.get(parentId)?.parentId ?? null;
      }
      const row = this.rows.get(item.id)?.element;
      if (row) row.hidden = hidden;
    }
  }

  private activate(id: ElementId): void {
    this.focusElement(id);
    if (this.currentMode !== 'edit') return;
    const item = this.itemsById.get(id);
    if (!item || item.locked || item.hidden) return;
    this.session.editor.select({ kind: 'elements', ids: [id], enteredGroup: item.parentId });
  }

  private toggleExpanded(id: ElementId): void {
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);
    this.syncRows();
    this.focusElement(id);
  }

  private toggleVisibility(id: ElementId): void {
    if (this.currentMode !== 'edit') return;
    const item = this.itemsById.get(id);
    if (!item || (item.hidden && !item.ownHidden)) return;
    this.session.editor.exec({ type: 'SetElementHidden', id, hidden: !item.ownHidden });
  }

  private toggleLock(id: ElementId): void {
    if (this.currentMode !== 'edit') return;
    const item = this.itemsById.get(id);
    if (!item || (item.locked && !item.ownLocked)) return;
    this.session.editor.exec({ type: 'SetLocked', id, locked: !item.ownLocked });
  }

  private keyDown(event: KeyboardEvent, id: ElementId): void {
    if (event.target !== event.currentTarget) return;
    const visible = this.visibleIds();
    const index = visible.indexOf(id);
    let target: ElementId | undefined;
    if (event.key === 'ArrowUp') target = visible[Math.max(0, index - 1)];
    else if (event.key === 'ArrowDown') target = visible[Math.min(visible.length - 1, index + 1)];
    else if (event.key === 'Home') target = visible[0];
    else if (event.key === 'End') target = visible[visible.length - 1];
    else if (event.key === 'ArrowLeft') target = this.leftTarget(id);
    else if (event.key === 'ArrowRight') target = this.rightTarget(id);
    else if (event.key === 'Enter') this.activate(id);
    else if (event.key === ' ') this.run(() => this.toggleVisibility(id));
    else if (event.key === 'F2') this.startRename(id);
    else return;
    if (target) this.focusElement(target);
    event.preventDefault();
  }

  private leftTarget(id: ElementId): ElementId | undefined {
    const item = this.itemsById.get(id);
    if (!item) return undefined;
    if (item.hasChildren && !this.collapsed.has(id)) {
      this.collapsed.add(id);
      this.syncRows();
      return id;
    }
    return item.parentId ?? id;
  }

  private rightTarget(id: ElementId): ElementId | undefined {
    const item = this.itemsById.get(id);
    if (!item?.hasChildren) return id;
    if (this.collapsed.delete(id)) {
      this.syncRows();
      return id;
    }
    return this.items.find((candidate) => candidate.parentId === id)?.id ?? id;
  }

  private startRename(id: ElementId): void {
    if (this.currentMode !== 'edit' || this.renameInput) return;
    const item = this.itemsById.get(id);
    const row = this.rows.get(id);
    if (!item || !row || item.editable === 'none' || item.locked || item.hidden) return;
    const input = this.tree.ownerDocument.createElement('input');
    input.type = 'text';
    input.value = item.name;
    input.setAttribute('aria-label', `重命名 ${item.name}`);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); this.commitRename(); }
      else if (event.key === 'Escape') { event.preventDefault(); this.cancelRename(true); }
    });
    input.addEventListener('blur', () => { if (this.renameInput === input) this.commitRename(); });
    this.renameInput = input;
    this.renameId = id;
    row.name.replaceWith(input);
    input.focus();
    input.select();
  }

  private commitRename(): void {
    const input = this.renameInput;
    const id = this.renameId;
    if (!input || !id) return;
    try {
      this.session.editor.exec({ type: 'SetName', id, name: input.value });
      this.finishRename(id);
    } catch (error) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      this.report(error);
    }
  }

  private cancelRename(focus = false): void {
    const id = this.renameId;
    if (!this.renameInput || !id) return;
    this.finishRename(id);
    if (focus) this.focusElement(id);
  }

  private finishRename(id: ElementId): void {
    const input = this.renameInput;
    const row = this.rows.get(id);
    this.renameInput = null;
    this.renameId = null;
    if (input && row && input.isConnected) input.replaceWith(row.name);
    this.syncRows();
  }

  private run(action: () => void): void {
    try { action(); } catch (error) { this.report(error); }
  }

  private report(error: unknown): void {
    if (this.onError) this.onError(error);
    else {
      const reporter = (globalThis as typeof globalThis & { reportError?: (value: unknown) => void }).reportError;
      if (reporter) reporter(error);
      else console.error('选择窗格操作失败', error);
    }
  }
}

export function createSelectionPane(
  container: HTMLElement,
  session: EditorSession,
  options: SelectionPaneOptions = {},
): SelectionPane {
  return new DomSelectionPane(container, session, options);
}
