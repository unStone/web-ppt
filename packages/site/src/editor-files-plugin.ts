import type { Context } from 'cordis';
import type { EditorSession } from '@web-ppt/editor';
import { createEditorFileActions, type EditorFileActions } from './editor-file-actions';
import type { SiteNotice } from './i18n/message';

export interface EditorFileHost {
  readonly buttons: Record<'save' | 'localSave' | 'saveAs' | 'exportDocument' | 'exportImages', HTMLButtonElement>;
  snapshot(): { session: EditorSession | null; name: string; writable: boolean; loading: boolean; showComments: boolean };
  sync(): void;
}

declare module 'cordis' {
  interface Context { editorFiles: EditorFileActions }
}

/** 保存句柄、异步任务与入口监听跨文稿存在，必须在应用卸载时一起释放。 */
export const editorFilesPlugin = {
  name: 'editor-files',
  inject: ['editorRecovery'],
  apply(ctx: Context, { notice, host }: { notice: SiteNotice; host?: EditorFileHost }) {
    ctx.effect(function* () {
      const files = createEditorFileActions({ notice, onBusyChange: () => host?.sync(),
        onSaved: session => { void ctx.editorRecovery.flush(session); } });
      yield () => files.dispose();
      yield ctx.provide('editorFiles', files);
      if (!host) return;
      const controller = new AbortController();
      yield () => controller.abort();
      const { signal } = controller;
      const save = (local: boolean, chooseAgain = false) => {
        const current = host.snapshot();
        if (!current.session || !current.writable || current.loading || files.busy) return;
        void (local ? files.saveLocal(current.session, current.name, chooseAgain)
          : files.saveCopy(current.session, current.name));
      };
      host.buttons.save.addEventListener('click', () => save(false), { signal });
      host.buttons.localSave.addEventListener('click', () => save(true), { signal });
      host.buttons.saveAs.addEventListener('click', () => save(true, true), { signal });
      for (const method of ['exportDocument', 'exportImages'] as const) {
        host.buttons[method].addEventListener('click', () => {
          const current = host.snapshot();
          if (current.session && !current.loading && !files.busy) {
            void files[method](current.session, current.name, current.showComments);
          }
        }, { signal });
      }
      window.addEventListener('keydown', event => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
        event.preventDefault();
        // 直接进入文件服务，不能先 await 插件加载，否则选择器会丢失本次用户激活。
        if (!event.repeat && !event.isComposing) save(files.localAvailable, event.shiftKey);
      }, { signal });
      window.addEventListener('beforeunload', event => {
        if (!host.snapshot().session?.editor.isDirty()) return;
        event.preventDefault();
        event.returnValue = '';
      }, { signal });
    });
  },
};
