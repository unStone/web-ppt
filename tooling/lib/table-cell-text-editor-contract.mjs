import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tableCellText = (element, r, c) => element.rows[r].cells[c].text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

function selectAll(window, marker) {
  const range = window.document.createRange();
  range.selectNodeContents(marker);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
}

function clipboardEvent(window, values) {
  const event = new window.Event('paste', { bubbles: true, composed: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { types: Object.keys(values), getData: (type) => values[type] ?? '' },
  });
  return event;
}

/** 发布挂载 seam 必须把同一文字控制器精确贴到单元格，而不是建立表格专用输入旁路。 */
export async function runTableCellTextEditorContract({ check, lib, root, window }) {
  console.log('\n\x1b[36m▸ DOM 表格单元格文字编辑\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-basic.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-table-cell-' });
  const record = Object.values(session.editor.doc.elements).find((candidate) => candidate.src.kind === 'table');
  const container = document.createElement('div');
  document.body.append(container);
  const view = session.mount(container, { mode: 'edit', textMode: 'html' });
  const partition = container.querySelector(`[data-edit-id="${record.id}"]`);
  const firstStatic = partition.querySelector('[data-table-cell="0:0"]');
  const secondStatic = partition.querySelector('[data-table-cell="0:1"]');
  firstStatic?.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));
  let editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  let marker = editable?.querySelector('[data-r="0.0"]');
  if (!check('双击可见起始格按稳定行列身份进入同一 contenteditable',
    !!editable && editable.dataset.pptTextCell === '0:0' && marker?.textContent === 'A'
      && session.editor.selection.kind === 'text'
      && session.editor.selection.cell?.r === 0 && session.editor.selection.cell?.c === 0)) {
    view.destroy(); session.dispose(); container.remove(); return;
  }
  check('编辑期间只隐藏当前格文字且其它格持续可见',
    [...firstStatic.querySelectorAll('foreignObject, text')]
      .every((node) => node.style.visibility === 'hidden')
      && [...secondStatic.querySelectorAll('foreignObject, text')]
        .every((node) => node.style.visibility === ''));

  selectAll(window, marker);
  const input = new window.InputEvent('beforeinput', {
    inputType: 'insertText', data: '首格', bubbles: true, composed: true, cancelable: true,
  });
  marker.dispatchEvent(input);
  check('单元格 beforeinput 复用模型文字事务并保留邻格内容',
    input.defaultPrevented
      && tableCellText(session.editor.effectiveElement(record.id), 0, 0) === '首格'
      && tableCellText(session.editor.effectiveElement(record.id), 0, 1) === 'B');

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const tab = new window.KeyboardEvent('keydown', {
    key: 'Tab', bubbles: true, composed: true, cancelable: true,
  });
  editable.dispatchEvent(tab);
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  check('Tab 阻止焦点逃逸并切到下一个非合并起始格',
    tab.defaultPrevented && editable?.dataset.pptTextCell === '0:1'
      && editable.querySelector('[data-r="0.0"]')?.textContent === 'B'
      && session.editor.selection.kind === 'text' && session.editor.selection.cell?.c === 1);
  check('切格后恢复旧格静态文字并只隐藏新格',
    [...container.querySelector('[data-table-cell="0:0"]').querySelectorAll('foreignObject, text')]
      .every((node) => node.style.visibility === '')
      && [...container.querySelector('[data-table-cell="0:1"]').querySelectorAll('foreignObject, text')]
        .every((node) => node.style.visibility === 'hidden'));

  marker = editable.querySelector('[data-r="0.0"]');
  selectAll(window, marker);
  marker.dispatchEvent(new window.InputEvent('beforeinput', {
    inputType: 'insertText', data: '次格', bubbles: true, composed: true, cancelable: true,
  }));
  session.editor.undo();
  check('相邻单元格连续输入使用独立合并键，撤销只恢复当前格',
    tableCellText(session.editor.effectiveElement(record.id), 0, 0) === '首格'
      && tableCellText(session.editor.effectiveElement(record.id), 0, 1) === 'B'
      && session.editor.history.undoCount === 1);
  session.editor.undo();
  check('跨格撤销把同一编辑面切回历史选区而不遗留无编辑面的文本选区',
    container.querySelector('[data-ppt-text-editor]')?.dataset.pptTextCell === '0:0'
      && session.editor.selection.kind === 'text' && session.editor.selection.cell?.c === 0
      && tableCellText(session.editor.effectiveElement(record.id), 0, 0) === 'A');
  session.editor.redo();
  editable = container.querySelector('[data-ppt-text-editor]');
  editable.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Tab', bubbles: true, composed: true, cancelable: true,
  }));

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  marker = editable.querySelector('[data-r="0.0"]');
  selectAll(window, marker);
  check('单元格工具栏 seam 查询并设置当前格字符格式',
    view.setRunProps({ b: true }) && view.queryRunProps()?.b.value === true
      && session.editor.effectiveElement(record.id).rows[0].cells[1].text.paragraphs[0].runs[0].b);

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const shiftTab = new window.KeyboardEvent('keydown', {
    key: 'Tab', shiftKey: true, bubbles: true, composed: true, cancelable: true,
  });
  editable.dispatchEvent(shiftTab);
  check('Shift+Tab 反向导航且不制造文字历史', shiftTab.defaultPrevented
    && container.querySelector('[data-ppt-text-editor]').dataset.pptTextCell === '0:0');
  container.querySelector('[data-ppt-text-editor]').dispatchEvent(tab);
  const lastTab = new window.KeyboardEvent('keydown', {
    key: 'Tab', bubbles: true, composed: true, cancelable: true,
  });
  container.querySelector('[data-ppt-text-editor]').dispatchEvent(lastTab);
  check('末格 Tab 通过 InsertRow 追加空行并把同一编辑面移到新行首格',
    lastTab.defaultPrevented
      && container.querySelector('[data-ppt-text-editor]').dataset.pptTextCell === '1:0'
      && session.editor.effectiveElement(record.id).rows.length === 2
      && session.editor.selection.kind === 'text'
      && session.editor.selection.cell?.r === 1 && session.editor.selection.cell?.c === 0
      && container.querySelector('[data-table-cell="1:0"]'));

  view.destroy(); session.dispose(); container.remove();

  const engineSession = await lib.openEditor(bytes, { idPrefix: 'editor-table-cell-engine-' });
  const engineRecord = Object.values(engineSession.editor.doc.elements)
    .find((candidate) => candidate.src.kind === 'table');
  const engineContainer = document.createElement('div');
  document.body.append(engineContainer);
  const engineView = engineSession.mount(engineContainer, { mode: 'edit', textMode: 'svg' });
  engineContainer.querySelector('[data-table-cell="0:0"]').dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  const engineEditable = engineContainer.querySelector('[data-ppt-text-editor]');
  check('单元格 svg 文本模式继续消费 engine 行盒而非表格专用 DOM',
    engineEditable?.dataset.pptTextCell === '0:0'
      && !!engineEditable.querySelector('[data-layout="engine"]')
      && engineSession.editor.selection.kind === 'text'
      && engineSession.editor.selection.id === engineRecord.id);
  engineView.destroy(); engineSession.dispose(); engineContainer.remove();

  const advancedSession = await lib.openEditor(
    new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-table-text.pptx'))),
    { idPrefix: 'editor-table-cell-advanced-' },
  );
  const advancedRecord = Object.values(advancedSession.editor.doc.elements)
    .find((candidate) => candidate.src.name === '表格文字综合');
  const advancedContainer = document.createElement('div');
  document.body.append(advancedContainer);
  const advancedView = advancedSession.mount(advancedContainer, { mode: 'edit', textMode: 'html' });
  const advancedPartition = advancedContainer.querySelector(`[data-edit-id="${advancedRecord.id}"]`);
  check('复杂表格只给十个可见起始格命中身份且合并占位格没有伪交互节点',
    advancedPartition.querySelectorAll('[data-table-cell]').length === 10
      && !advancedPartition.querySelector('[data-table-cell="0:3"]')
      && !advancedPartition.querySelector('[data-table-cell="2:0"]'));
  advancedPartition.querySelector('[data-table-cell="0:1"]').dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  let advancedEditable = advancedContainer.querySelector('[data-ppt-text-editor]');
  const emptyMarker = advancedEditable.querySelector('[data-r="0.0"]');
  emptyMarker.dispatchEvent(new window.InputEvent('beforeinput', {
    inputType: 'insertText', data: '空格输入', bubbles: true, composed: true, cancelable: true,
  }));
  check('空单元格可直接输入并从 endParaRPr 继承格式',
    tableCellText(advancedSession.editor.effectiveElement(advancedRecord.id), 0, 1) === '空格输入'
      && advancedSession.editor.effectiveElement(advancedRecord.id)
        .rows[0].cells[1].text.paragraphs[0].runs[0].b);
  advancedEditable = advancedContainer.querySelector('[data-ppt-text-editor]');
  advancedEditable.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, composed: true, cancelable: true,
  }));
  advancedContainer.querySelector('[data-table-cell="0:2"]').dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  const colSpanEditable = advancedContainer.querySelector('[data-ppt-text-editor]');
  colSpanEditable.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, composed: true, cancelable: true,
  }));
  advancedContainer.querySelector('[data-table-cell="1:0"]').dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  const rowSpanEditable = advancedContainer.querySelector('[data-ppt-text-editor]');
  check('横纵合并起始格的编辑矩形包含完整 colSpan 与 rowSpan',
    colSpanEditable.style.width === '540px' && colSpanEditable.style.height === '170px'
      && rowSpanEditable.style.width === '270px' && rowSpanEditable.style.height === '340px');
  rowSpanEditable.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, composed: true, cancelable: true,
  }));
  advancedContainer.querySelector('[data-table-cell="0:0"]').dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  advancedEditable = advancedContainer.querySelector('[data-ppt-text-editor]');
  const richMarker = advancedEditable.querySelector('[data-r="0.1"]');
  selectAll(window, richMarker);
  const paste = clipboardEvent(window, {
    'text/plain': '加粗', 'text/html': '<strong>加粗</strong>',
  });
  advancedEditable.dispatchEvent(paste);
  const richRuns = advancedSession.editor.effectiveElement(advancedRecord.id)
    .rows[0].cells[0].text.paragraphs.flatMap((paragraph) => paragraph.runs);
  check('单元格富文本粘贴仍经同一白名单片段模型',
    paste.defaultPrevented && richRuns.some((run) => run.text === '加粗' && run.b));
  advancedEditable = advancedContainer.querySelector('[data-ppt-text-editor]');
  advancedEditable.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, composed: true, cancelable: true,
  }));
  advancedContainer.querySelector('[data-table-cell="1:1"]').dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  advancedEditable = advancedContainer.querySelector('[data-ppt-text-editor]');
  const verticalMarker = advancedEditable.querySelector('[data-r="0.0"]');
  const verticalText = verticalMarker.firstChild;
  const range = window.document.createRange();
  range.setStart(verticalText, 2); range.collapse(true);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  advancedEditable.dispatchEvent(new window.CompositionEvent('compositionstart', {
    bubbles: true, composed: true,
  }));
  range.insertNode(document.createTextNode('组词'));
  advancedEditable.dispatchEvent(new window.CompositionEvent('compositionend', {
    bubbles: true, composed: true, data: '组词',
  }));
  check('竖排单元格 IME 组词提交到目标格且覆盖层保留单元格矩形',
    tableCellText(advancedSession.editor.effectiveElement(advancedRecord.id), 1, 1)
      .includes('竖排组词中文')
      && advancedContainer.querySelector('[data-ppt-text-editor]').style.width === '270px'
      && advancedContainer.querySelector('[data-ppt-text-editor]').style.height === '170px');
  advancedView.destroy(); advancedSession.dispose(); advancedContainer.remove();
}
