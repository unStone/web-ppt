import { parse } from '@web-ppt/core';
import type { ParseOptions, Presentation } from '@web-ppt/core';
import {
  createDoc, disposeDoc, Editor, presentationSlideIdsByPart,
} from '@web-ppt/edit-core';
import type { CreateDocOptions, EditorOptions } from '@web-ppt/edit-core';
import { registerSession, releaseSession, sessionState } from './session-state';
import { createSlideEditor } from './slide-editor';
import type { SlideEditor, SlideEditorOptions } from './slide-editor-types';
import { RecoverySessionController } from './recovery-session';
import {
  RecoveryOpenCancelledError,
} from './recovery-store';
import type {
  EditorRecovery, RecoveryCandidate, RecoveryOptions, RecoveryStoreJournal,
} from './recovery-store';
import { fingerprintSourceBytes, sourceBytes } from './source-fingerprint';
import { createSelectionPane } from './selection-pane';
import type { SelectionPane, SelectionPaneOptions } from './selection-pane-types';
import { SessionFormatPainter } from './format-painter';
import type { FormatPainter } from './format-painter-types';
import { SessionTextSearch } from './text-search';
import type { TextSearch } from './text-search-types';

let recoverySessionSerial = 0;
const MAX_PRESENTATION_SLIDE_ID = 0x7fff_ffff;

function recoveryToken(): string {
  recoverySessionSerial++;
  const words = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(words);
  return words[0] || words[1]
    ? `${words[0].toString(36)}${words[1].toString(36)}`
    : `${Date.now().toString(36)}${recoverySessionSerial.toString(36)}`;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('演示文稿打开已取消');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function waitForDecision<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

export interface OpenEditorOptions extends CreateDocOptions, EditorOptions {
  password?: ParseOptions['password'];
  recovery?: RecoveryOptions;
}

/** 一份源文件只建立一个所有者，DOM 视图与框架适配器共享同一 headless Editor。 */
export interface EditorSession {
  readonly editor: Editor;
  readonly recovery: EditorRecovery | null;
  readonly formatPainter: FormatPainter;
  readonly textSearch: TextSearch;
  readonly disposed: boolean;
  /**
   * 取得当前编辑投影，供图片导出等只读能力直接消费。
   * 资源 URL 仍由会话拥有，因此返回值只在会话释放前有效。
   */
  toPresentation(): Presentation;
  mount(container: HTMLElement, options?: SlideEditorOptions): SlideEditor;
  mountSelectionPane(container: HTMLElement, options?: SelectionPaneOptions): SelectionPane;
  dispose(): void;
}

class BrowserEditorSession implements EditorSession {
  readonly editor: Editor;
  readonly recovery: RecoverySessionController | null;
  readonly formatPainter: SessionFormatPainter;
  readonly textSearch: SessionTextSearch;
  private isDisposed = false;
  private readonly projectedSlideIds = new Map<string, number>();
  private readonly projectedSlideIdOwners = new Map<number, string>();
  private readonly sourceSlideIdsByPart: ReadonlyMap<string, number>;

  constructor(
    editor: Editor,
    presentation: Awaited<ReturnType<typeof parse>>,
    recovery: RecoverySessionController | null,
  ) {
    this.editor = editor;
    this.recovery = recovery;
    this.formatPainter = new SessionFormatPainter(editor);
    this.textSearch = new SessionTextSearch(editor);
    this.sourceSlideIdsByPart = presentationSlideIdsByPart(editor.doc);
    const sectionIdByIndex = new Map<number, number>();
    for (const section of presentation.sections ?? []) {
      section.slideIndexes?.forEach((index, at) => {
        const value = section.slideIds[at];
        if (Number.isSafeInteger(value) && value >= 256 && value <= MAX_PRESENTATION_SLIDE_ID) {
          sectionIdByIndex.set(index, value);
        }
      });
    }
    const initialSlides = presentation.slides.map((slide, index) => ({
      id: `${editor.doc.identity.prefix}s${(index + 1).toString(36)}`,
      index,
      part: slide.editInfo?.origin?.part,
    }));
    // 先为原始来源页保留身份，即使恢复日志已删除该页，剩余页也不能趁机换号。
    for (const slide of initialSlides) {
      const value = (slide.part ? this.sourceSlideIdsByPart.get(slide.part) : undefined)
        ?? sectionIdByIndex.get(slide.index);
      if (value !== undefined) this.claimProjectedSlideId(slide.id, value);
    }
    for (const slide of initialSlides) {
      if (!this.projectedSlideIds.has(slide.id)) this.allocateProjectedSlideId(slide.id);
    }
    const currentSlides = Object.keys(editor.doc.slides).sort();
    for (const slideId of currentSlides) {
      if (this.projectedSlideIds.has(slideId)) continue;
      const record = editor.doc.slides[slideId];
      const exact = record.creation?.presentationSlideId
        ?? (record.origin ? this.sourceSlideIdsByPart.get(record.origin.part) : undefined);
      if (exact !== undefined) this.claimProjectedSlideId(slideId, exact);
    }
    for (const slideId of currentSlides) {
      if (!this.projectedSlideIds.has(slideId)) this.allocateProjectedSlideId(slideId);
    }
    registerSession(this, presentation);
  }

  get disposed(): boolean { return this.isDisposed; }

  private claimProjectedSlideId(slideId: string, value: number): boolean {
    if (!Number.isSafeInteger(value) || value < 256 || value > MAX_PRESENTATION_SLIDE_ID) {
      return false;
    }
    const owner = this.projectedSlideIdOwners.get(value);
    if (owner !== undefined && owner !== slideId) return false;
    this.projectedSlideIds.set(slideId, value);
    this.projectedSlideIdOwners.set(value, slideId);
    return true;
  }

  private projectedSlideId(slideId: string): number {
    const known = this.projectedSlideIds.get(slideId);
    if (known !== undefined) return known;
    const record = this.editor.doc.slides[slideId];
    const exact = record?.creation?.presentationSlideId
      ?? (record?.origin ? this.sourceSlideIdsByPart.get(record.origin.part) : undefined);
    if (exact !== undefined && this.claimProjectedSlideId(slideId, exact)) return exact;
    return this.allocateProjectedSlideId(slideId);
  }

  private allocateProjectedSlideId(slideId: string): number {
    const marker = `${this.editor.doc.identity.prefix}s`;
    const suffix = slideId.startsWith(marker) ? slideId.slice(marker.length) : '';
    const serial = /^[0-9a-z]+$/.test(suffix) ? Number.parseInt(suffix, 36) : 0;
    const range = MAX_PRESENTATION_SLIDE_ID - 255;
    let candidate: number;
    if (Number.isSafeInteger(serial) && serial > 0 && serial <= range) {
      candidate = MAX_PRESENTATION_SLIDE_ID - serial + 1;
    } else {
      let hash = 0x811c9dc5;
      for (let index = 0; index < slideId.length; index++) {
        hash = Math.imul(hash ^ slideId.charCodeAt(index), 0x01000193);
      }
      candidate = 256 + ((hash >>> 0) % range);
    }
    for (let tried = 0; tried < range; tried++) {
      if (!this.projectedSlideIdOwners.has(candidate)) {
        this.claimProjectedSlideId(slideId, candidate);
        return candidate;
      }
      candidate = candidate === 256 ? MAX_PRESENTATION_SLIDE_ID : candidate - 1;
    }
    throw new Error('演示文稿的投影页面身份已耗尽');
  }

  toPresentation(): Presentation {
    if (this.isDisposed) throw new Error('不能读取已经释放的编辑会话');
    const source = sessionState(this).presentation;
    const positions = new Map(this.editor.doc.slideOrder.map((id, index) => [id, index]));
    const sections = this.editor.doc.sections.order.map((id) => {
      const section = this.editor.doc.sections.records[id];
      return {
        id: section.presentationId,
        name: section.name,
        slideIds: section.slideIds.map((slideId) => this.projectedSlideId(slideId)),
        slideIndexes: section.slideIds.flatMap((slideId) => positions.get(slideId) ?? []),
      };
    });
    return {
      width: this.editor.doc.meta.width,
      height: this.editor.doc.meta.height,
      source: source.source,
      slides: this.editor.doc.slideOrder.map((id) => this.editor.toSlide(id)),
      ...(source.embeddedFonts ? { embeddedFonts: [...source.embeddedFonts] } : {}),
      ...(sections.length ? { sections } : {}),
    };
  }

  mount(container: HTMLElement, options: SlideEditorOptions = {}): SlideEditor {
    if (this.isDisposed) throw new Error('不能挂载已经释放的编辑会话');
    return createSlideEditor(container, this, options);
  }

  mountSelectionPane(
    container: HTMLElement,
    options: SelectionPaneOptions = {},
  ): SelectionPane {
    if (this.isDisposed) throw new Error('不能挂载已经释放的编辑会话');
    return createSelectionPane(container, this, options);
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.recovery?.dispose();
    this.textSearch.dispose();
    this.formatPainter.dispose();
    const state = sessionState(this);
    for (const view of [...state.views]) view.destroy();
    for (const pane of [...state.panes]) pane.destroy();
    this.editor.dispose();
    disposeDoc(this.editor.doc);
    releaseSession(this);
  }
}

function recoveryCandidate(journal: RecoveryStoreJournal): RecoveryCandidate {
  const latest = journal.frames[journal.frames.length - 1];
  return Object.freeze({
    fingerprint: journal.source.fingerprint,
    sourceByteLength: journal.source.byteLength,
    idPrefix: journal.idPrefix,
    frameCount: journal.frames.length,
    estimatedBytes: journal.estimatedBytes,
    createdAt: journal.createdAt,
    updatedAt: journal.updatedAt,
    dirty: true as const,
    latestLabel: latest.label,
  });
}

function assertJournal(
  journal: RecoveryStoreJournal,
  fingerprint: string,
  byteLength: number,
): void {
  const latest = journal?.frames?.[journal.frames.length - 1];
  if (!journal || journal.version !== 1 || !journal.source
    || journal.source.fingerprint !== fingerprint || journal.source.byteLength !== byteLength
    || typeof journal.idPrefix !== 'string'
    || typeof journal.epoch !== 'string' || !journal.epoch || !Array.isArray(journal.frames)
    || !Number.isFinite(journal.createdAt) || !Number.isFinite(journal.updatedAt)
    || journal.createdAt > journal.updatedAt
    || !Number.isFinite(journal.estimatedBytes) || journal.estimatedBytes < 0
    || (latest && (typeof latest.dirty !== 'boolean' || typeof latest.label !== 'string'))) {
    throw new Error('恢复存储返回了无效日志');
  }
}

export async function openEditor(
  input: File | Blob | ArrayBuffer | Uint8Array,
  options: OpenEditorOptions = {},
): Promise<EditorSession> {
  if (options.recovery && options.recoveryFrames) {
    throw new Error('recovery 与 recoveryFrames 不能同时使用');
  }
  let parseInput: File | Blob | ArrayBuffer | Uint8Array = input;
  let recovered: RecoveryStoreJournal | null = null;
  let sourceIdentity: Awaited<ReturnType<typeof fingerprintSourceBytes>> | null = null;
  let idPrefix = options.idPrefix;
  let recoveryEpoch: string | null = null;
  if (options.recovery) {
    const signal = options.recovery.signal;
    throwIfAborted(signal);
    const bytes = await sourceBytes(input);
    throwIfAborted(signal);
    parseInput = bytes;
    sourceIdentity = await fingerprintSourceBytes(bytes);
    throwIfAborted(signal);
    recovered = await options.recovery.store.load(sourceIdentity);
    throwIfAborted(signal);
    if (recovered) {
      assertJournal(recovered, sourceIdentity.fingerprint, sourceIdentity.byteLength);
      const latest = recovered.frames[recovered.frames.length - 1];
      if (!latest || !latest.dirty) {
        recovered = null;
      } else {
        const candidate = recoveryCandidate(recovered);
        const decide = options.recovery.decide;
        if (!decide) throw new Error('发现恢复日志，但没有提供恢复决策函数');
        const decision = await waitForDecision(
          Promise.resolve().then(() => decide(candidate)), signal,
        );
        if (decision === 'cancel') throw new RecoveryOpenCancelledError(candidate);
        if (decision === 'discard') {
          recovered = null;
        } else if (decision === 'restore') {
          idPrefix = recovered.idPrefix;
          recoveryEpoch = recovered.epoch;
        } else {
          throw new Error(`未知恢复决策：${String(decision)}`);
        }
      }
    }
    if (!recovered) {
      const token = recoveryToken();
      idPrefix = options.idPrefix ?? `d${token}-`;
      recoveryEpoch = `e${token}`;
      // 先原子占位再解析；旧页面的迟到追加只能命中代际冲突，不能复活已丢弃日志。
      throwIfAborted(signal);
      await options.recovery.store.reset({
        source: sourceIdentity, idPrefix, epoch: recoveryEpoch, signal,
      });
      throwIfAborted(signal);
    }
  }
  const presentation = await parse(parseInput, {
    edit: true,
    keepPackage: true,
    lazy: false,
    ...(options.password === undefined ? {} : { password: options.password }),
  });
  const recoverySignal = options.recovery?.signal;
  if (recoverySignal?.aborted) {
    presentation.dispose?.();
    throw abortReason(recoverySignal);
  }
  try {
    const doc = createDoc(presentation, { idPrefix });
    const editor = new Editor(doc, {
      origin: options.origin,
      historyLimit: options.historyLimit,
      historyByteLimit: options.historyByteLimit,
      recoveryFrames: recovered?.frames ?? options.recoveryFrames,
    });
    const recovery = options.recovery && sourceIdentity
      ? new RecoverySessionController(
        editor, sourceIdentity, options.recovery, recoveryEpoch as string,
      ) : null;
    return new BrowserEditorSession(editor, presentation, recovery);
  } catch (error) {
    presentation.dispose?.();
    throw error;
  }
}
