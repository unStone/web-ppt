import { download } from './download';
import type { EditorSession } from '@web-ppt/editor';
import { message, type SiteNotice } from './i18n/message';
import type {DocumentFontService} from './editor-document-fonts';

interface EditorFileActionsOptions {
  readonly notice: SiteNotice;
  readonly onBusyChange: () => void;
  readonly onSaved: (session: EditorSession) => void;
}

export interface EditorFileActions {
  bindDocument(session: EditorSession, fonts: DocumentFontService): () => void;
  readonly busy: boolean;
  readonly localAvailable: boolean;
  localTarget(session: EditorSession | null): string | undefined;
  saveLocal(session: EditorSession, name: string, chooseAgain?: boolean): Promise<void>;
  saveCopy(session: EditorSession, name: string): Promise<void>;
  exportDocument(session: EditorSession, name: string, showComments?: boolean): Promise<void>;
  exportImages(session: EditorSession, name: string, showComments?: boolean): Promise<void>;
  whenIdle(): Promise<void>;
  pause(): () => void;
  dispose(): Promise<void>;
}

type WritableHandle = FileSystemFileHandle & {
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
};
type PickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { accept: Record<string, string[]> }[];
    excludeAcceptAllOption: boolean;
  }) => Promise<WritableHandle>;
};
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** 本地选择与拖放共用同一入口，避免两套替换/忙碌判断逐渐分叉。 */
export function bindEditorFileOpen(
  input: HTMLInputElement,
  dropLayer: HTMLElement,
  open: (file: File | undefined) => void,
  signal: AbortSignal,
): void {
  input.addEventListener('change', () => {
    open(input.files?.[0]);
    input.value = '';
  }, { signal });
  let dragDepth = 0;
  signal.addEventListener('abort', () => { dropLayer.hidden = true; }, { once: true });
  const inDialog = (event: DragEvent): boolean => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('dialog[open]')) return false;
    dragDepth = 0;
    dropLayer.hidden = true;
    // 模态工具中的文件属于该工具；文件输入仍保留浏览器原生拖放默认行为。
    if (!(target instanceof HTMLInputElement && target.type === 'file')) event.preventDefault();
    return true;
  };
  window.addEventListener('dragenter', (event) => {
    if (inDialog(event)) return;
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dragDepth++;
    dropLayer.hidden = false;
  }, { signal });
  window.addEventListener('dragover', (event) => {
    if (inDialog(event)) return;
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  }, { signal });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; dropLayer.hidden = true; }
  }, { signal });
  window.addEventListener('drop', (event) => {
    if (inDialog(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropLayer.hidden = true;
    open(event.dataTransfer?.files[0]);
  }, { signal });
}


/** 文件任务持有入口快照；异步期间不能改用后来打开的会话或文件名。 */
export function createEditorFileActions(options: EditorFileActionsOptions): EditorFileActions {
  let busy = false;
  let disposed = false;
  let pauses = 0;
  let pending = Promise.resolve();
  const exportLifetime = new AbortController();
  const notice: SiteNotice = (...args) => { if (!disposed) options.notice(...args); };
  let targets = new WeakMap<EditorSession, WritableHandle>();
  let documentFonts = new WeakMap<EditorSession, DocumentFontService>();
  const localAvailable = (): boolean => isSecureContext && typeof (window as PickerWindow).showSaveFilePicker === 'function';
  const run = (failure: '保存失败：{detail}' | '导出失败：{detail}', action: () => Promise<void>): Promise<void> => {
    if (busy || disposed || pauses) return Promise.resolve();
    busy = true;
    // 先公布任务，再调用宿主回调；回调中触发卸载时也必须等到本次交付结束。
    let resolve!: () => void, reject!: (error: unknown) => void;
    const completion = pending = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    void (async () => {
      try {
        options.onBusyChange();
        await action();
      } catch (error) {
        notice(message(failure, { detail: error instanceof Error ? error.message : String(error) }), 'error');
      } finally {
        busy = false;
        if (!disposed) options.onBusyChange();
      }
    })().then(resolve, reject);
    return completion;
  };

  return {
    bindDocument(session,fonts) {
      if (disposed) return () => {};
      documentFonts.set(session,fonts);
      return () => { if (documentFonts.get(session) === fonts) documentFonts.delete(session); };
    },
    get busy() { return busy; },
    get localAvailable() { return localAvailable(); },
    whenIdle() { return pending; },
    pause() {
      // 文稿切换只阻止新文件任务；不能伪装为正在保存，否则新的打开意图会被宿主丢弃。
      pauses++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        pauses--;
      };
    },
    dispose() {
      disposed = true;
      // 已提交的保存和导出继续交付；关闭尚未提交的模态选择，避免悬挂退出。
      exportLifetime.abort();
      targets = new WeakMap();
      documentFonts = new WeakMap();
      return pending;
    },
    localTarget(session) { return session ? targets.get(session)?.name : undefined; },
    saveLocal(session, name, chooseAgain = false) {
      return run('保存失败：{detail}', async () => {
        let handle = chooseAgain ? undefined : targets.get(session);
        if (!handle) {
          notice(message('请选择本机保存位置…'));
          try {
            // 权限选择必须先于动态加载和序列化，否则长任务会耗尽用户激活。
            handle = await (window as PickerWindow).showSaveFilePicker!({
              suggestedName: name, types: [{ accept: { [PPTX_MIME]: ['.pptx'] } }], excludeAcceptAllOption: true,
            });
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              notice(message('已取消保存，文稿未改变')); return;
            }
            throw error;
          }
        } else if (handle.requestPermission && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
          notice(message('未获准写入文件；可重试或下载保存副本'), 'error'); return;
        }
        if (!/\.pptx$/i.test(handle.name)) {
          notice(message('请选择 .pptx 文件；未写入任何内容'), 'error'); return;
        }
        notice(message('正在写入 {name}…', { name: handle.name }));
        const { prepareFileSave, writeLocalFile } = await import('./editor-file-save');
        const prepared = await prepareFileSave(session);
        try {
          if (prepared.changed) {
            notice(message('文稿在生成期间已变化，请重新保存'), 'error'); return;
          }
          await writeLocalFile(handle, prepared.bytes);
          if (!disposed) targets.set(session, handle);
          notice(message(prepared.confirm() ? '已保存到 {name}' : '已写入 {name}；请再次保存最新编辑', { name: handle.name }), 'success');
          options.onSaved(session);
        } finally { prepared.release(); }
      });
    },
    saveCopy(session, name) {
      return run('保存失败：{detail}', async () => {
        notice(message('正在生成 PPTX 副本…'));
        const { prepareFileSave } = await import('./editor-file-save');
        const prepared = await prepareFileSave(session);
        try {
          if (prepared.changed) {
            notice(message('文稿在生成期间已变化，请重新保存'), 'error'); return;
          }
          download(new Blob([new Uint8Array(prepared.bytes)], { type: PPTX_MIME }), name);
          prepared.confirm();
          notice(message('已生成可继续编辑的 PPTX 副本'), 'success');
          options.onSaved(session);
        } finally { prepared.release(); }
      });
    },
    exportDocument(session, name, showComments = false) {
      return run('导出失败：{detail}', async () => {
        const presentation = session.toPresentation();
        const fonts = documentFonts.get(session);
        const { showDocumentExport } = await import('./editor-export-tools');
        await showDocumentExport(presentation, name, showComments, async () => {
          const { savePpt } = await import('@web-ppt/edit-core/ppt');
          return savePpt(session.editor.doc);
        }, exportLifetime.signal,fonts);
      });
    },
    exportImages(session, name, showComments = false) {
      return run('导出失败：{detail}', async () => {
        // 投影必须在首次 await 前固定；文档切换由 busy 隔离，避免释放其中的资源句柄。
        const presentation = session.toPresentation();
        notice(message('正在导出当前文稿的图片 ZIP…'));
        // 图片导出是可选大能力；只有用户点击时才进入官网编辑器分块。
        const { presentationToImageZip } = await import('@web-ppt/core/image-zip');
        const blob = await presentationToImageZip(presentation, {
          showComments,
          onProgress: ({ completed, total }) => notice(message('正在导出图片 {completed} / {total}…', { completed, total })),
        });
        const stem = name.replace(/\.pptx$/i, '');
        download(blob, `${stem}-images.zip`);
        notice(message('已导出当前编辑态的图片 ZIP'), 'success');
      });
    },
  };
}
