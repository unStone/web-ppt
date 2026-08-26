import type { EditorChange, SlideId } from '@web-ppt/edit-core';
import type { RecoveryCandidate, RecoveryDecision } from './recovery-store';
import type { EditorSession, OpenEditorOptions } from './session';
import type { SelectionPane } from './selection-pane-types';
import type {
  EditorMode, LinkFollowHandler, SlideEditor, SlideEditorOptions,
} from './slide-editor-types';
import type { WebPptSource } from './source-fingerprint';
import type {
  FormatPainterSnapshot, FormatPainterStartOptions,
} from './format-painter-types';

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
  readonly phase: 'opening' | 'recovering' | 'ready';
  readonly ratio: 0 | 1;
}

export interface WebPptViewState {
  readonly mode: EditorMode;
  readonly slideId: SlideId | null;
  readonly zoom: number;
  readonly snapping: boolean;
}

export interface WebPptFormatPainterState extends FormatPainterSnapshot {
  /** 文档未就绪、只读或当前为查看模式时为 true。 */
  readonly readonly: boolean;
}

export interface WebPptAdapterCallbacks {
  readonly onReady?: (session: EditorSession) => void;
  readonly onError?: (error: unknown) => void;
  readonly onProgress?: (progress: WebPptAdapterProgress) => void;
  readonly onChange?: (change: EditorChange) => void;
  readonly onViewChange?: (state: WebPptViewState) => void;
  readonly onRecovery?: (candidate: RecoveryCandidate) => RecoveryDecision | Promise<RecoveryDecision>;
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
  readonly status: 'idle' | 'opening' | 'recovering' | 'ready' | 'error' | 'disposed';
  readonly progress: number;
  readonly error: unknown | null;
  readonly session: EditorSession | null;
  readonly view: SlideEditor | null;
  readonly selectionPane: SelectionPane | null;
  readonly recovery: RecoveryCandidate | null;
  readonly formatPainter: WebPptFormatPainterState;
}

export type WebPptAdapterSubscriber = (snapshot: WebPptAdapterSnapshot) => void;

export interface WebPptAdapter {
  readonly snapshot: WebPptAdapterSnapshot;
  readonly disposed: boolean;
  subscribe(subscriber: WebPptAdapterSubscriber): () => void;
  setCallbacks(callbacks: WebPptAdapterCallbacks): void;
  applyBinding(binding: WebPptAdapterBinding): Promise<EditorSession | null>;
  attach(container: HTMLElement | null): void;
  attachSelectionPane(container: HTMLElement | null): void;
  setView(options: WebPptViewOptions): void;
  setDocument(document: WebPptDocument | null): Promise<EditorSession | null>;
  save(): Promise<Uint8Array>;
  undo(): EditorChange | null;
  redo(): EditorChange | null;
  startFormatPainter(options?: FormatPainterStartOptions): boolean;
  cancelFormatPainter(): void;
  dispose(): void;
}
