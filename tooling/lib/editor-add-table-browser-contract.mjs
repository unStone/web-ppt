import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const p95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};
const cellText = (table, r, c) => table.rows[r].cells[c].text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

/** 真实 Chrome 覆盖公开 DOM seam、占位符、默认矩形、逐格输入、Tab 追加与双视图。 */
export async function runEditorAddTableBrowserContract({ openEditor, load }) {
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  editMount.className = 'contract-offscreen';
  viewMount.className = 'contract-offscreen';
  document.body.append(editMount, viewMount);
  const session = await openEditor(await load('sample-editor-add-table.pptx'), {
    idPrefix: 'browser-add-table-',
  });
  let geometryError = Infinity;
  try {
    const editView = session.mount(editMount, { mode: 'edit', textMode: 'svg', zoom: 0.75, snapping: false });
    const viewView = session.mount(viewMount, { mode: 'view', textMode: 'svg', zoom: 0.75, snapping: false });
    const placeholder = Object.values(session.editor.doc.elements).find((record) =>
      record.src.name === '空内容占位符');
    session.editor.select({ kind: 'elements', ids: [placeholder.id], enteredGroup: null });
    const id = editView.insertTable(3, 4);
    const table = session.editor.effectiveElement(id);
    const frame = editMount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
    const stage = editMount.querySelector('[data-ppt-stage]').getBoundingClientRect();
    geometryError = frame ? Math.max(
      Math.abs(frame.left - stage.left - 90 * 0.75),
      Math.abs(frame.top - stage.top - 92 * 0.75),
      Math.abs(frame.width - 720 * 0.75),
      Math.abs(frame.height - 410 * 0.75),
    ) : Infinity;
    const feedback = {
      kind: table?.kind, geometryError,
      placeholder: Boolean(session.editor.doc.elements[placeholder.id]),
      editTable: Boolean(editMount.querySelector(`[data-edit-id="${id}"] [data-table-cell="0:0"]`)),
      viewTable: Boolean(viewMount.querySelector(`[data-edit-id="${id}"] [data-table-cell="0:0"]`)),
      viewAid: Boolean(viewMount.querySelector('[data-edit-placeholder-id]')),
    };
    if (table?.kind !== 'table' || table.rows.length !== 3 || table.colWidths.length !== 4
      || geometryError > 0.5 || feedback.placeholder || !feedback.editTable
      || !feedback.viewTable || feedback.viewAid) {
      throw new Error(`公开 seam 未完成内容占位符原位替换/双视图反馈：${JSON.stringify(feedback)}`);
    }

    editMount.querySelector(`[data-edit-id="${id}"] [data-table-cell="0:0"]`)
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
    let editable = editMount.querySelector('[data-ppt-text-editor]');
    if (editable?.dataset.pptTextCell !== '0:0') throw new Error('新表格首格不能立即进入文字编辑');
    editable.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertText', data: '新表格', bubbles: true, composed: true, cancelable: true,
    }));
    if (cellText(session.editor.effectiveElement(id), 0, 0) !== '新表格') {
      throw new Error('新表格首格输入没有进入 headless 模型');
    }
    editable.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, composed: true, cancelable: true,
    }));
    editMount.querySelector(`[data-edit-id="${id}"] [data-table-cell="2:3"]`)
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
    editable = editMount.querySelector('[data-ppt-text-editor]');
    editable.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', bubbles: true, composed: true, cancelable: true,
    }));
    await nextFrame();
    if (session.editor.effectiveElement(id).rows.length !== 4
      || editMount.querySelector('[data-ppt-text-editor]')?.dataset.pptTextCell !== '3:0'
      || !viewMount.querySelector(`[data-edit-id="${id}"] [data-table-cell="3:0"]`)) {
      throw new Error('新表格末格 Tab 没有追加、进入新行并同步 view 视图');
    }
    editMount.querySelector('[data-ppt-text-editor]')?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, composed: true, cancelable: true,
    }));
    session.editor.exec({ type: 'SetXfrm', id, w: 600, h: 360 });
    const resizedFrame = editMount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
    const lastCell = editMount.querySelector(`[data-edit-id="${id}"] [data-table-cell="3:3"]`)
      ?.getBoundingClientRect();
    const gridFitError = resizedFrame && lastCell ? Math.max(
      Math.abs(lastCell.right - resizedFrame.right), Math.abs(lastCell.bottom - resizedFrame.bottom),
    ) : Infinity;
    if (gridFitError > 0.5) {
      throw new Error(`表格缩放后内部网格没有贴合 frame：${gridFitError.toFixed(3)}px`);
    }

    editView.setMode('view');
    let viewRejected = false;
    try { editView.insertTable(2, 2); } catch (error) { viewRejected = error.message.includes('查看模式'); }
    if (!viewRejected || editMount.querySelector('[data-ppt-text-editor]')) {
      throw new Error('view 模式仍允许插入表格或保留文字编辑面');
    }
    editView.setMode('edit');
    session.editor.select({ kind: 'none' });
    const defaultId = editView.insertTable(2, 3);
    const defaultTable = session.editor.effectiveElement(defaultId);
    if (defaultTable.x !== 460 || defaultTable.y !== 312
      || defaultTable.w !== 360 || defaultTable.h !== 96) {
      throw new Error(`无占位符默认矩形不可预测：${JSON.stringify(defaultTable)}`);
    }
    return { geometryError };
  } finally {
    session.dispose();
    editMount.remove();
    viewMount.remove();
  }
}

/** 60 元素页反复插入 20×10 表格，测命令到 SVG、选择框与布局读取的完整反馈。 */
export async function runEditorAddTablePerformanceContract({ openEditor, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const session = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-add-table-performance-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const slideId = view.slideId;
    const siblingId = session.editor.doc.slides[slideId].children[0];
    const sibling = mount.querySelector(`[data-edit-id="${siblingId}"]`);
    const svg = mount.querySelector('[data-ppt-layer="static"] svg');
    const samples = [];
    for (let index = 0; index < 35; index++) {
      const started = performance.now();
      const id = view.insertTable(10, 20, { rect: { x: 70, y: 70, w: 1140, h: 560 } });
      mount.querySelector(`[data-edit-id="${id}"] [data-table-cell="9:19"]`)?.getBoundingClientRect();
      mount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
      samples.push(performance.now() - started);
      session.editor.undo();
    }
    const feedbackP95 = p95(samples);
    if (session.editor.doc.slides[slideId].children.length !== 60
      || mount.querySelector('[data-ppt-layer="static"] svg') !== svg
      || mount.querySelector(`[data-edit-id="${siblingId}"]`) !== sibling) {
      throw new Error('60 元素页 20×10 表格插入后的 DOM 身份不稳定');
    }
    recordPerformanceBudget('60 元素页 20×10 表格插入 p95', feedbackP95, 16);
    return { p95: feedbackP95 };
  } finally {
    session.dispose();
    mount.remove();
  }
}
