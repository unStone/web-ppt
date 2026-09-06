import type { Presentation, Slide } from '@web-ppt/core';
import type { CommentsPanel } from '@web-ppt/viewer-core/comments';
import { setText } from './i18n/runtime';
import { download } from './download';

interface CommentContext {
  owner: object;
  slide: Slide;
  presentation(): Presentation;
  name: string;
}

export function bindCommentsTools(button: HTMLButtonElement, current: () => CommentContext | null) {
  let panel: CommentsPanel | undefined, host: HTMLElement | undefined;
  let owner: object | undefined, rendered: Slide['comments'];
  let include = false, generation = 0;
  const reset = () => {
    generation++; panel?.dispose(); host?.remove(); panel = undefined; host = undefined;
    owner = undefined; rendered = undefined; include = false;
    button.setAttribute('aria-expanded', 'false');
  };
  const sync = () => {
    const context = current();
    button.disabled = !context;
    if (owner && owner !== context?.owner) reset();
    if (panel && context && rendered !== context.slide.comments) {
      panel.setSlide(context.slide); rendered = context.slide.comments;
    }
  };
  const open = async () => {
    if (host) { reset(); return; }
    const context = current();
    if (!context) return;
    owner = context.owner;
    const attempt = ++generation;
    button.disabled = true;
    try {
      const { createCommentsPanel } = await import('@web-ppt/viewer-core/comments');
      if (attempt !== generation || current()?.owner !== context.owner) return;
      host = document.createElement('aside'); host.id = 'commentsPanel';
      host.setAttribute('aria-labelledby', 'commentsTitle');
      host.innerHTML = `<style>#commentsPanel{position:fixed;right:16px;top:108px;width:min(370px,calc(100vw - 64px));max-height:calc(100vh - 155px);overflow:auto;z-index:1000;background:var(--card,#fff);color:var(--ink,#17202a);border:1px solid #ddd;border-radius:12px;padding:18px;box-shadow:0 8px 30px #0002}#commentsPanel header,#commentsPanel footer{display:flex;gap:8px;flex-wrap:wrap;align-items:center}#commentsPanel h2{flex:1;margin:0;font-size:18px}#commentsPanel footer{margin-top:14px}#commentsPanel [role=status]{font-size:13px}</style>
<header><h2 id="commentsTitle"></h2><button type="button" data-close></button></header><div data-content></div>
<label><input type="checkbox" data-include-comments><span></span></label><footer></footer><p role="status"></p>`;
      setText(host.querySelector('h2')!, '批注'); setText(host.querySelector('[data-close]')!, '关闭');
      setText(host.querySelector('label span')!, '导出包含批注');
      host.querySelector<HTMLButtonElement>('[data-close]')!.onclick = reset;
      host.querySelector<HTMLInputElement>('[data-include-comments]')!.onchange = (event) => {
        include = (event.target as HTMLInputElement).checked;
      };
      document.body.append(host);
      panel = createCommentsPanel(host.querySelector('[data-content]')!);
      setText(host.querySelector('[data-comments-empty]')!, '本页没有批注');
      panel.setSlide(current()!.slide); rendered = current()!.slide.comments;
      const status = host.querySelector<HTMLElement>('[role=status]')!;
      let busy = false;
      for (const [format, label] of [['png', '导出 PNG'], ['svg', '导出 SVG'], ['zip', '导出图片 ZIP'], ['print', '打印及批注正文']] as const) {
        const action = document.createElement('button'); action.type = 'button'; action.dataset.commentExport = format;
        setText(action, label); host.querySelector('footer')!.append(action);
        action.onclick = () => { void (async () => {
          const source = current();
          if (busy || !source) return;
          busy = true;
          const options = { showComments: include }, target = host;
          try {
            setText(status, '正在导出…');
            const core = await import('@web-ppt/core');
            if (current()?.owner !== source.owner || host !== target) return;
            const presentation = source.presentation(), stem = source.name.replace(/\.pptx?$/i, '');
            const blob = format === 'png' ? await core.slideToPng(presentation, source.slide, 2, options)
              : format === 'svg' ? new Blob([await core.slideToSvgFile(presentation, source.slide, undefined, options)], { type: 'image/svg+xml' })
              : format === 'print' ? new Blob([await core.presentationToPrintableHtml(presentation, options)], { type: 'text/html' })
              : await (await import('@web-ppt/core/image-zip')).presentationToImageZip(presentation, options);
            if (current()?.owner !== source.owner || host !== target) return;
            download(blob, `${stem}${format === 'print' ? '-print.html' : '.' + format}`);
            setText(status, '导出完成');
          } catch (error) {
            if (host === target) setText(status, '导出失败：{detail}', { detail: error instanceof Error ? error.message : String(error) });
          } finally { busy = false; }
        })(); };
      }
      button.setAttribute('aria-expanded', 'true');
    } catch (error) {
      // 临时加载失败可重试；不阻断文稿打开，也不留下不可关闭的面板。
      reset(); button.title = error instanceof Error ? error.message : String(error);
    } finally { sync(); }
  };
  button.addEventListener('click', () => { void open(); });
  button.setAttribute('aria-expanded', 'false');
  return { sync, reset, get showComments() { return include; } };
}
