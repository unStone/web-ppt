import {
  createIndexedDbRecoveryStore,
  type EditorSession,
  type OpenEditorOptions,
  type RecoveryCandidate,
  type RecoveryDecision,
  type RecoveryStoreJournal,
} from '@web-ppt/editor';
import { message, type SiteNotice } from './i18n/message';
import { setText } from './i18n/runtime';
import { moveLanguageControl } from './i18n/controls';

export interface SiteRecovery {
  openOptions(signal: AbortSignal): Pick<OpenEditorOptions, 'recovery'>;
  cancelPending(): void;
  flush(session: EditorSession | null): Promise<void>;
  sync(session: EditorSession | null): void;
  dispose(): Promise<void>;
}

const PREFERENCE = 'web-ppt:site:recovery-enabled';

function needsMedia(journal: RecoveryStoreJournal | null): boolean {
  return journal?.frames.some((frame) => frame.patches.some((patch) => {
    if (patch.op === 'insert' || patch.op === 'remove') {
      return 'records' in patch.value && Object.values(patch.value.records).some((record) =>
        record.src.kind === 'image' && !!record.src.media);
    }
    const value = 'value' in patch ? patch.value : null;
    return patch.path[0] === 'imageResources' && !!value && typeof value === 'object'
      && 'mime' in value && typeof value.mime === 'string' && /^(audio|video)\//.test(value.mime);
  })) ?? false;
}

export function createSiteRecovery(notice: SiteNotice): SiteRecovery {
  const store = createIndexedDbRecoveryStore({
    databaseName: 'web-ppt-site-editor', namespace: 'site-editor', maxJournals: 8,
  });
  const events = new AbortController();
  let disposed = false;
  let closing: Promise<void> | undefined;
  const toggle = document.querySelector<HTMLInputElement>('#recoveryToggle')!;
  const prompt = document.querySelector<HTMLElement>('#recoveryPrompt')!;
  const summary = document.querySelector<HTMLElement>('#recoverySummary')!;
  const restore = document.querySelector<HTMLButtonElement>('#restoreRecovery')!;
  const discard = document.querySelector<HTMLButtonElement>('#discardRecovery')!;
  const state = document.querySelector<HTMLElement>('#recoveryState')!;
  let enabled = localStorage.getItem(PREFERENCE) !== 'false';
  let decide: ((decision: RecoveryDecision) => void) | null = null;
  let syncedSession: EditorSession | null = null;
  let flushGeneration = 0;
  let restoreLanguageControl: (() => void) | undefined;

  const choose = (decision: RecoveryDecision): void => {
    prompt.hidden = true;
    restoreLanguageControl?.();
    restoreLanguageControl = undefined;
    const resolve = decide;
    decide = null;
    resolve?.(decision);
  };
  restore.addEventListener('click', () => choose('restore'), { signal: events.signal });
  discard.addEventListener('click', () => choose('discard'), { signal: events.signal });
  toggle.addEventListener('change', () => {
    enabled = toggle.checked;
    localStorage.setItem(PREFERENCE, String(enabled));
    notice(message(enabled
      ? '本机恢复将在下次打开文稿时启用'
      : '本机恢复将在下次打开文稿时停用；已有记录不会被远程上传'));
  }, { signal: events.signal });

  const decision = (candidate: RecoveryCandidate): Promise<RecoveryDecision> => {
    if (disposed) return Promise.resolve('cancel');
    // 新打开已取代旧打开时，必须释放旧 Promise；否则过期解析会永远占着一条任务链。
    if (decide) choose('cancel');
    prompt.hidden = false;
    restoreLanguageControl = moveLanguageControl(prompt.querySelector('span')!);
    setText(summary, '记录于 {updated} 更新，共 {count} 步；最近操作：{label}。', {
      updated: new Date(candidate.updatedAt), count: candidate.frameCount, label: candidate.latestLabel,
    });
    return new Promise((resolve) => { decide = resolve; });
  };

  return {
    openOptions: (signal) => {
      if (disposed) throw new Error('恢复服务已释放');
      if (!enabled) return {};
      let mediaRequired = false;
      return { recovery: {
        signal,
        store: {
          async load(source) {
            const journal = await store.load(source);
            mediaRequired = needsMedia(journal);
            return journal;
          },
          reset: (request) => store.reset(request),
          append: (request) => store.append(request),
          remove: (source) => store.remove(source),
        },
        decide: async (candidate) => {
          const choice = await decision(candidate);
          if (choice === 'restore' && mediaRequired && !signal.aborted) {
            // 恢复校验发生在 Editor 构造中，不能等打开成功后再注册媒体资源类型。
            const { registerMediaEditing } = await import('@web-ppt/editor/media');
            if (!signal.aborted) registerMediaEditing();
          }
          return signal.aborted ? 'cancel' : choice;
        },
        onError: (error) => { if (!disposed) notice(message('本机恢复记录失败：{detail}', {
          detail: error instanceof Error ? error.message : String(error),
        }), 'error'); },
      } };
    },
    cancelPending() {
      if (decide) choose('cancel');
    },
    async flush(session) {
      // 偏好只影响下次打开；已有会话必须完成排队写入，才能关闭它使用的存储。
      if (disposed || !session?.recovery) return;
      const generation = ++flushGeneration;
      setText(state, '正在写入本机恢复记录…');
      try {
        await session.recovery.flush();
        if (generation === flushGeneration && session === syncedSession) {
          setText(state, '恢复记录已写入本机');
        }
      } catch (error) {
        if (generation === flushGeneration && session === syncedSession) {
          setText(state, '恢复记录写入失败');
          notice(message('本机恢复记录失败：{detail}', { detail: error instanceof Error ? error.message : String(error) }), 'error');
        }
      }
    },
    sync(session) {
      if (disposed) return;
      if (session !== syncedSession) {
        syncedSession = session;
        flushGeneration++;
      }
      toggle.checked = enabled;
      toggle.disabled = !session;
      if (!session) setText(state, '打开文稿后会在本机保存恢复记录');
    },
    dispose() {
      if (closing) return closing;
      disposed = true;
      events.abort();
      flushGeneration++;
      syncedSession = null;
      choose('cancel');
      return closing = store.close();
    },
  };
}
