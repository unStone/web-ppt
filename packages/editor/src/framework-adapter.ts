import type { EditorChange, LinkTarget, SlideId } from '@web-ppt/edit-core';
import { openEditor } from './session';
import type { EditorSession, OpenEditorOptions } from './session';
import type {
  EditorMode, LinkFollowContext, LinkFollowHandler, SlideEditor, SlideEditorOptions,
} from './slide-editor-types';

export type WebPptSource = File | Blob | ArrayBuffer | Uint8Array;

export type WebPptDocument = {
  readonly source: WebPptSource;
  readonly openOptions?: OpenEditorOptions;
  readonly session?: never;
  readonly ownership?: never;
} | {
  readonly session: EditorSession;
  readonly ownership: 'external';
  readonly source?: never;
  readonly openOptions?: never;
};

export interface WebPptViewOptions {
  readonly mode?: EditorMode;
  readonly slideId?: SlideId;
  readonly zoom?: number;
  readonly textMode?: SlideEditorOptions['textMode'];
  readonly snapping?: boolean;
  readonly snapMargins?: SlideEditorOptions['snapMargins'];
  readonly onLinkFollow?: LinkFollowHandler;
}

export interface WebPptAdapterProgress {
  readonly phase: 'opening' | 'ready';
  readonly ratio: 0 | 1;
}

export interface WebPptViewState {
  readonly mode: EditorMode;
  readonly slideId: SlideId | null;
  readonly zoom: number;
  readonly snapping: boolean;
}

export interface WebPptAdapterCallbacks {
  readonly onReady?: (session: EditorSession) => void;
  readonly onError?: (error: unknown) => void;
  readonly onProgress?: (progress: WebPptAdapterProgress) => void;
  readonly onChange?: (change: EditorChange) => void;
  readonly onViewChange?: (state: WebPptViewState) => void;
}

export type WebPptAdapterBinding = WebPptViewOptions & WebPptAdapterCallbacks & ({
  readonly source: WebPptSource;
  readonly openOptions?: OpenEditorOptions;
  readonly session?: never;
  readonly sessionOwnership?: never;
} | {
  readonly session: EditorSession;
  readonly sessionOwnership: 'external';
  readonly source?: never;
  readonly openOptions?: never;
} | {
  readonly source?: null;
  readonly session?: null;
  readonly sessionOwnership?: never;
  readonly openOptions?: OpenEditorOptions;
});

export interface WebPptAdapterSnapshot extends WebPptViewState {
  readonly status: 'idle' | 'opening' | 'ready' | 'error' | 'disposed';
  readonly progress: number;
  readonly error: unknown | null;
  readonly session: EditorSession | null;
  readonly view: SlideEditor | null;
}

export type WebPptAdapterSubscriber = (snapshot: WebPptAdapterSnapshot) => void;

export interface WebPptAdapter {
  readonly snapshot: WebPptAdapterSnapshot;
  readonly disposed: boolean;
  subscribe(subscriber: WebPptAdapterSubscriber): () => void;
  setCallbacks(callbacks: WebPptAdapterCallbacks): void;
  applyBinding(binding: WebPptAdapterBinding): Promise<EditorSession | null>;
  attach(container: HTMLElement | null): void;
  setView(options: WebPptViewOptions): void;
  setDocument(document: WebPptDocument | null): Promise<EditorSession | null>;
  save(): Promise<Uint8Array>;
  undo(): EditorChange | null;
  redo(): EditorChange | null;
  dispose(): void;
}

/** React/Vue/Svelte/Web Component 只需把受控 props 映射到这一处。 */
export function applyWebPptAdapterBinding(
  adapter: WebPptAdapter,
  binding: WebPptAdapterBinding,
): Promise<EditorSession | null> {
  return adapter.applyBinding(binding);
}

const DEFAULT_VIEW = Object.freeze({
  mode: 'edit' as const, zoom: 1, textMode: 'auto' as const, snapping: true,
});

export const WEB_PPT_IDLE_SNAPSHOT: WebPptAdapterSnapshot = Object.freeze({
  status: 'idle', progress: 0, error: null, session: null, view: null,
  mode: DEFAULT_VIEW.mode, slideId: null, zoom: DEFAULT_VIEW.zoom, snapping: DEFAULT_VIEW.snapping,
});

function validateViewOptions(options: WebPptViewOptions): void {
  if (options.mode !== undefined && options.mode !== 'view' && options.mode !== 'edit') {
    throw new Error(`未知编辑器模式：${String(options.mode)}`);
  }
  if (options.zoom !== undefined && (!Number.isFinite(options.zoom) || options.zoom <= 0)) {
    throw new Error('缩放必须是有限正数');
  }
  if (options.textMode !== undefined
    && options.textMode !== 'auto' && options.textMode !== 'html' && options.textMode !== 'svg') {
    throw new Error(`未知文字模式：${String(options.textMode)}`);
  }
  if (options.snapping !== undefined && typeof options.snapping !== 'boolean') {
    throw new Error('吸附开关必须是布尔值');
  }
  const margins = options.snapMargins;
  if (margins && ![margins.left, margins.right, margins.top, margins.bottom]
    .every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error('吸附页边距必须是有限非负值');
  }
}

function openOptionsKey(options: OpenEditorOptions | undefined): string {
  return JSON.stringify({
    password: options?.password, idPrefix: options?.idPrefix, origin: options?.origin,
    historyLimit: options?.historyLimit, historyByteLimit: options?.historyByteLimit,
  });
}

function sameMargins(
  left: SlideEditorOptions['snapMargins'],
  right: SlideEditorOptions['snapMargins'],
): boolean {
  return left === right || !!left && !!right
    && left.left === right.left && left.right === right.right
    && left.top === right.top && left.bottom === right.bottom;
}

class BrowserWebPptAdapter implements WebPptAdapter {
  private callbacks: WebPptAdapterCallbacks;
  private readonly subscribers = new Set<WebPptAdapterSubscriber>();
  private container: HTMLElement | null = null;
  private session: EditorSession | null = null;
  private view: SlideEditor | null = null;
  private ownsSession = false;
  private unsubscribeEditor: (() => void) | null = null;
  private desired: WebPptViewOptions = DEFAULT_VIEW;
  private currentSnapshot: WebPptAdapterSnapshot = WEB_PPT_IDLE_SNAPSHOT;
  private generation = 0;
  private currentSource: WebPptSource | null = null;
  private currentOpenKey = '';
  private opening: Promise<EditorSession | null> | null = null;
  private isDisposed = false;

  constructor(callbacks: WebPptAdapterCallbacks) { this.callbacks = callbacks; }

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
    this.publishReadyState(true);
  }

  async setDocument(document: WebPptDocument | null): Promise<EditorSession | null> {
    this.assertActive();
    if (document === null) {
      this.generation++;
      this.currentSource = null;
      this.currentOpenKey = '';
      this.opening = null;
      this.releaseCurrent();
      this.updateSnapshot({
        status: 'idle', progress: 0, error: null, session: null, view: null, slideId: null,
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
    this.currentSource = document.source;
    this.currentOpenKey = key;
    this.updateSnapshot({ status: 'opening', progress: 0, error: null });
    this.notify((callbacks) => callbacks.onProgress?.({ phase: 'opening', ratio: 0 }));
    const opening = this.openOwned(document.source, document.openOptions, generation);
    this.opening = opening;
    try {
      return await opening;
    } finally {
      if (this.opening === opening) this.opening = null;
    }
  }

  async save(): Promise<Uint8Array> {
    this.assertReady();
    return this.session!.editor.save();
  }

  undo(): EditorChange | null { this.assertReady(); return this.session!.editor.undo(); }
  redo(): EditorChange | null { this.assertReady(); return this.session!.editor.redo(); }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.generation++;
    this.opening = null;
    this.releaseCurrent();
    this.container = null;
    this.currentSource = null;
    this.currentOpenKey = '';
    this.currentSnapshot = {
      ...this.currentSnapshot, status: 'disposed', progress: 0, error: null,
      session: null, view: null, slideId: null,
    };
    this.notifySubscribers();
    this.subscribers.clear();
  }

  private async openOwned(
    source: WebPptSource,
    options: OpenEditorOptions | undefined,
    generation: number,
  ): Promise<EditorSession | null> {
    let session: EditorSession;
    try {
      session = await openEditor(source, options);
    } catch (error) {
      if (generation === this.generation && !this.isDisposed) this.fail(error);
      throw error;
    }
    if (generation !== this.generation || this.isDisposed) {
      session.dispose();
      return null;
    }
    try {
      this.commitSession(session, true);
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
      this.commitSession(document.session, false);
      return document.session;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private commitSession(session: EditorSession, owned: boolean): void {
    const nextView = this.container ? this.mount(session, this.container) : null;
    const previousSession = this.session;
    const previousOwned = this.ownsSession;
    const previousView = this.view;
    this.unsubscribeEditor?.();
    this.unsubscribeEditor = null;
    this.session = session;
    this.ownsSession = owned;
    this.view = nextView;
    previousView?.destroy();
    if (previousOwned && previousSession && previousSession !== session) previousSession.dispose();
    this.unsubscribeEditor = session.editor.subscribe((change) => {
      this.notify((callbacks) => callbacks.onChange?.(change));
      queueMicrotask(() => {
        if (this.session !== session || this.isDisposed) return;
        this.publishReadyState(true);
      });
    });
    this.updateSnapshot({
      status: 'ready', progress: 1, error: null, session: this.session, view: this.view,
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
    });
  }

  private followLink(target: LinkTarget, context: LinkFollowContext): boolean | void {
    try {
      if (this.desired.onLinkFollow?.(target, context) === true) return true;
    } catch (error) {
      this.emitError(error);
      return undefined;
    }
    if (target.kind !== 'slide') return undefined;
    this.setView({ slideId: target.slideId });
    return true;
  }

  private releaseCurrent(): void {
    this.unsubscribeEditor?.();
    this.unsubscribeEditor = null;
    this.view?.destroy();
    this.view = null;
    if (this.ownsSession) this.session?.dispose();
    this.session = null;
    this.ownsSession = false;
  }

  private publishReadyState(notifyView: boolean): void {
    const viewState: WebPptViewState = {
      mode: this.view?.mode ?? this.desired.mode ?? DEFAULT_VIEW.mode,
      slideId: this.view?.slideId ?? this.session?.editor.doc.slideOrder[0] ?? null,
      zoom: this.view?.zoom ?? this.desired.zoom ?? DEFAULT_VIEW.zoom,
      snapping: this.view?.snapping ?? this.desired.snapping ?? DEFAULT_VIEW.snapping,
    };
    const changed = viewState.mode !== this.currentSnapshot.mode
      || viewState.slideId !== this.currentSnapshot.slideId
      || viewState.zoom !== this.currentSnapshot.zoom
      || viewState.snapping !== this.currentSnapshot.snapping;
    this.updateSnapshot({ ...viewState, session: this.session, view: this.view });
    if (notifyView && changed) this.notify((callbacks) => callbacks.onViewChange?.(viewState));
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
    this.updateSnapshot({ status: 'error', error, progress: 0 });
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
