import type { Viewer } from '@web-ppt/viewer-core';
import type { CommentsPanel } from '@web-ppt/viewer-core/comments';

export function bindCommentsTools(button: HTMLButtonElement, current: () => Viewer | null) {
  let panel: CommentsPanel | undefined, host: HTMLElement | undefined;
  let owner: Viewer | null = null, generation = 0, include = false;
  const reset = () => {
    generation++; panel?.dispose(); host?.remove(); panel = undefined; host = undefined;
    owner = null; include = false; button.setAttribute('aria-expanded', 'false');
  };
  const sync = () => {
    const viewer = current(); button.disabled = !viewer;
    if (owner && owner !== viewer) reset();
    panel?.setSlide(viewer?.slide ?? null);
  };
  button.onclick = () => { void (async () => {
    if (host) { reset(); return; }
    const viewer = current(); if (!viewer) return;
    const attempt = ++generation; owner = viewer;
    try {
      const { createCommentsPanel } = await import('@web-ppt/viewer-core/comments');
      if (attempt !== generation || current() !== viewer) return;
      host = document.createElement('aside'); host.id = 'commentsPanel';
      host.style.cssText = 'position:fixed;right:12px;top:65px;z-index:100;width:min(350px,80vw);max-height:75vh;overflow:auto;background:#fff;color:#17202a;padding:18px;border:1px solid #ccc;border-radius:10px';
      host.innerHTML = '<h2>批注</h2><button type="button" data-close>关闭</button><div data-content></div><label><input type="checkbox" data-include-comments>导出包含批注</label>';
      host.querySelector<HTMLButtonElement>('[data-close]')!.onclick = reset;
      host.querySelector<HTMLInputElement>('input')!.onchange = (event) => { include = (event.target as HTMLInputElement).checked; };
      document.body.append(host);
      panel = createCommentsPanel(host.querySelector('[data-content]')!, '本页没有批注');
      panel.setSlide(viewer.slide); button.setAttribute('aria-expanded', 'true');
    } catch (error) { reset(); button.title = String(error); }
  })(); };
  return { sync, reset, get showComments() { return include; } };
}
