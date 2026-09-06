import type { EditorSession, SlideEditor } from '@web-ppt/editor';
import { querySelectionPane } from '@web-ppt/edit-core';
import { message, type SiteMessage } from './i18n/message';
import { setAttributeMessage, setAttributeText, setMessage } from './i18n/runtime';

const placeholderMessages: Readonly<Record<string, SiteMessage>> = {
  title: message('添加标题'), ctrTitle: message('添加标题'), subTitle: message('添加副标题'),
  body: message('添加正文'), obj: message('添加内容'), pic: message('添加图片'),
};

export function bindViewLabels(session: EditorSession, view: SlideEditor): () => void {
  const textLayer = view.element.querySelector('[data-ppt-layer="text"]')!;
  const interaction = view.element.querySelector('[data-ppt-layer="interaction"]')!;
  function syncSearch(): void {
    const search = session.textSearch.snapshot, current = search.current;
    const label = !search.open ? message('幻灯片编辑画布') : current
      ? message('查找结果 {index}/{count}：{excerpt}', {
        index: search.currentIndex + 1, count: search.matches.length,
        excerpt: current.before + current.text + current.after,
      }) : search.query ? message('未找到“{query}”', { query: search.query }) : message('查找文字');
    setAttributeMessage(view.element, 'aria-label', label);
  }
  function syncText(): void {
    const selection = session.editor.selection;
    if (selection.kind !== 'text') return;
    const input = textLayer.querySelector<HTMLElement>('[data-ppt-text-editor]');
    if (input?.dataset.pptTextEditor !== selection.id) return;
    const item = querySelectionPane(session.editor.doc, view.slideId).find((item) => item.id === selection.id);
    if (!item) return;
    setAttributeMessage(input, 'aria-label', selection.cell
      ? message('编辑单元格：{name}，第 {row} 行，第 {column} 列', {
        name: item.name, row: selection.cell.r + 1, column: selection.cell.c + 1,
      }) : message('编辑文字：{name}', { name: item.name }));
  }
  function labelImageChooser(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.matches('[data-web-ppt-image-input]')) {
      setAttributeText(input, 'aria-label', '选择要插入的图片');
    }
  }
  function syncPlaceholders(): void {
    for (const hit of interaction.querySelectorAll<SVGElement>('[data-edit-placeholder-layer] > [data-edit-placeholder-type]')) {
      const label = hit.nextElementSibling;
      if (label?.localName === 'text') {
        setMessage(label, placeholderMessages[hit.dataset.editPlaceholderType!] ?? message('添加内容'));
      }
    }
  }
  // 文件选择的默认动作发生在 click 之后，捕获阶段绑定才能赶在系统选择器打开前生效。
  view.element.addEventListener('click', labelImageChooser, true);
  // SDK 在搜索、缩放和模式刷新时重写名称；只读公开快照，不解析其诊断用中文字符串。
  const observer = new MutationObserver(syncSearch);
  observer.observe(view.element, { attributes: true, attributeFilter: ['aria-label'] });
  // 只观察文字层直属输入的创建/替换，不遍历静态 SVG 或监听逐字 DOM 变动。
  const textObserver = new MutationObserver(syncText);
  textObserver.observe(textLayer, { childList: true });
  // 提示属于交互辅助层，不能遍历静态文稿文字；语言切换也不重建占位符的命中框。
  const placeholderObserver = new MutationObserver(syncPlaceholders);
  placeholderObserver.observe(interaction, { childList: true });
  const unsubscribe = session.editor.subscribe((change) => {
    const selection = session.editor.selection;
    if (selection.kind === 'text' && change.paneElements.has(selection.id)) syncText();
  });
  syncSearch();
  syncText();
  syncPlaceholders();
  return () => {
    observer.disconnect(); textObserver.disconnect(); placeholderObserver.disconnect(); unsubscribe();
    view.element.removeEventListener('click', labelImageChooser, true);
  };
}
