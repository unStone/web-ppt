import { querySlideAnimations, querySlideTransition } from '@web-ppt/edit-core';
import type {
  EditAnimationStep, EditorChange, LinkTarget, SlideAnimationState, SlideId, SlideTransitionInput,
  SlideTransitionState, TextSearchMatch,
} from '@web-ppt/edit-core';
import { openEditor } from './session';
import type { EditorSession, OpenEditorOptions } from './session';
import { RecoveryOpenCancelledError } from './recovery-store';
import { bindAdapterRecovery } from './adapter-recovery';
import type {
  LinkFollowContext, SlideEditor,
} from './slide-editor-types';
import type { WebPptSource } from './source-fingerprint';
import { openOptionsKey, sameMargins, validateViewOptions } from './adapter-options';
import type { SelectionPane } from './selection-pane-types';
import { AdapterSelectionPaneBinding } from './adapter-selection-pane';
import type {
  WebPptAdapter, WebPptAdapterBinding, WebPptAdapterCallbacks, WebPptAdapterSnapshot,
  WebPptAdapterSubscriber, WebPptDocument, WebPptFormatPainterState, WebPptTextSearchState,
  WebPptViewOptions, WebPptViewState,
} from './framework-adapter-types';
import type { FormatPainterStartOptions } from './format-painter-types';
import { AdapterFormatPainterBinding } from './adapter-format-painter';
import { AdapterTextSearchBinding } from './adapter-text-search';
import type { TextSearchOpenOptions, TextSearchOptions } from './text-search-types';
import {
  DEFAULT_WEB_PPT_VIEW as DEFAULT_VIEW, WEB_PPT_IDLE_SNAPSHOT,
} from './framework-adapter-state';
import { followAdapterLink } from './adapter-link';

class BrowserWebPptAdapter implements WebPptAdapter {
  private callbacks: WebPptAdapterCallbacks;
  private readonly subscribers = new Set<WebPptAdapterSubscriber>();
  private container: HTMLElement | null = null;
  private readonly paneBinding = new AdapterSelectionPaneBinding();
  private session: EditorSession | null = null;
  private view: SlideEditor | null = null;
  private ownsSession = false;
  private unsubscribeEditor: (() => void) | null = null;
  private readonly formatPainterBinding = new AdapterFormatPainterBinding();
  private readonly textSearchBinding: AdapterTextSearchBinding;
  private desired: WebPptViewOptions = DEFAULT_VIEW;
  private currentSnapshot: WebPptAdapterSnapshot = WEB_PPT_IDLE_SNAPSHOT;
  private generation = 0;
  private currentSource: WebPptSource | null = null;
  private currentOpenKey = '';
  private opening: Promise<EditorSession | null> | null = null;
  private openingAbort: AbortController | null = null;
  private activeRecoveryGeneration: number | null = null;
  private isDisposed = false;

  constructor(callbacks: WebPptAdapterCallbacks) {
    this.callbacks = callbacks;
    this.textSearchBinding = new AdapterTextSearchBinding((match) => {
      if (match.slideId !== this.snapshot.slideId) this.setView({ slideId: match.slideId });
    });
  }

  get snapshot(): WebPptAdapterSnapshot { return this.currentSnapshot; }
  get disposed(): boolean { return this.isDisposed; }

  subscribe(subscriber: WebPptAdapterSubscriber): () => void {
    if (typeof subscriber !== 'function') throw new Error('adapter 订阅者必须是函数');
    this.subscribers.add(subscriber);
    return () => { this.subscribers.delete(subscriber); };
  }

  setCallbacks(callbacks: WebPptAdapterCallbacks): void { this.callbacks = callbacks; }

  async applyBinding(binding: WebPptAdapterBinding): Promise<EditorSession | null> {
    this.setCallbacks({ ...this.callbacks, ...binding });
    try {
      if (binding.source != null && binding.session != null) {
        throw new Error('source 与 session 不能同时提供');
      }
      this.setView({
        mode: binding.mode ?? DEFAULT_VIEW.mode,
        slideId: binding.slideId,
        zoom: binding.zoom ?? DEFAULT_VIEW.zoom,
        textMode: binding.textMode ?? DEFAULT_VIEW.textMode,
        snapping: binding.snapping ?? DEFAULT_VIEW.snapping,
        snapMargins: binding.snapMargins,
        onLinkFollow: binding.onLinkFollow,
      });
      if (binding.session != null) {
        return await this.setDocument({
          session: binding.session,
          ownership: binding.sessionOwnership as 'external',
        });
      }
      return binding.source == null
        ? await this.setDocument(null)
        : await this.setDocument({ source: binding.source, openOptions: binding.openOptions });
    } catch (error) {
      if (!this.isDisposed
        && (this.currentSnapshot.status !== 'error' || this.currentSnapshot.error !== error)) this.fail(error);
      throw error;
    }
  }

  attach(container: HTMLElement | null): void {
    this.assertActive();
    if (container === this.container) return;
    const previous = this.view;
    const next = container && this.session ? this.mount(this.session, container) : null;
    this.container = container;
    this.view = next;
    previous?.destroy();
    this.publishReadyState(false);
  }

  attachSelectionPane(container: HTMLElement | null): void {
    this.assertActive();
    this.paneBinding.attach(
      container, this.session, this.desired, this.view?.slideId ?? null,
      (error) => this.emitError(error),
    );
    this.publishReadyState(false);
  }

  setView(options: WebPptViewOptions): void {
    this.assertActive();
    validateViewOptions(options);
    const previous = this.desired;
    const desired = { ...previous, ...options };
    const margins = desired.snapMargins;
    const meta = this.session?.editor.doc.meta;
    if (margins && meta && (margins.left + margins.right >= meta.width
      || margins.top + margins.bottom >= meta.height)) {
      throw new Error('吸附页边距必须位于页面内');
    }
    this.desired = desired;
    if (options.mode === 'view' && previous.mode !== 'view') this.formatPainterBinding.cancel();
    const rebuild = previous.textMode !== this.desired.textMode
      || !sameMargins(previous.snapMargins, this.desired.snapMargins);
    if (rebuild && this.session && this.container) {
      const next = this.mount(this.session, this.container);
      const old = this.view;
      this.view = next;
      old?.destroy();
    } else if (this.view) {
      if (this.desired.mode !== undefined) this.view.setMode(this.desired.mode);
      if (this.desired.slideId !== undefined
        && this.session?.editor.doc.slides[this.desired.slideId]) {
        this.view.setSlide(this.desired.slideId);
      }
      if (this.desired.zoom !== undefined) this.view.setZoom(this.desired.zoom);
      if (this.desired.snapping !== undefined) this.view.setSnapping(this.desired.snapping);
    }
    this.paneBinding.sync(this.session, this.desired);
    this.publishReadyState(true);
  }

  async setDocument(document: WebPptDocument | null): Promise<EditorSession | null> {
    this.assertActive();
    if (document === null) {
      this.cancelOpening();
      this.generation++;
      this.currentSource = null;
      this.currentOpenKey = '';
      this.opening = null;
      this.releaseCurrent();
      this.updateSnapshot({
        status: 'idle', progress: 0, error: null, session: null, view: null,
        selectionPane: null, slideId: null, documentKind: null,
        recovery: null, formatPainter: WEB_PPT_IDLE_SNAPSHOT.formatPainter,
        textSearch: WEB_PPT_IDLE_SNAPSHOT.textSearch,
      });
      return null;
    }
    if (document.session !== undefined) {
      return this.useExternal(document as Extract<WebPptDocument, { session: EditorSession }>);
    }
    if (!('source' in document) || document.source === undefined || document.source === null) {
      return this.rejectDocument(new Error('adapter source 不能为空'));
    }
    const key = openOptionsKey(document.openOptions);
    if (this.currentSource === document.source && this.currentOpenKey === key) {
      if (this.opening) return this.opening;
      if (this.ownsSession && this.session && !this.session.disposed) return this.session;
    }
    const generation = ++this.generation;
    this.cancelOpening();
    const abort = new AbortController();
    this.openingAbort = abort;
    this.currentSource = document.source;
    this.currentOpenKey = key;
    this.updateSnapshot({
      status: 'opening', progress: 0, error: null, recovery: null,
      formatPainter: { ...this.formatPainterState(false), readonly: true },
      textSearch: { ...this.textSearchState(false), canReplace: false },
    });
    this.notify((callbacks) => callbacks.onProgress?.({ phase: 'opening', ratio: 0 }));
    const opening = this.openOwned(document.source, document.openOptions, generation, abort.signal);
    this.opening = opening;
    try {
      return await opening;
    } finally {
      if (this.opening === opening) {
        this.opening = null;
      }
    }
  }

  async save(): Promise<Uint8Array> {
    this.assertReady();
    return this.session!.editor.save();
  }

  undo(): EditorChange | null { this.assertReady(); return this.session!.editor.undo(); }
  redo(): EditorChange | null { this.assertReady(); return this.session!.editor.redo(); }

  startFormatPainter(options: FormatPainterStartOptions = {}): boolean {
    this.assertReady();
    if (this.formatPainterState().readonly) return false;
    try {
      return this.view
        ? this.view.startFormatPainter(options)
        : this.formatPainterBinding.start(options);
    } catch (error) {
      this.emitError(error);
      throw error;
    }
  }

  cancelFormatPainter(): void {
    this.assertReady();
    this.formatPainterBinding.cancel();
  }

  openTextSearch(options: TextSearchOpenOptions = {}): void { this.assertReady(); this.textSearchBinding.open(options); }
  closeTextSearch(): void { this.assertReady(); this.textSearchBinding.close(); }
  setTextSearchQuery(query: string): void { this.assertReady(); this.textSearchBinding.setQuery(query); }
  setTextSearchReplacement(value: string): void { this.assertReady(); this.textSearchBinding.setReplacement(value); }
  setTextSearchOptions(options: Partial<TextSearchOptions>): void { this.assertReady(); this.textSearchBinding.setOptions(options); }
  nextTextSearch(): TextSearchMatch | null { this.assertReady(); return this.textSearchBinding.next(); }
  previousTextSearch(): TextSearchMatch | null { this.assertReady(); return this.textSearchBinding.previousMatch(); }
  replaceCurrentText(): boolean { this.assertReady(); return this.textSearchState().canReplace && this.textSearchBinding.replaceCurrent(); }
  replaceAllText(): number { this.assertReady(); return this.textSearchState().canReplace ? this.textSearchBinding.replaceAll() : 0; }

  queryTransition(): SlideTransitionState | null {
    this.assertReady();
    const slideId = this.currentSnapshot.slideId;
    return slideId ? querySlideTransition(this.session!.editor.doc, [slideId]) : null;
  }

  setTransition(value: SlideTransitionInput | null): boolean {
    this.assertReady();
    const slideId = this.currentSnapshot.slideId;
    if (!slideId || this.currentSnapshot.mode !== 'edit' || this.session!.editor.doc.meta.readonly) {
      return false;
    }
    this.session!.editor.exec({ type: 'SetTransition', id: slideId, t: value });
    return true;
  }

  previewTransition(value?: SlideTransitionInput): Promise<boolean> {
    this.assertReady();
    return this.view?.previewTransition(value) ?? Promise.resolve(false);
  }

  queryAnimations(): SlideAnimationState | null {
    this.assertReady();
    const slideId = this.currentSnapshot.slideId;
    return slideId ? querySlideAnimations(this.session!.editor.doc, [slideId]) : null;
  }

  setAnimations(value: readonly EditAnimationStep[] | null): boolean {
    this.assertReady();
    const slideId = this.currentSnapshot.slideId;
    if (!slideId || this.currentSnapshot.mode !== 'edit' || this.session!.editor.doc.meta.readonly) {
      return false;
    }
    this.session!.editor.exec({ type: 'SetAnimations', slideId, steps: value });
    return true;
  }

  previewAnimations(value?: readonly EditAnimationStep[]): Promise<boolean> {
    this.assertReady();
    return this.view?.previewAnimations(value) ?? Promise.resolve(false);
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.cancelOpening();
    this.generation++;
    this.opening = null;
    this.releaseCurrent();
    this.container = null;
    this.paneBinding.dispose();
    this.currentSource = null;
    this.currentOpenKey = '';
    this.currentSnapshot = {
      ...this.currentSnapshot, status: 'disposed', progress: 0, error: null,
      session: null, view: null, selectionPane: null, slideId: null, recovery: null,
      documentKind: null,
      formatPainter: WEB_PPT_IDLE_SNAPSHOT.formatPainter,
      textSearch: WEB_PPT_IDLE_SNAPSHOT.textSearch,
    };
    this.notifySubscribers();
    this.subscribers.clear();
  }

  private async openOwned(
    source: WebPptSource,
    options: OpenEditorOptions | undefined,
    generation: number,
    signal: AbortSignal,
  ): Promise<EditorSession | null> {
    let session: EditorSession;
    const boundOptions = bindAdapterRecovery(options, signal, {
      active: () => generation === this.generation && !this.isDisposed,
      errorActive: () => this.activeRecoveryGeneration === generation && !this.isDisposed,
      decision: () => this.callbacks.onRecovery,
      recovering: (candidate) => {
        this.updateSnapshot({ status: 'recovering', progress: 0, recovery: candidate });
        this.notify((callbacks) => callbacks.onProgress?.({ phase: 'recovering', ratio: 0 }));
      },
      opening: () => this.updateSnapshot({ status: 'opening', recovery: null }),
      errorHandler: () => this.callbacks.onError,
      error: (error) => this.emitError(error),
    });
    try {
      session = await openEditor(source, boundOptions);
    } catch (error) {
      if (boundOptions?.recovery?.signal?.aborted
        || error instanceof RecoveryOpenCancelledError) {
        this.publishCancelledOpen(generation);
        return null;
      }
      if (generation === this.generation && !this.isDisposed) this.fail(error);
      throw error;
    }
    if (generation !== this.generation || this.isDisposed) {
      session.dispose();
      return null;
    }
    try {
      this.commitSession(session, true, generation);
      return session;
    } catch (error) {
      session.dispose();
      this.fail(error);
      throw error;
    }
  }

  private async useExternal(document: Extract<WebPptDocument, { session: EditorSession }>): Promise<EditorSession> {
    if (document.ownership !== 'external') {
      return this.rejectDocument(new Error('注入 EditorSession 必须声明 ownership: external'));
    }
    if (document.session.disposed) return this.rejectDocument(new Error('不能注入已释放的 EditorSession'));
    this.cancelOpening();
    ++this.generation;
    this.currentSource = null;
    this.currentOpenKey = '';
    this.opening = null;
    if (this.session === document.session && !this.ownsSession) {
      const wasReady = this.currentSnapshot.status === 'ready';
      this.updateSnapshot({
        status: 'ready', progress: 1, error: null, session: this.session, view: this.view,
      });
      this.publishReadyState(true);
      if (!wasReady) {
        this.notify((callbacks) => callbacks.onProgress?.({ phase: 'ready', ratio: 1 }));
        this.notify((callbacks) => callbacks.onReady?.(document.session));
      }
      return document.session;
    }
    try {
      this.commitSession(document.session, false, null);
      return document.session;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private commitSession(
    session: EditorSession,
    owned: boolean,
    recoveryGeneration: number | null,
  ): void {
    const nextView = this.container ? this.mount(session, this.container) : null;
    let nextPane: SelectionPane | null = null;
    try {
      nextPane = this.paneBinding.prepare(
        session, this.desired, nextView?.slideId ?? null, (error) => this.emitError(error),
      );
    } catch (error) {
      nextView?.destroy();
      throw error;
    }
    const previousSession = this.session;
    const previousOwned = this.ownsSession;
    const previousView = this.view;
    this.unsubscribeEditor?.();
    this.unsubscribeEditor = null;
    this.formatPainterBinding.release();
    this.textSearchBinding.release();
    this.session = session;
    this.ownsSession = owned;
    this.activeRecoveryGeneration = recoveryGeneration;
    this.view = nextView;
    previousView?.destroy();
    this.paneBinding.commit(nextPane);
    if (previousOwned && previousSession && previousSession !== session) previousSession.dispose();
    this.unsubscribeEditor = session.editor.subscribe((change) => {
      this.notify((callbacks) => callbacks.onChange?.(change));
      queueMicrotask(() => {
        if (this.session !== session || this.isDisposed) return;
        this.publishReadyState(true);
      });
    });
    this.formatPainterBinding.bind(session, () => {
      if (this.session === session && !this.isDisposed) this.publishReadyState(false);
    });
    this.textSearchBinding.bind(session, () => {
      if (this.session === session && !this.isDisposed) this.publishReadyState(false);
    });
    this.updateSnapshot({
      status: 'ready', progress: 1, error: null, session: this.session, view: this.view,
      selectionPane: this.paneBinding.pane,
      documentKind: session.editor.doc.meta.source,
      recovery: null, formatPainter: this.formatPainterState(false),
      textSearch: this.textSearchState(false),
    });
    this.publishReadyState(true);
    this.notify((callbacks) => callbacks.onProgress?.({ phase: 'ready', ratio: 1 }));
    this.notify((callbacks) => callbacks.onReady?.(session));
  }

  private mount(session: EditorSession, container: HTMLElement): SlideEditor {
    const slideId = this.desired.slideId && session.editor.doc.slides[this.desired.slideId]
      ? this.desired.slideId : session.editor.doc.slideOrder[0];
    return session.mount(container, {
      mode: this.desired.mode ?? DEFAULT_VIEW.mode,
      zoom: this.desired.zoom ?? DEFAULT_VIEW.zoom,
      textMode: this.desired.textMode ?? DEFAULT_VIEW.textMode,
      snapping: this.desired.snapping ?? DEFAULT_VIEW.snapping,
      snapMargins: this.desired.snapMargins,
      slideId,
      onLinkFollow: (target, context) => this.followLink(target, context),
      onSlideChange: (nextSlide) => this.handleSlideChange(nextSlide),
      onError: (error) => this.emitError(error),
    });
  }

  private handleSlideChange(slideId: SlideId): void {
    if (!this.session?.editor.doc.slides[slideId]) return;
    this.desired = { ...this.desired, slideId };
    this.paneBinding.sync(this.session, { ...this.desired, slideId });
    this.publishReadyState(true);
  }

  private followLink(target: LinkTarget, context: LinkFollowContext): boolean | void {
    return followAdapterLink(
      target, context, this.desired.onLinkFollow,
      (slideId) => this.setView({ slideId }), (error) => this.emitError(error),
    );
  }

  private releaseCurrent(): void {
    this.unsubscribeEditor?.();
    this.unsubscribeEditor = null;
    this.formatPainterBinding.release();
    this.textSearchBinding.release();
    this.view?.destroy();
    this.view = null;
    this.paneBinding.release();
    if (this.ownsSession) this.session?.dispose();
    this.session = null;
    this.ownsSession = false;
    this.activeRecoveryGeneration = null;
  }

  private publishReadyState(notifyView: boolean): void {
    const viewState: WebPptViewState = {
      mode: this.view?.mode ?? this.desired.mode ?? DEFAULT_VIEW.mode,
      slideId: this.view?.slideId
        ?? (this.desired.slideId && this.session?.editor.doc.slides[this.desired.slideId]
          ? this.desired.slideId : this.session?.editor.doc.slideOrder[0] ?? null),
      zoom: this.view?.zoom ?? this.desired.zoom ?? DEFAULT_VIEW.zoom,
      snapping: this.view?.snapping ?? this.desired.snapping ?? DEFAULT_VIEW.snapping,
    };
    const changed = viewState.mode !== this.currentSnapshot.mode
      || viewState.slideId !== this.currentSnapshot.slideId
      || viewState.zoom !== this.currentSnapshot.zoom
      || viewState.snapping !== this.currentSnapshot.snapping;
    this.updateSnapshot({
      ...viewState, session: this.session, view: this.view, selectionPane: this.paneBinding.pane,
      documentKind: this.session?.editor.doc.meta.source ?? null,
      formatPainter: this.formatPainterState(),
      textSearch: this.textSearchState(),
    });
    if (notifyView && changed) this.notify((callbacks) => callbacks.onViewChange?.(viewState));
  }

  private formatPainterState(ready = this.currentSnapshot.status === 'ready'): WebPptFormatPainterState {
    return this.formatPainterBinding.state(
      ready, this.view?.mode ?? this.desired.mode ?? DEFAULT_VIEW.mode,
    );
  }

  private textSearchState(ready = this.currentSnapshot.status === 'ready'): WebPptTextSearchState {
    return this.textSearchBinding.state(
      ready, this.view?.mode ?? this.desired.mode ?? DEFAULT_VIEW.mode,
    );
  }

  private cancelOpening(): void {
    this.openingAbort?.abort(new Error('新的文档请求已取代旧请求'));
    this.openingAbort = null;
  }

  private publishCancelledOpen(generation: number): void {
    if (generation !== this.generation || this.isDisposed) return;
    this.currentSource = null;
    this.currentOpenKey = '';
    this.updateSnapshot({
      status: this.session ? 'ready' : 'idle', progress: this.session ? 1 : 0,
      error: null, recovery: null, formatPainter: this.formatPainterState(!!this.session),
      textSearch: this.textSearchState(!!this.session),
    });
  }

  private updateSnapshot(patch: Partial<WebPptAdapterSnapshot>): void {
    const keys = Object.keys(patch) as Array<keyof WebPptAdapterSnapshot>;
    if (keys.every((key) => Object.is(this.currentSnapshot[key], patch[key]))) return;
    this.currentSnapshot = { ...this.currentSnapshot, ...patch };
    this.notifySubscribers();
  }

  private fail(error: unknown): void {
    this.currentSource = null;
    this.currentOpenKey = '';
    this.updateSnapshot({
      status: 'error', error, progress: 0, recovery: null,
      formatPainter: { ...this.formatPainterState(false), readonly: true },
      textSearch: { ...this.textSearchState(false), canReplace: false },
    });
    this.emitError(error);
  }

  private notifySubscribers(): void {
    for (const subscriber of [...this.subscribers]) {
      try { subscriber(this.currentSnapshot); } catch (error) { this.emitError(error); }
    }
  }

  private notify(run: (callbacks: WebPptAdapterCallbacks) => void): void {
    try { run(this.callbacks); } catch (error) { this.emitError(error); }
  }

  private emitError(error: unknown): void {
    try { this.callbacks.onError?.(error); } catch { /* 宿主事件不能破坏资源生命周期。 */ }
  }

  private async rejectDocument(error: Error): Promise<never> {
    this.fail(error);
    throw error;
  }

  private assertActive(): void {
    if (this.isDisposed) throw new Error('WebPptAdapter 已经释放');
  }

  private assertReady(): void {
    this.assertActive();
    if (!this.session || this.session.disposed) throw new Error('WebPptAdapter 尚未打开演示文稿');
  }
}

export function createWebPptAdapter(callbacks: WebPptAdapterCallbacks = {}): WebPptAdapter {
  return new BrowserWebPptAdapter(callbacks);
}
