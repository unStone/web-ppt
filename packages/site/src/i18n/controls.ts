/** 原生模态框会让页头 inert；把同一个语言入口暂借给对话框，不复制状态或 id。 */
export function moveLanguageControl(host: Element): () => void {
  const control = document.querySelector('#siteLanguage');
  if (!control || host.contains(control)) return () => {};
  const slot = document.createComment('语言入口原位');
  control.before(slot);
  host.append(control);
  return () => { slot.replaceWith(control); };
}
