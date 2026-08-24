import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const shapeText = (element) => element.text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

function selectOffsets(window, marker, from, to = from) {
  const text = marker.firstChild;
  if (!text || from > (text.textContent?.length ?? 0) || to > (text.textContent?.length ?? 0)) {
    throw new Error(`测试选区越界：${from}..${to}/${text?.textContent ?? '<empty>'}`);
  }
  const range = window.document.createRange();
  range.setStart(text, from);
  range.setEnd(text, to);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

export async function runTextEditorContract({ check, lib, root, window }) {
  console.log('\n\x1b[36m▸ DOM 文字输入与 IME\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-basic.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-text-' });
  const record = Object.values(session.editor.doc.elements).find((candidate) =>
    candidate.src.kind === 'shape' && shapeText(candidate.src) === '可编辑');
  const container = document.createElement('div');
  document.body.append(container);
  const view = session.mount(container, { mode: 'edit' });
  const partition = container.querySelector(`[data-edit-id="${record.id}"]`);
  partition.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));
  let editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  let marker = editable?.querySelector('[data-r="0.0"]');
  check('双击可写文字形状进入外置 contenteditable 并隐藏静态文字',
    !!editable && editable.getAttribute('contenteditable') === 'true'
      && session.editor.selection.kind === 'text' && session.editor.selection.id === record.id
      && marker?.textContent === '可编辑'
      && [...partition.querySelectorAll('foreignObject')].every((node) => node.style.visibility === 'hidden'));

  selectOffsets(window, marker, 1, 2);
  const beforeInput = new window.InputEvent('beforeinput', {
    bubbles: true, composed: true, cancelable: true, inputType: 'insertText', data: '纯Web',
  });
  marker.dispatchEvent(beforeInput);
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  marker = editable.querySelector('[data-r="0.0"]');
  const domRuns = () => [...container.querySelectorAll(`[data-ppt-text-editor="${record.id}"] [data-r]`)]
    .map((run) => run.localName === 'svg' ? '\uFFFC' : run.textContent ?? '').join('');
  check('beforeinput 选区替换走 EditText 而非浏览器私有 DOM 状态',
    beforeInput.defaultPrevented && shapeText(session.editor.effectiveElement(record.id)) === '可纯Web辑'
      && domRuns() === '可纯Web辑' && session.editor.history.undoCount === 1,
    `prevented=${beforeInput.defaultPrevented} model=${shapeText(session.editor.effectiveElement(record.id))}`
      + ` dom=${domRuns()} history=${session.editor.history.undoCount}`);

  if (domRuns() !== '可纯Web辑') {
    view.destroy();
    session.dispose();
    return;
  }
  marker = editable.querySelector('[data-r="0.1"]');
  selectOffsets(window, marker, 0, 4);
  const compositionRoot = editable;
  editable.dispatchEvent(new window.CompositionEvent('compositionstart', {
    bubbles: true, composed: true, data: '',
  }));
  const range = window.getSelection().getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode('中文'));
  editable.dispatchEvent(new window.InputEvent('input', {
    bubbles: true, composed: true, inputType: 'insertCompositionText', data: '中文', isComposing: true,
  }));
  check('IME 组词期间不替换编辑面 DOM 或提前提交历史',
    container.querySelector(`[data-ppt-text-editor="${record.id}"]`) === compositionRoot
      && session.editor.history.undoCount === 1);
  editable.dispatchEvent(new window.CompositionEvent('compositionend', {
    bubbles: true, composed: true, data: '中文',
  }));
  check('compositionend 白名单回读形成一个撤销单元',
    shapeText(session.editor.effectiveElement(record.id)) === '可中文辑'
      && session.editor.history.undoCount === 2);

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  marker = editable.querySelector('[data-r="0.0"]');
  selectOffsets(window, marker, 0, 1);
  editable.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true, composed: true }));
  session.editor.exec({
    type: 'EditText', id: record.id,
    ops: [{
      type: 'replace', from: { p: 0, r: 2, off: 1 }, to: { p: 0, r: 2, off: 1 }, text: '远端',
    }],
  });
  const concurrentRange = window.getSelection().getRangeAt(0);
  concurrentRange.deleteContents();
  concurrentRange.insertNode(document.createTextNode('并'));
  editable.dispatchEvent(new window.CompositionEvent('compositionend', {
    bubbles: true, composed: true, data: '并',
  }));
  check('IME 期间的非冲突模型更新按区间重放且不会被旧 DOM 覆盖',
    shapeText(session.editor.effectiveElement(record.id)) === '并中文辑远端');
  session.editor.undo();
  session.editor.undo();

  const nativeInput = document.createElement('input');
  view.element.append(nativeInput);
  const nativePointer = new window.MouseEvent('pointerdown', {
    bubbles: true, composed: true, cancelable: true, button: 0,
  });
  nativeInput.dispatchEvent(nativePointer);
  check('编辑器内普通表单控件保有指针且不被迫退出文字态',
    !nativePointer.defaultPrevented && !!container.querySelector('[data-ppt-text-editor]')
      && session.editor.selection.kind === 'text');
  nativeInput.remove();

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  marker = editable.querySelector('[data-r="0.1"]');
  selectOffsets(window, marker, 2);
  editable.dispatchEvent(new window.InputEvent('beforeinput', {
    bubbles: true, composed: true, cancelable: true, inputType: 'insertParagraph',
  }));
  check('Enter 通过 beforeinput 拆段且不与文字输入合并历史',
    shapeText(session.editor.effectiveElement(record.id)) === '可中文\n辑'
      && session.editor.history.undoCount === 3);
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  marker = editable.querySelector('[data-r="1.0"]');
  selectOffsets(window, marker, 0);
  editable.dispatchEvent(new window.InputEvent('beforeinput', {
    bubbles: true, composed: true, cancelable: true, inputType: 'insertLineBreak',
  }));
  check('Shift+Enter 对应 insertLineBreak 且保留段落边界',
    session.editor.effectiveElement(record.id).text.paragraphs[1].runs
      .map((run) => run.text).join('') === '\n辑' && session.editor.history.undoCount === 4);
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  editable.dispatchEvent(new window.InputEvent('beforeinput', {
    bubbles: true, composed: true, cancelable: true, inputType: 'deleteContentBackward',
  }));
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  editable.dispatchEvent(new window.InputEvent('beforeinput', {
    bubbles: true, composed: true, cancelable: true, inputType: 'deleteContentForward',
  }));
  check('Backspace/Delete 使用模型光标并连续合并为一个撤销单元',
    shapeText(session.editor.effectiveElement(record.id)) === '可中文\n'
      && session.editor.history.undoCount === 5);
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  editable.dispatchEvent(new window.InputEvent('beforeinput', {
    bubbles: true, composed: true, cancelable: true, inputType: 'historyUndo',
  }));
  check('文字态原生 historyUndo 恢复连续删除前内容',
    shapeText(session.editor.effectiveElement(record.id)) === '可中文\n\n辑');

  const outside = document.createElement('button');
  document.body.append(outside);
  outside.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, composed: true, button: 0 }));
  check('编辑器边界外 pointerdown 退出文字态并同步延迟的静态分区',
    !container.querySelector('[data-ppt-text-editor]')
      && session.editor.selection.kind === 'elements'
      && shapeText(session.editor.effectiveElement(record.id)) === '可中文\n\n辑');
  outside.remove();

  const currentPartition = container.querySelector(`[data-edit-id="${record.id}"]`);
  currentPartition.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));

  const active = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  active.dispatchEvent(new window.KeyboardEvent('keydown', {
    bubbles: true, composed: true, cancelable: true, key: 'Escape',
  }));
  check('Escape 退出文字态并恢复静态文字',
    !container.querySelector('[data-ppt-text-editor]')
      && session.editor.selection.kind === 'elements'
      && [...container.querySelector(`[data-edit-id="${record.id}"]`).querySelectorAll('foreignObject')]
        .every((node) => node.style.visibility === ''));
  view.destroy();

  const viewContainer = document.createElement('div');
  const readonlyView = session.mount(viewContainer, { mode: 'view' });
  viewContainer.querySelector(`[data-edit-id="${record.id}"]`)
    .dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));
  check('view 模式不创建文字编辑面', !viewContainer.querySelector('[data-ppt-text-editor]'));
  readonlyView.destroy();
  session.dispose();
  container.remove();
  viewContainer.remove();

  const fixtureSession = await lib.openEditor(
    new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-text.pptx'))),
    { idPrefix: 'editor-empty-text-' },
  );
  const emptyRecord = Object.values(fixtureSession.editor.doc.elements)
    .find((candidate) => candidate.src.name === '空文本框');
  const emptyContainer = document.createElement('div');
  document.body.append(emptyContainer);
  const emptyView = fixtureSession.mount(emptyContainer, { mode: 'edit' });
  emptyContainer.querySelector(`[data-edit-id="${emptyRecord.id}"]`)
    .dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));
  const emptyEditable = emptyContainer.querySelector(`[data-ppt-text-editor="${emptyRecord.id}"]`);
  const emptyMarker = emptyEditable?.querySelector('[data-r="0.0"]');
  emptyMarker?.dispatchEvent(new window.InputEvent('beforeinput', {
    bubbles: true, composed: true, cancelable: true, inputType: 'insertText', data: '第一行',
  }));
  check('空文本框从 endParaRPr 继承格式并可直接输入',
    shapeText(fixtureSession.editor.effectiveElement(emptyRecord.id)) === '第一行'
      && fixtureSession.editor.effectiveElement(emptyRecord.id).text.paragraphs[0].runs[0].b === true,
    `text=${shapeText(fixtureSession.editor.effectiveElement(emptyRecord.id))}`
      + ` bold=${fixtureSession.editor.effectiveElement(emptyRecord.id).text?.paragraphs[0]?.runs[0]?.b}`
      + ` editable=${!!emptyEditable} marker=${!!emptyMarker}`
      + ` selection=${fixtureSession.editor.selection.kind}`);

  emptyEditable.dispatchEvent(new window.KeyboardEvent('keydown', {
    bubbles: true, composed: true, cancelable: true, key: 'Escape',
  }));
  const richRecord = Object.values(fixtureSession.editor.doc.elements)
    .find((candidate) => candidate.src.name === '文本综合');
  emptyContainer.querySelector(`[data-edit-id="${richRecord.id}"]`)
    .dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));
  let richEditable = emptyContainer.querySelector(`[data-ppt-text-editor="${richRecord.id}"]`);
  let afterBreak = richEditable.querySelector('[data-r="0.4"]');
  selectOffsets(window, afterBreak, 0, 1);
  richEditable.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true, composed: true }));
  const breakRange = window.getSelection().getRangeAt(0);
  breakRange.deleteContents();
  breakRange.insertNode(document.createTextNode('软'));
  richEditable.dispatchEvent(new window.CompositionEvent('compositionend', {
    bubbles: true, composed: true, data: '软',
  }));
  check('IME 白名单回读把既有 br 计为硬换行并保留跨 run 格式边界',
    fixtureSession.editor.effectiveElement(richRecord.id).text.paragraphs[0].runs
      .map((run) => run.text).join('') === ' 前导 中文日本語\n软换行后 ');

  richEditable = emptyContainer.querySelector(`[data-ppt-text-editor="${richRecord.id}"]`);
  const invalidMarker = richEditable.querySelector('[data-r="0.0"]');
  selectOffsets(window, invalidMarker, 0);
  richEditable.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true, composed: true }));
  const browserWrapper = document.createElement('b');
  browserWrapper.textContent = '浏览器私有';
  invalidMarker.prepend(browserWrapper);
  richEditable.dispatchEvent(new window.CompositionEvent('compositionend', {
    bubbles: true, composed: true, data: '浏览器私有',
  }));
  check('IME 回读把白名单外包装降级为纯文本并丢弃其私有样式',
    shapeText(fixtureSession.editor.effectiveElement(richRecord.id)).includes('浏览器私有')
      && !emptyContainer.querySelector('[data-ppt-text-editor] b'));

  richEditable = emptyContainer.querySelector(`[data-ppt-text-editor="${richRecord.id}"]`);
  let formula = richEditable.querySelector('svg[data-r="3.1"]');
  const formulaParent = formula.parentNode;
  const formulaIndex = [...formulaParent.childNodes].indexOf(formula);
  const formulaRange = document.createRange();
  formulaRange.setStart(formulaParent, formulaIndex);
  formulaRange.setEnd(formulaParent, formulaIndex + 1);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(formulaRange);
  const deleteFormula = new window.InputEvent('beforeinput', {
    bubbles: true, composed: true, cancelable: true, inputType: 'deleteContentBackward',
  });
  formula.dispatchEvent(deleteFormula);
  formula = emptyContainer.querySelector('svg[data-r="3.1"]');
  check('公式 SVG 外侧 Range 映射为一个原子并可整块删除',
    deleteFormula.defaultPrevented && !formula
      && !fixtureSession.editor.effectiveElement(richRecord.id).text.paragraphs[3].runs
        .some((run) => run.math?.length));

  richEditable.dispatchEvent(new window.KeyboardEvent('keydown', {
    bubbles: true, composed: true, cancelable: true, key: 'Escape',
  }));
  const repeatedRecord = Object.values(fixtureSession.editor.doc.elements)
    .find((candidate) => candidate.src.name === '重复格式');
  emptyContainer.querySelector(`[data-edit-id="${repeatedRecord.id}"]`)
    .dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));
  const repeatedEditable = emptyContainer.querySelector(`[data-ppt-text-editor="${repeatedRecord.id}"]`);
  const middleRepeat = repeatedEditable.querySelector('[data-r="0.1"]');
  selectOffsets(window, middleRepeat, 0);
  repeatedEditable.dispatchEvent(new window.CompositionEvent('compositionstart', {
    bubbles: true, composed: true,
  }));
  const repeatedRange = window.getSelection().getRangeAt(0);
  repeatedRange.insertNode(document.createTextNode('同'));
  repeatedEditable.dispatchEvent(new window.CompositionEvent('compositionend', {
    bubbles: true, composed: true, data: '同',
  }));
  const repeatedRuns = fixtureSession.editor.effectiveElement(repeatedRecord.id).text.paragraphs[0].runs;
  check('IME 用 compositionstart Range 消除重复文本歧义并继承准确 run 格式',
    repeatedRuns.map((run) => run.text).join('') === '同同同同'
      && repeatedRuns[1].b === true && repeatedRuns[1].color === 'rgb(22,163,74)'
      && repeatedRuns.at(-1).i === true);
  emptyView.destroy();
  fixtureSession.dispose();
  emptyContainer.remove();
}
