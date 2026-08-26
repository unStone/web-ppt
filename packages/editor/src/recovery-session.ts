import type { Editor, RecoveryFrame } from '@web-ppt/edit-core';
import type { EditorRecovery, RecoveryOptions } from './recovery-store';
import type { WebPptSourceIdentity } from './source-fingerprint';

function notifyError(options: RecoveryOptions, error: unknown): void {
  try { options.onError?.(error); } catch { /* 恢复错误观察者不能破坏编辑会话。 */ }
}

/** 编辑提交只入内存队列；IndexedDB 等慢存储始终在 microtask 后串行执行。 */
export class RecoverySessionController implements EditorRecovery {
  readonly source: WebPptSourceIdentity;
  private readonly options: RecoveryOptions;
  private readonly idPrefix: string;
  private readonly epoch: string;
  private readonly unsubscribe: () => void;
  private queued: RecoveryFrame[] = [];
  private tail: Promise<void> = Promise.resolve();
  private scheduled = false;
  private failure: unknown | null = null;
  private stopped = false;
  private pendingFrames = 0;

  constructor(
    editor: Editor,
    source: WebPptSourceIdentity,
    options: RecoveryOptions,
    epoch: string,
  ) {
    this.source = source;
    this.options = options;
    this.idPrefix = editor.doc.identity.prefix;
    this.epoch = epoch;
    this.unsubscribe = editor.subscribeRecovery((frame) => this.enqueue(frame));
  }

  get pending(): number { return this.pendingFrames; }
  get error(): unknown | null { return this.failure; }

  async flush(): Promise<void> {
    this.drain();
    await this.tail;
    if (this.failure) throw this.failure;
  }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe();
    this.drain();
  }

  private enqueue(frame: RecoveryFrame): void {
    if (this.stopped || this.failure) return;
    this.queued.push(frame);
    this.pendingFrames++;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.drain());
  }

  private drain(): void {
    this.scheduled = false;
    if (!this.queued.length || this.failure) return;
    const frames = this.queued.splice(0, this.queued.length);
    this.tail = this.tail.then(async () => {
      if (!this.failure) await this.options.store.append({
        source: this.source,
        idPrefix: this.idPrefix,
        epoch: this.epoch,
        frames,
      });
    }).catch((error: unknown) => {
      if (!this.failure) {
        this.failure = error;
        notifyError(this.options, error);
      }
    }).finally(() => { this.pendingFrames -= frames.length; });
  }
}
