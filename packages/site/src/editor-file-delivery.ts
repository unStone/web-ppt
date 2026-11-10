import type { Presentation } from '@web-ppt/core';
import type { EditorSession } from '@web-ppt/editor';
import { prepareFileSave, writeLocalFile } from './editor-file-save';
import { download } from './download';
import { message, type SiteNotice } from './i18n/message';

export async function saveDocumentLocal(
  session: EditorSession,
  handle: FileSystemFileHandle,
  notice: SiteNotice,
  onWritten: () => void,
  onSaved: (session: EditorSession) => void,
): Promise<void> {
  const prepared = await prepareFileSave(session);
  try {
    if (prepared.changed) {
      notice(message('文稿在生成期间已变化，请重新保存'), 'error');
      return;
    }
    await writeLocalFile(handle, prepared.bytes);
    onWritten();
    notice(message(prepared.confirm() ? '已保存到 {name}' : '已写入 {name}；请再次保存最新编辑', { name: handle.name }), 'success');
    onSaved(session);
  } finally {
    prepared.release();
  }
}

/** 交付模块只在任务已被文件服务接管后加载，忙碌状态与会话仍由服务持有。 */
export async function saveDocumentCopy(
  session: EditorSession,
  name: string,
  notice: SiteNotice,
  onSaved: (session: EditorSession) => void,
): Promise<void> {
  const prepared = await prepareFileSave(session);
  try {
    if (prepared.changed) {
      notice(message('文稿在生成期间已变化，请重新保存'), 'error');
      return;
    }
    download(
      new Blob([new Uint8Array(prepared.bytes)], {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
      name,
    );
    prepared.confirm();
    notice(message('已生成可继续编辑的 PPTX 副本'), 'success');
    onSaved(session);
  } finally {
    prepared.release();
  }
}

export async function exportDocumentImages(
  presentation: Presentation,
  name: string,
  showComments: boolean,
  notice: SiteNotice,
): Promise<void> {
  const { presentationToImageZip } = await import('@web-ppt/core/image-zip');
  const blob = await presentationToImageZip(presentation, {
    showComments,
    onProgress: ({ completed, total }) => notice(message('正在导出图片 {completed} / {total}…', { completed, total })),
  });
  const stem = name.replace(/\.pptx$/i, '');
  download(blob, `${stem}-images.zip`);
  notice(message('已导出当前编辑态的图片 ZIP'), 'success');
}
