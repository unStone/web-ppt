import type { EditorSession, SlideEditor } from '@web-ppt/editor';
import { editorButtons as buttons } from './editor-elements';
import { message, type SiteNotice } from './i18n/message';

interface ContentContext {
  readonly session: EditorSession | null;
  readonly view: SlideEditor | null;
  readonly writable?: boolean;
  readonly requestSignal?: AbortSignal;
  showSlide(id: string): void;
}

export function bindContentTools(context: () => ContentContext, notice: SiteNotice, lifetime?: AbortSignal): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  lifetime?.addEventListener('abort', () => controller.abort(), { once: true, signal });
  if (lifetime?.aborted) controller.abort();
  const run = async (action: (owner: ContentContext) => void | Promise<void>): Promise<void> => {
    const owner = context();
    if (signal.aborted || owner.writable === false) return;
    const slideId = owner.view?.slideId;
    try { await action(owner); } catch (error) {
      if (signal.aborted || owner.requestSignal?.aborted || owner.view !== context().view || slideId !== owner.view?.slideId) return;
      notice(message('插入失败：{detail}', { detail: error instanceof Error ? error.message : String(error) }), 'error');
    }
  };
  buttons.addSlide.addEventListener('click', () => void run(({ session, view, showSlide }) => {
    if (!session || !view) return;
    const current = session.editor.doc.slides[view.slideId];
    const layoutId = current.layoutId && session.editor.doc.layouts[current.layoutId]
      ? current.layoutId : session.editor.doc.layoutOrder[0];
    if (!layoutId) { notice(message('当前文稿没有可用版式'), 'error'); return; }
    const result = session.editor.exec({ type: 'AddSlide', layoutId, at: { after: view.slideId } });
    const added = [...result.createdSlides][0];
    if (added) showSlide(added);
    notice(message('已新增幻灯片'), 'success');
  }), { signal });
  buttons.addShape.addEventListener('click', () => void run(({ session, view }) => {
    if (!session || !view) return;
    const { width, height } = session.editor.doc.meta;
    session.editor.exec({ type: 'AddShape', slideId: view.slideId, preset: 'roundRect',
      rect: { x: width * .35, y: height * .34, w: width * .3, h: height * .22 } });
    view.element.focus();
    notice(message('已插入圆角矩形；拖动可移动，双击可输入文字'), 'success');
  }), { signal });
  buttons.addImage.addEventListener('click', () => void run(async ({ view, requestSignal }) => {
    if (!view) return;
    const id = await view.chooseImage({ signal: requestSignal ?? signal });
    if (!signal.aborted && !requestSignal?.aborted && id && context().view === view) notice(message('图片已插入'), 'success');
  }), { signal });
  buttons.addTable.addEventListener('click', () => void run(({ session, view }) => {
    if (!session || !view) return;
    const { width, height } = session.editor.doc.meta;
    view.insertTable(3, 3, { rect: { x: width * .2, y: height * .25, w: width * .6, h: height * .42 } });
    notice(message('已插入 3 × 3 表格；双击单元格即可输入'), 'success');
  }), { signal });
  return () => controller.abort();
}
