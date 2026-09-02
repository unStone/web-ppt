import type { EditorSession } from '@web-ppt/editor';

type NoticeTone = 'normal' | 'success' | 'error';

interface EditorFileActionsOptions {
  readonly notice: (message: string, tone?: NoticeTone) => void;
  readonly onError: (error: unknown) => void;
  readonly onBusyChange: () => void;
}

export interface EditorFileActions {
  readonly busy: boolean;
  saveCopy(session: EditorSession, name: string): Promise<void>;
  exportImages(session: EditorSession, name: string): Promise<void>;
}

/** 本地选择与拖放共用同一入口，避免两套替换/忙碌判断逐渐分叉。 */
export function bindEditorFileOpen(
  input: HTMLInputElement,
  dropLayer: HTMLElement,
  open: (file: File | undefined) => void,
): void {
  input.addEventListener('change', () => {
    open(input.files?.[0]);
    input.value = '';
  });
  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dragDepth++;
    dropLayer.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; dropLayer.hidden = true; }
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropLayer.hidden = true;
    open(event.dataTransfer?.files[0]);
  });
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 文件任务持有入口快照；异步期间不能改用后来打开的会话或文件名。 */
export function createEditorFileActions(options: EditorFileActionsOptions): EditorFileActions {
  let busy = false;
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    options.onBusyChange();
    try {
      await action();
    } catch (error) {
      options.onError(error);
    } finally {
      busy = false;
      options.onBusyChange();
    }
  };

  return {
    get busy() { return busy; },
    saveCopy(session, name) {
      return run(async () => {
        options.notice('正在生成 PPTX 副本…');
        const bytes = await session.editor.save();
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        download(new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        }), name);
        options.notice('已生成可继续编辑的 PPTX 副本', 'success');
      });
    },
    exportImages(session, name) {
      return run(async () => {
        // 投影必须在首次 await 前固定；文档切换由 busy 隔离，避免释放其中的资源句柄。
        const presentation = session.toPresentation();
        options.notice('正在导出当前文稿的图片 ZIP…');
        // 图片导出是可选大能力；只有用户点击时才进入官网编辑器分块。
        const { presentationToImageZip } = await import('@web-ppt/core/image-zip');
        const blob = await presentationToImageZip(presentation, {
          onProgress: ({ completed, total }) => options.notice(`正在导出图片 ${completed} / ${total}…`),
        });
        const stem = name.replace(/\.pptx$/i, '');
        download(blob, `${stem}-images.zip`);
        options.notice('已导出当前编辑态的图片 ZIP', 'success');
      });
    },
  };
}
