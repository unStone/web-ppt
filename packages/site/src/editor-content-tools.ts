import type { EditorSession, SlideEditor } from '@web-ppt/editor';
import { editorButtons as buttons } from './editor-elements';
import { message, type SiteNotice } from './i18n/message';
import { setAttributeText, setText } from './i18n/runtime';

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
  const shapePicker = document.querySelector<HTMLElement>('#shapePicker')!;
  const tablePicker = document.querySelector<HTMLElement>('#tablePicker')!;
  const tableGrid = document.querySelector<HTMLElement>('#tableSizeGrid')!;
  const tableLabel = document.querySelector<HTMLElement>('#tableSizeLabel')!;
  let opened: { anchor: HTMLButtonElement; panel: HTMLElement } | null = null;
  const closePicker = (restoreFocus = false) => {
    if (!opened) return;
    const { anchor, panel } = opened;
    panel.hidden = true; anchor.setAttribute('aria-expanded', 'false'); opened = null;
    if (restoreFocus) anchor.focus();
  };
  const togglePicker = (anchor: HTMLButtonElement, panel: HTMLElement) => {
    if (opened?.panel === panel) { closePicker(true); return; }
    closePicker();
    panel.hidden = false; anchor.setAttribute('aria-expanded', 'true'); opened = { anchor, panel };
    panel.querySelector<HTMLButtonElement>('button')?.focus();
  };
  document.addEventListener('pointerdown', event => {
    if (opened && !opened.panel.contains(event.target as Node) && !opened.anchor.contains(event.target as Node)) closePicker();
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && opened) { event.preventDefault(); closePicker(true); }
  }, { signal });

  const addSlide = () => void run(({ session, view, showSlide }) => {
    if (!session || !view) return;
    const current = session.editor.doc.slides[view.slideId];
    const layoutId = current.layoutId && session.editor.doc.layouts[current.layoutId]
      ? current.layoutId : session.editor.doc.layoutOrder[0];
    if (!layoutId) { notice(message('当前文稿没有可用版式'), 'error'); return; }
    const result = session.editor.exec({ type: 'AddSlide', layoutId, at: { after: view.slideId } });
    const added = [...result.createdSlides][0];
    if (added) showSlide(added);
    notice(message('已新增幻灯片'), 'success');
  });
  buttons.addSlide.addEventListener('click', addSlide, { signal });
  buttons.addSlideShortcut.addEventListener('click', addSlide, { signal });

  buttons.addShape.addEventListener('click', () => togglePicker(buttons.addShape, shapePicker), { signal });
  shapePicker.addEventListener('click', event => {
    const choice = (event.target as Element).closest<HTMLButtonElement>('[data-shape-preset]');
    if (!choice) return;
    const preset = choice.dataset.shapePreset!;
    closePicker();
    void run(({ session, view }) => {
    if (!session || !view) return;
    const { width, height } = session.editor.doc.meta;
      session.editor.exec({ type: 'AddShape', slideId: view.slideId, preset,
      rect: { x: width * .35, y: height * .34, w: width * .3, h: height * .22 } });
    view.element.focus();
      notice(message(preset === 'roundRect' ? '已插入圆角矩形；拖动可移动，双击可输入文字'
        : '形状已插入；拖动可移动，双击可输入文字'), 'success');
    });
  }, { signal });
  buttons.addImage.addEventListener('click', () => void run(async ({ view, requestSignal }) => {
    if (!view) return;
    const id = await view.chooseImage({ signal: requestSignal ?? signal });
    if (!signal.aborted && !requestSignal?.aborted && id && context().view === view) notice(message('图片已插入'), 'success');
  }), { signal });

  const previewTableSize = (rows: number, columns: number) => {
    setText(tableLabel, '{rows} × {columns} 表格', { rows, columns });
    for (const cell of tableGrid.querySelectorAll<HTMLElement>('[data-table-row]')) {
      cell.toggleAttribute('data-active', Number(cell.dataset.tableRow) <= rows && Number(cell.dataset.tableColumn) <= columns);
    }
  };
  for (let row = 1; row <= 8; row++) for (let column = 1; column <= 8; column++) {
    const cell = document.createElement('button');
    cell.type = 'button'; cell.role = 'gridcell';
    cell.dataset.tableRow = String(row); cell.dataset.tableColumn = String(column);
    setAttributeText(cell, 'aria-label', '插入 {rows} × {columns} 表格', { rows: row, columns: column });
    cell.addEventListener('pointerenter', () => previewTableSize(row, column), { signal });
    cell.addEventListener('focus', () => previewTableSize(row, column), { signal });
    cell.addEventListener('click', () => {
      closePicker();
      void run(({ session, view }) => {
        if (!session || !view) return;
        const { width, height } = session.editor.doc.meta;
        view.insertTable(row, column, { rect: { x: width * .2, y: height * .25, w: width * .6, h: height * .42 } });
        view.element.focus();
        notice(message('已插入 {rows} × {columns} 表格；双击单元格即可输入', { rows: row, columns: column }), 'success');
      });
    }, { signal });
    tableGrid.append(cell);
  }
  previewTableSize(1, 1);
  buttons.addTable.addEventListener('click', () => togglePicker(buttons.addTable, tablePicker), { signal });
  return () => controller.abort();
}
