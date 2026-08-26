import type { SlideId } from '@web-ppt/edit-core';
import type { EditorSession } from './session';
import type { SelectionPane } from './selection-pane-types';
import type { EditorMode } from './slide-editor-types';

interface PaneViewState {
  readonly mode?: EditorMode;
  readonly slideId?: SlideId;
}

/** adapter 的第二个 DOM 资源独立收口，文件替换时可先完整挂载再原子切换所有权。 */
export class AdapterSelectionPaneBinding {
  private currentContainer: HTMLElement | null = null;
  private currentPane: SelectionPane | null = null;

  get pane(): SelectionPane | null { return this.currentPane; }

  attach(
    container: HTMLElement | null,
    session: EditorSession | null,
    view: PaneViewState,
    fallbackSlide: SlideId | null,
    onError: (error: unknown) => void,
  ): void {
    if (container === this.currentContainer) return;
    const next = container && session
      ? this.mount(session, container, view, fallbackSlide, onError) : null;
    this.currentContainer = container;
    this.commit(next);
  }

  prepare(
    session: EditorSession,
    view: PaneViewState,
    fallbackSlide: SlideId | null,
    onError: (error: unknown) => void,
  ): SelectionPane | null {
    return this.currentContainer
      ? this.mount(session, this.currentContainer, view, fallbackSlide, onError) : null;
  }

  commit(next: SelectionPane | null): void {
    const previous = this.currentPane;
    this.currentPane = next;
    previous?.destroy();
  }

  sync(session: EditorSession | null, view: PaneViewState): void {
    if (!this.currentPane) return;
    if (view.mode !== undefined) this.currentPane.setMode(view.mode);
    if (view.slideId !== undefined && session?.editor.doc.slides[view.slideId]) {
      this.currentPane.setSlide(view.slideId);
    }
  }

  release(): void { this.commit(null); }

  dispose(): void {
    this.release();
    this.currentContainer = null;
  }

  private mount(
    session: EditorSession,
    container: HTMLElement,
    view: PaneViewState,
    fallbackSlide: SlideId | null,
    onError: (error: unknown) => void,
  ): SelectionPane {
    const slideId = view.slideId && session.editor.doc.slides[view.slideId]
      ? view.slideId : fallbackSlide ?? session.editor.doc.slideOrder[0];
    return session.mountSelectionPane(container, {
      mode: view.mode ?? 'edit', slideId, onError,
    });
  }
}
