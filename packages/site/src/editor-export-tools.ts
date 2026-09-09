import type { Presentation } from '@web-ppt/core';
import { download } from './download';
import { setText,setMessage } from './i18n/runtime';
import { moveLanguageControl } from './i18n/controls';
import type {SiteMessage} from './i18n/message';
import type {DocumentFontService} from './editor-document-fonts';

/** 模态窗口持有固定投影；取消只终止导出，不修改编辑历史。 */
export function showDocumentExport(presentation: Presentation, name: string, comments: boolean,
  nativePpt: () => Promise<Uint8Array>, lifetime?: AbortSignal, fonts?: DocumentFontService): Promise<void> {
  if (lifetime?.aborted) return Promise.resolve();
  const dialog = document.createElement('dialog'); dialog.id = 'documentExportDialog';
  dialog.setAttribute('aria-labelledby', 'documentExportTitle');
  dialog.innerHTML = `<style>#documentExportDialog{width:min(420px,calc(100vw - 48px));border:1px solid #ddd;border-radius:12px;padding:24px}#documentExportDialog::backdrop{background:#11182770}#documentExportDialog [hidden]{display:none}#documentExportDialog input[type=number]{width:90px}#documentExportDialog label{display:flex;justify-content:space-between;gap:16px;margin:16px 0}#documentExportDialog footer{display:flex;justify-content:flex-end;gap:8px}#documentExportDialog [role=status]{min-height:2em}</style>
<header><h2 id="documentExportTitle"></h2></header><form><label><span data-format></span><select name="format"><option value="pdf"></option><option value="vector"></option><option value="video">WebM</option><option value="ppt">PPT</option></select></label>
<label data-resolution><span data-scale></span><select name="scale"><option value="1">1×</option><option value="2" selected>2×</option><option value="3">3×</option></select></label>
<label><span data-hidden></span><input name="skipHidden" type="checkbox" checked></label>
<label data-pdf><span data-steps></span><input name="animationSteps" type="checkbox"></label>
<label><span data-comments></span><input name="showComments" type="checkbox"></label>
<label data-video hidden><span data-fps></span><select name="fps"><option>12</option><option selected>24</option><option>30</option><option>60</option></select></label>
<label data-video hidden><span data-duration></span><input name="duration" type="number" min="0.1" max="3600" step="0.1" value="3"></label>
<label data-video hidden><span data-click-delay></span><input name="clickDelay" type="number" min="0" max="60" step="0.1" value="0.7"></label>
<label data-video hidden><span data-animations></span><input name="animations" type="checkbox" checked></label>
<label data-video hidden><span data-posters></span><input name="mediaPosters" type="checkbox"></label>
<p data-help></p><p role="status" aria-live="polite"></p><ul data-export-issues hidden></ul><footer><button type="button" data-close></button><button type="submit" data-export></button></footer></form>`;
  for (const [selector, label] of [
    ['h2','导出文件'], ['[data-format]','文件格式'], ['[data-scale]','清晰度'], ['[data-hidden]','跳过隐藏页'],
    ['option[value=pdf]','PDF（图片页面）'], ['option[value=vector]','PDF（可搜索文字）'],
    ['[data-steps]','按动画点击批次展开页面'], ['[data-comments]','导出包含批注'],
    ['[data-help]','PDF 使用图片页面保留外观，文字不可选中；勾选批注后同时写入原生 PDF 批注。'],
    ['[data-fps]','帧率'], ['[data-duration]','每页停留（秒）'], ['[data-click-delay]','点击批次间隔（秒）'],
    ['[data-animations]','播放动画与切换'], ['[data-posters]','允许内嵌音视频使用静态封面'],
    ['[data-close]','关闭'], ['[data-export]','导出'],
  ] as const) setText(dialog.querySelector(selector)!, label);
  const form = dialog.querySelector('form')!, status = dialog.querySelector('[role=status]')!;
  const issues = dialog.querySelector<HTMLUListElement>('[data-export-issues]')!;
  const close = dialog.querySelector<HTMLButtonElement>('[data-close]')!;
  dialog.querySelector<HTMLInputElement>('[name=showComments]')!.checked = comments;
  const format = dialog.querySelector<HTMLSelectElement>('[name=format]')!;
  format.onchange = () => {
    const video = format.value==='video', ppt = format.value==='ppt', vector = format.value==='vector';
    for (const node of dialog.querySelectorAll<HTMLElement>('label:not(:first-child)')) node.hidden = ppt;
    for (const node of dialog.querySelectorAll<HTMLElement>('[data-video]')) node.hidden = !video;
    for (const node of dialog.querySelectorAll<HTMLElement>('[data-pdf]')) node.hidden = video || ppt;
    dialog.querySelector<HTMLElement>('[data-resolution]')!.hidden = vector || ppt;
    dialog.querySelector<HTMLSelectElement>('[name=scale]')!.value = video?'1':'2';
    issues.replaceChildren(); issues.hidden = true;
    setText(dialog.querySelector('[data-help]')!,ppt?'PPT 保留可编辑文字、形状、组合和 PNG/JPEG 图片；不支持的内容会阻止导出。原文件保持不变。':video?'WebM 保留动画与切换，无声音；内嵌音视频可选择使用静态封面。':vector?'普通文字可选择和搜索，普通图形保留矢量；特殊效果会转为局部图片并列出说明。需要可用的字体文件，可在“字体与缺字”中加载。':'PDF 使用图片页面保留外观，文字不可选中；勾选批注后同时写入原生 PDF 批注。');
  };
  let controller: AbortController | undefined;
  close.onclick = () => { if (controller) controller.abort(); else dialog.close(); };
  dialog.addEventListener('cancel', event => { if (controller) { event.preventDefault(); controller.abort(); } });
  form.onsubmit = event => {
    event.preventDefault(); if (controller) return;
    controller = new AbortController();
    const signal = controller.signal, data = new FormData(form);
    for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,[type=submit]')) control.disabled = true;
    setText(close,'取消'); setText(status,'正在导出…');
    issues.replaceChildren(); issues.hidden = true;
    void (async () => {
      let vectorFailure: ((error:unknown) => SiteMessage) | undefined;
      try {
        const video = data.get('format')==='video', ppt = data.get('format')==='ppt';
        const shared = { scale:Number(data.get('scale')),skipHidden:data.has('skipHidden'),showComments:data.has('showComments'),signal,
          onProgress: ({ completed,total }: { completed:number;total:number }) => setText(status,video?'正在编码视频帧 {completed} / {total}…':'正在导出页面 {completed} / {total}…',{completed,total}) };
        let blob: Blob;
        if (ppt) {
          blob = new Blob([new Uint8Array(await nativePpt())], {type:'application/vnd.ms-powerpoint'});
        } else if (video) {
          const { presentationToVideo } = await import('@web-ppt/viewer-core/video');
          blob = await presentationToVideo(presentation,{...shared,fps:Number(data.get('fps')),slideDurationMs:Number(data.get('duration'))*1000,clickDelayMs:Number(data.get('clickDelay'))*1000,
            animations:data.has('animations'),transitions:data.has('animations'),mediaPosters:data.has('mediaPosters')});
        } else if (data.get('format') === 'vector') {
          const {exportVectorPdf,vectorPdfFailure,vectorPdfNotices} = await import('./editor-vector-pdf');
          vectorFailure = error => vectorPdfFailure(presentation,error);
          const result = await exportVectorPdf(presentation,fonts,{...shared,animationSteps:data.has('animationSteps'),title:name});
          blob = result.blob;
          if (!signal.aborted) {
            for (const notice of vectorPdfNotices(presentation,result.issues)) {
              const item = document.createElement('li'); setMessage(item,notice); issues.append(item);
            }
            issues.hidden = !issues.children.length;
          }
        } else {
          const { presentationToPdf } = await import('@web-ppt/core/pdf');
          blob = await presentationToPdf(presentation,{...shared,animationSteps:data.has('animationSteps'),title:name});
        }
        if (signal.aborted) return;
        download(blob, name.replace(/\.(pptx|ppt)$/i,'') + (ppt?'.ppt':video?'.webm':'.pdf')); setText(status,ppt?'PPT 已导出':video?'视频已导出':'PDF 已导出');
      } catch (error) {
        if (signal.aborted) setText(status,'导出已取消');
        else if (vectorFailure) setMessage(status,vectorFailure(error));
        else if (data.get('format') === 'vector') setText(status,'矢量 PDF 导出未完成，请重试或改用图片 PDF');
        else setText(status,'导出失败：{detail}',{ detail: error instanceof Error ? error.message : String(error) });
      } finally {
        controller = undefined; setText(close,'关闭');
        for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,[type=submit]')) control.disabled = false;
        if (lifetime?.aborted) dialog.close();
      }
    })();
  };
  document.body.append(dialog); const restoreLanguage = moveLanguageControl(dialog.querySelector('header')!);
  dialog.showModal();
  const cancel = () => { if (!controller) dialog.close(); };
  lifetime?.addEventListener('abort', cancel, { once: true });
  return new Promise(resolve => dialog.addEventListener('close', () => {
    lifetime?.removeEventListener('abort', cancel);
    restoreLanguage(); dialog.remove(); resolve();
  }, { once: true }));
}
