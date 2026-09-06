/** 原生模态框会让页头 inert；把同一个语言入口暂借给对话框，不复制状态或 id。 */
export function moveLanguageControl(host: Element): () => void {
  const control = document.querySelector('#siteLanguage');
  if (!control || host.contains(control)) return () => {};
  const slot = document.createComment('语言入口原位');
  control.before(slot);
  host.append(control);
  return () => { slot.replaceWith(control); };
}

/** 全屏只显示目标的后代；借用同一个入口，退出时归还到页头或预览栏。 */
export function bindFullscreenLanguage(host: HTMLElement): () => void {
  const slot = document.createElement('div');
  slot.className = 'fullscreen-language';
  host.append(slot);
  let restore: (() => void) | undefined;
  const release = (): void => { restore?.(); restore = undefined; };
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === host) restore ??= moveLanguageControl(slot);
    else release();
  });
  return release;
}

/** 输入框独占编辑键；按钮/链接只独占激活键，仍允许用户接着用方向键翻页。 */
export function ownsViewerKey(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (target.closest('input,select,textarea,[contenteditable]')) return true;
  return (event.key === 'Enter' || event.key === ' ') && !!target.closest('a,button');
}
