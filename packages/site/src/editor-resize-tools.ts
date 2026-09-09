import { createSlideSizeEditor } from '@web-ppt/edit-core/resize';
import { MAX_SLIDE_SIZE, MIN_SLIDE_SIZE } from '@web-ppt/edit-core';
import type { EditorSession } from '@web-ppt/editor';
import { setText } from './i18n/runtime';
import { moveLanguageControl } from './i18n/controls';

export function showSlideSizeTools(session: EditorSession, current: () => EditorSession | null): () => void {
  const dialog = document.createElement('dialog'); dialog.id = 'slideSizeDialog';
  dialog.setAttribute('aria-labelledby', 'slideSizeTitle');
  dialog.innerHTML = `<style>#slideSizeDialog{width:min(400px,calc(100vw - 48px));border:1px solid #ddd;border-radius:12px;padding:24px}
#slideSizeDialog::backdrop{background:#11182770}#slideSizeDialog label{display:flex;justify-content:space-between;gap:16px;margin:16px 0}
#slideSizeDialog input[type=number]{width:120px}#slideSizeDialog footer{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}</style>
<header><h2 id="slideSizeTitle"></h2></header><form><label><span data-width></span><input name="width" type="number" required step="any"></label>
<label><span data-height></span><input name="height" type="number" required step="any"></label>
<label><span data-fit></span><input name="fit" type="checkbox" checked></label><p data-help></p><p role="alert"></p>
<footer><button type="button" data-cancel></button><button type="submit" data-apply></button></footer></form>`;
  for (const [selector, label] of [
    ['h2', '页面尺寸'], ['[data-width]', '宽度（像素）'], ['[data-height]', '高度（像素）'],
    ['[data-fit]', '确保适合：等比缩放内容'], ['[data-help]', '对所有页面生效；关闭等比缩放时只改变画布。'],
    ['[data-cancel]', '取消'], ['[data-apply]', '应用'],
  ] as const) setText(dialog.querySelector(selector)!, label);
  const width = dialog.querySelector<HTMLInputElement>('[name=width]')!;
  const height = dialog.querySelector<HTMLInputElement>('[name=height]')!;
  const fit = dialog.querySelector<HTMLInputElement>('[name=fit]')!;
  width.value = String(session.editor.doc.meta.width); height.value = String(session.editor.doc.meta.height);
  for (const input of [width, height]) { input.min = String(MIN_SLIDE_SIZE); input.max = String(MAX_SLIDE_SIZE); }
  dialog.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick = () => dialog.close();
  dialog.querySelector('form')!.onsubmit = (event) => {
    event.preventDefault();
    if (!dialog.isConnected || current() !== session) { dialog.close(); return; }
    try {
      createSlideSizeEditor(session.editor).setSize({ w: width.valueAsNumber, h: height.valueAsNumber,
        fit: fit.checked ? 'ensureFit' : 'none' });
      dialog.close();
    } catch (error) {
      setText(dialog.querySelector('[role=alert]')!, '页面尺寸修改失败：{detail}', {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
  document.body.append(dialog);
  const restoreLanguage = moveLanguageControl(dialog.querySelector('header')!);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    restoreLanguage();
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('close', dispose, { once: true });
  dialog.showModal();
  // close 事件由浏览器排入任务队列；换文稿时必须同步释放节点与挪入弹窗的语言控件。
  return dispose;
}
