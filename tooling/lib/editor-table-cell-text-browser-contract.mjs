import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const cellText = (table, r, c) => table.rows[r].cells[c].text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

function selectFirstCharacter(root) {
  const marker = [...root.querySelectorAll('[data-r]')].find((node) => node.textContent.length);
  const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
  const text = walker.nextNode();
  const range = document.createRange();
  range.setStart(text, 0); range.setEnd(text, 1);
  getSelection().removeAllRanges(); getSelection().addRange(range);
  root.focus({ preventScroll: true });
}

/** 真实布局验证旋转单元格贴合、双文字路径与 20×10 表格输入预算。 */
export async function runEditorTableCellTextBrowserContract({ openEditor, load }) {
  const session = await openEditor(await load('sample-editor-table-text.pptx'), {
    idPrefix: 'browser-table-cell-text-',
  });
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const semantic = Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === '表格文字综合');
  const view = session.mount(mount, {
    mode: 'edit', textMode: 'html', slideId: session.editor.doc.slideOrder[0],
  });
  const staticCell = mount.querySelector('[data-table-cell="0:2"]');
  staticCell.dispatchEvent(new MouseEvent('dblclick', {
    bubbles: true, composed: true, cancelable: true,
  }));
  let editable = mount.querySelector('[data-ppt-text-editor]');
  const staticBox = staticCell.getBoundingClientRect();
  const editBox = editable.getBoundingClientRect();
  const geometryError = Math.max(
    Math.abs(staticBox.left - editBox.left), Math.abs(staticBox.top - editBox.top),
    Math.abs(staticBox.width - editBox.width), Math.abs(staticBox.height - editBox.height),
  );
  if (geometryError > 0.5 || editable.dataset.pptTextCell !== '0:2') {
    throw new Error(`旋转单元格编辑面贴合偏差 ${geometryError.toFixed(3)}px`);
  }

  const engineMount = document.createElement('div');
  engineMount.className = 'contract-offscreen';
  document.body.append(engineMount);
  const engineView = session.mount(engineMount, {
    mode: 'edit', textMode: 'svg', slideId: session.editor.doc.slideOrder[0],
  });
  engineMount.querySelector('[data-table-cell="1:1"]').dispatchEvent(new MouseEvent('dblclick', {
    bubbles: true, composed: true, cancelable: true,
  }));
  if (!engineMount.querySelector('[data-ppt-text-editor] [data-layout="engine"]')) {
    throw new Error('单元格原生 SVG 预览没有驱动 engine 编辑行盒');
  }
  engineView.destroy(); engineMount.remove();

  view.setSlide(session.editor.doc.slideOrder[1]);
  const performanceTable = Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === '20x10 性能表');
  const targetCell = { r: 5, c: 10 };
  mount.querySelector(`[data-edit-id="${performanceTable.id}"] [data-table-cell="5:10"]`)
    .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
  const original = cellText(session.editor.effectiveElement(performanceTable.id), 5, 10);
  const samples = [];
  for (let index = 0; index < 30; index++) {
    editable = mount.querySelector('[data-ppt-text-editor]');
    selectFirstCharacter(editable);
    const started = performance.now();
    const event = new InputEvent('beforeinput', {
      inputType: 'insertText', data: '真', bubbles: true, composed: true, cancelable: true,
    });
    const accepted = editable.dispatchEvent(event);
    mount.querySelector('[data-ppt-text-editor]').getBoundingClientRect();
    samples.push(performance.now() - started);
    if (accepted || cellText(session.editor.effectiveElement(performanceTable.id), 5, 10) !== `真${original.slice(1)}`) {
      throw new Error('20×10 表格输入没有进入目标单元格模型');
    }
    session.editor.undo();
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  if (cellText(session.editor.effectiveElement(performanceTable.id), 5, 10) !== original) {
    throw new Error('20×10 表格输入撤销后文字不一致');
  }
  recordPerformanceBudget('20×10 表格输入完整上屏 p95', p95, 30);
  mount.querySelector('[data-ppt-text-editor]').dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, composed: true, cancelable: true,
  }));
  mount.querySelector(`[data-edit-id="${performanceTable.id}"] [data-table-cell="9:19"]`)
    .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
  const insertSamples = [];
  for (let index = 0; index < 30; index++) {
    editable = mount.querySelector('[data-ppt-text-editor]');
    const started = performance.now();
    editable.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', bubbles: true, composed: true, cancelable: true,
    }));
    mount.querySelector('[data-ppt-text-editor]').getBoundingClientRect();
    insertSamples.push(performance.now() - started);
    if (session.editor.effectiveElement(performanceTable.id).rows.length !== 11
      || mount.querySelector('[data-ppt-text-editor]')?.dataset.pptTextCell !== '10:0') {
      throw new Error('20×10 表格末格 Tab 没有完整追加并进入新行');
    }
    session.editor.undo();
  }
  insertSamples.sort((left, right) => left - right);
  const insertRowP95 = insertSamples[Math.floor(insertSamples.length * 0.95)];
  if (session.editor.effectiveElement(performanceTable.id).rows.length !== 10) {
    throw new Error('20×10 表格末格追加撤销后行数不一致');
  }
  recordPerformanceBudget('20×10 表格末格追加完整上屏 p95', insertRowP95, 30);
  mount.querySelector('[data-ppt-text-editor]').dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, composed: true, cancelable: true,
  }));
  mount.querySelector(`[data-edit-id="${performanceTable.id}"] [data-table-cell="5:10"]`)
    .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
  return {
    session, view, mount, id: performanceTable.id, cell: targetCell,
    p95, insertRowP95, geometryError,
  };
}
