import type {
  EditorPatchEvent, EditorPatchSubscriber, EditorPatchSubscribeOptions,
} from './commands/types';

export function reportEditorSubscriberError(error: unknown): void {
  try {
    const reporter = (globalThis as typeof globalThis & { reportError?: (reason: unknown) => void }).reportError;
    if (reporter) reporter(error);
    else console.error('Editor 订阅者执行失败', error);
  } catch { /* 监听器与错误上报都不能把已提交事务伪装成失败。 */ }
}

/** recovery 前只给协同元数据观察者；普通观察者继续在视图事件后按 FIFO 收到补丁。 */
export class EditorPatchJournal {
  private readonly subscribers = new Set<EditorPatchSubscriber>();
  private readonly beforeRecoverySubscribers = new Set<EditorPatchSubscriber>();
  private readonly pending: EditorPatchEvent[] = [];
  private dispatching = false;

  subscribe(subscriber: EditorPatchSubscriber, options: EditorPatchSubscribeOptions = {}): () => void {
    if (typeof subscriber !== 'function') throw new Error('Patch 订阅者必须是函数');
    if (options.phase !== undefined && options.phase !== 'before-recovery'
      && options.phase !== 'after-observers') throw new Error('Patch 订阅阶段无效');
    const target = options.phase === 'before-recovery'
      ? this.beforeRecoverySubscribers : this.subscribers;
    target.add(subscriber);
    return () => { target.delete(subscriber); };
  }

  queue(event: EditorPatchEvent): void {
    for (const subscriber of [...this.beforeRecoverySubscribers]) {
      try { subscriber(structuredClone(event)); } catch (error) { reportEditorSubscriberError(error); }
    }
    if (this.subscribers.size) this.pending.push(event);
  }

  flush(): void {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      while (this.pending.length) {
        const pending = this.pending.shift()!;
        for (const subscriber of [...this.subscribers]) {
          try { subscriber(structuredClone(pending)); } catch (error) {
            reportEditorSubscriberError(error);
          }
        }
      }
    } finally {
      this.dispatching = false;
    }
  }
}
