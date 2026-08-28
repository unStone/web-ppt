import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyboardEvent } from './keyboard-event.mjs';

function selectOffsets(window, marker, from, to = from) {
  const range = window.document.createRange();
  range.setStart(marker.firstChild, from);
  range.setEnd(marker.firstChild, to);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

const key = (value, init = {}) => keyboardEvent('keydown', value, init);

/** 附录 B 新键位只经公开挂载入口与既有 keydown 通道验收。 */
export async function runShortcutAuditContract({ check, lib, root, window }) {
  console.log('\n\x1b[36m▸ 附录 B 快捷键对账\x1b[0m');
  const pageSession = await lib.openEditor(
    new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-add-slide.pptx'))),
    { idPrefix: 'editor-shortcut-page-' },
  );
  const pageMount = document.createElement('div');
  document.body.append(pageMount);
  const pageView = pageSession.mount(pageMount, { mode: 'edit', textMode: 'svg' });
  const firstSlide = pageView.slideId;
  const firstChildren = pageSession.editor.doc.slides[firstSlide].children.filter((id) => {
    const record = pageSession.editor.doc.elements[id];
    return !record.meta.locked && !record.meta.hiddenByUser && record.meta.editable !== 'none';
  });
  const selectAll = pageView.element.dispatchEvent(key('a', { ctrlKey: true }));
  check('画布 Ctrl/Cmd+A 选中当前页全部直属可选元素且不写历史',
    !selectAll && pageSession.editor.selection.kind === 'elements'
      && pageSession.editor.selection.ids.join(',') === firstChildren.join(',')
      && pageSession.editor.selection.enteredGroup === null
      && pageSession.editor.history.undoCount === 0);

  const addSlide = pageView.element.dispatchEvent(key('m', { ctrlKey: true }));
  const addedSlide = pageSession.editor.doc.slideOrder.find((id) => id !== firstSlide);
  const siblingMount = document.createElement('div');
  document.body.append(siblingMount);
  const siblingView = pageSession.mount(siblingMount, {
    mode: 'edit', textMode: 'svg', slideId: addedSlide,
  });
  const pageUp = pageView.element.dispatchEvent(key('PageUp'));
  const movedUp = pageView.slideId === firstSlide && siblingView.slideId === addedSlide;
  const pageDown = pageView.element.dispatchEvent(key('PageDown'));
  const undoAdd = pageView.element.dispatchEvent(key('z', { ctrlKey: true }));
  const afterUndo = pageSession.editor.doc.slideOrder.length === 1
    && pageView.slideId === firstSlide && pageSession.editor.history.redoCount === 1;
  const redoAdd = pageView.element.dispatchEvent(key('y', { ctrlKey: true }));
  check('Ctrl/Cmd+M 沿用当前版式新建下一页，PageUp/Down 只切换事件视图',
    !addSlide && !!addedSlide && pageSession.editor.doc.slides[addedSlide]?.layoutId
      === pageSession.editor.doc.slides[firstSlide].layoutId
      && !pageUp && movedUp && !pageDown && !undoAdd && afterUndo && !redoAdd
      && pageSession.editor.history.undoCount === 1 && pageView.slideId === addedSlide
      && siblingView.slideId === firstSlide && pageSession.editor.selection.kind === 'none');
  const input = document.createElement('input');
  pageView.element.append(input);
  const selectionBeforeInput = pageSession.editor.selection;
  const pageBeforeInput = pageView.slideId;
  const yielded = input.dispatchEvent(key('a', { ctrlKey: true }))
    && input.dispatchEvent(key('m', { ctrlKey: true }))
    && input.dispatchEvent(key('PageUp'));
  check('文档快捷键让位后代控件且共享会话只回显收到事件的视图',
    yielded && JSON.stringify(pageSession.editor.selection) === JSON.stringify(selectionBeforeInput)
      && pageSession.editor.history.undoCount === 1 && pageView.slideId === pageBeforeInput
      && siblingView.slideId === firstSlide);
  pageView.setSlide(firstSlide);
  pageSession.editor.undo();
  siblingView.destroy();
  pageSession.dispose();
  pageMount.remove();
  siblingMount.remove();

  const unsupportedErrors = [];
  const unsupportedSession = await lib.openEditor(
    new Uint8Array(readFileSync(join(root, 'fixtures/sample.ppt'))),
    { idPrefix: 'editor-shortcut-unsupported-' },
  );
  const unsupportedMount = document.createElement('div');
  document.body.append(unsupportedMount);
  const unsupportedView = unsupportedSession.mount(unsupportedMount, {
    mode: 'edit', onError: (error) => unsupportedErrors.push(error),
  });
  const unsupportedPages = unsupportedSession.editor.doc.slideOrder.length;
  const unsupportedAdd = unsupportedView.element.dispatchEvent(key('m', { ctrlKey: true }));
  check('Ctrl/Cmd+M 对不可写 OOXML 文档显式报告能力错误且不写历史',
    !unsupportedAdd && unsupportedSession.editor.doc.slideOrder.length === unsupportedPages
      && unsupportedSession.editor.history.undoCount === 0
      && unsupportedErrors.length === 1
      && String(unsupportedErrors[0]).includes('OOXML'));
  unsupportedSession.dispose();
  unsupportedMount.remove();

  const textSession = await lib.openEditor(
    new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-text.pptx'))),
    { idPrefix: 'editor-shortcut-text-' },
  );
  const textMount = document.createElement('div');
  document.body.append(textMount);
  const sourceSlide = textSession.editor.doc.slideOrder[0];
  const duplicateSlide = [...textSession.editor.exec({
    type: 'DuplicateSlide', id: sourceSlide,
  }).createdSlides][0];
  textSession.editor.history.clear();
  textSession.editor.markSaved();
  const textView = textSession.mount(textMount, { mode: 'edit' });
  const record = Object.values(textSession.editor.doc.elements)
    .find((candidate) => candidate.src.name === '重复格式');
  textMount.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  let editable = textMount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const imePages = textSession.editor.doc.slideOrder.length;
  const imeHistory = textSession.editor.history.undoCount;
  editable.dispatchEvent(new window.CompositionEvent('compositionstart', {
    bubbles: true, composed: true,
  }));
  const imePageDown = editable.dispatchEvent(key('PageDown', { isComposing: true }));
  const imeAdd = editable.dispatchEvent(key('m', { ctrlKey: true, isComposing: true }));
  editable.dispatchEvent(new window.CompositionEvent('compositionend', {
    bubbles: true, composed: true,
  }));
  check('IME 组词期间页面快捷键让位且不切页、不写历史、不移除编辑面',
    imePageDown && imeAdd && textView.slideId === sourceSlide
      && textSession.editor.doc.slideOrder.length === imePages
      && textSession.editor.history.undoCount === imeHistory
      && !!textMount.querySelector(`[data-ppt-text-editor="${record.id}"]`));
  const pageDownFromText = editable.dispatchEvent(key('PageDown'));
  const duplicateRecord = textSession.editor.doc.slides[duplicateSlide].children
    .map((id) => textSession.editor.doc.elements[id])
    .find((candidate) => candidate.src.name === '重复格式');
  textMount.querySelector(`[data-edit-id="${duplicateRecord.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  editable = textMount.querySelector(`[data-ppt-text-editor="${duplicateRecord.id}"]`);
  const pageUpFromText = editable.dispatchEvent(key('PageUp'));
  check('文字编辑焦点仍经同一文档通道路由 PageUp/Down',
    !pageDownFromText && !pageUpFromText && textView.slideId === sourceSlide
      && !textMount.querySelector('[data-ppt-text-editor]'));
  textMount.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  editable = textMount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  let marker = editable.querySelector('[data-r="0.0"]');
  selectOffsets(window, marker, 0, 1);
  const sizeBefore = textView.queryRunProps().size.value;
  const grow = marker.dispatchEvent(key('>', { code: 'Period', ctrlKey: true, shiftKey: true }));
  const sizeAfterGrow = textView.queryRunProps().size.value;
  editable = textMount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  marker = editable.querySelector('[data-r="0.0"]');
  const shrink = marker.dispatchEvent(key('<', { code: 'Comma', ctrlKey: true, shiftKey: true }));
  check('Ctrl/Cmd+Shift+>/< 按字号档位增减并保持文字 Range',
    !grow && !shrink && sizeAfterGrow > sizeBefore
      && Math.abs(textView.queryRunProps().size.value - sizeBefore) < 1e-6
      && window.getSelection()?.rangeCount === 1 && !window.getSelection().getRangeAt(0).collapsed);

  const alignments = [
    ['e', 'center'], ['l', 'left'], ['r', 'right'], ['j', 'justify'],
  ];
  const aligned = alignments.every(([shortcut, expected]) => {
    editable = textMount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
    const accepted = editable.dispatchEvent(key(shortcut, { ctrlKey: true }));
    return !accepted && textSession.editor.effectiveElement(record.id).text.paragraphs[0].align === expected;
  });
  check('Ctrl/Cmd+E/L/R/J 分别设置当前文字选区的段落对齐', aligned);

  editable = textMount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const addFromText = editable.dispatchEvent(key('m', { ctrlKey: true }));
  const addedFromText = textView.slideId;
  const undoFromText = textView.element.dispatchEvent(key('z', { ctrlKey: true }));
  const textAddUndone = textView.slideId === sourceSlide
    && !textSession.editor.doc.slides[addedFromText];
  const redoFromText = textView.element.dispatchEvent(key('y', { ctrlKey: true }));
  const textAddRedone = textView.slideId === addedFromText
    && !!textSession.editor.doc.slides[addedFromText];
  textView.element.dispatchEvent(key('z', { ctrlKey: true }));
  check('文字编辑焦点的 Ctrl/Cmd+M 与撤销重做保持新页回显和单步历史',
    !addFromText && !undoFromText && !redoFromText && textAddUndone && textAddRedone
      && textView.slideId === sourceSlide && !textMount.querySelector('[data-ppt-text-editor]'));

  const mixedRecord = Object.values(textSession.editor.doc.elements)
    .find((candidate) => candidate.parent === sourceSlide && candidate.src.name === '中段格式');
  textSession.editor.exec({
    type: 'SetRunProps', id: mixedRecord.id,
    range: { from: { p: 0, r: 0, off: 2 }, to: { p: 0, r: 0, off: 4 } },
    props: { size: 32 },
  });
  textMount.querySelector(`[data-edit-id="${mixedRecord.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  editable = textMount.querySelector(`[data-ppt-text-editor="${mixedRecord.id}"]`);
  const mixedStart = editable.querySelector('[data-r="0.0"]').firstChild;
  const mixedEnd = editable.querySelector('[data-r="0.1"]').firstChild;
  const mixedRange = document.createRange();
  mixedRange.setStart(mixedStart, 1);
  mixedRange.setEnd(mixedEnd, 1);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(mixedRange);
  const mixedBefore = textSession.editor.effectiveElement(mixedRecord.id).text.paragraphs[0].runs;
  const mixedHistory = textSession.editor.history.undoCount;
  const mixedGrow = editable.dispatchEvent(key('>', {
    code: 'Period', ctrlKey: true, shiftKey: true,
  }));
  const mixedAfter = textSession.editor.effectiveElement(mixedRecord.id).text.paragraphs[0].runs;
  const mixedSelection = textSession.editor.selection;
  const mixedSelectionOffsets = mixedSelection.kind === 'text'
    ? [mixedSelection.anchor, mixedSelection.focus].map((position) => mixedAfter
      .slice(0, position.r).reduce((sum, run) => sum + run.text.length, 0) + position.off)
    : [];
  check('同段截断的混合字号按稳定线性区间逐 run 跨档且保持一个历史事务',
    !mixedGrow && mixedBefore.map((run) => run.text).join('') === 'ABCDE'
      && mixedBefore[0].size !== mixedBefore[1].size
      && mixedAfter.map((run) => run.text).join('') === 'ABCDE'
      && mixedAfter.map((run) => run.text).join(',') === 'A,B,C,D,E'
      && Math.abs(mixedAfter[0].size - mixedBefore[0].size) < 1e-6
      && mixedAfter[1].size > mixedBefore[0].size
      && mixedAfter[2].size > mixedBefore[1].size
      && Math.abs(mixedAfter[3].size - mixedBefore[1].size) < 1e-6
      && Math.abs(mixedAfter[4].size - mixedBefore[0].size) < 1e-6
      && textSession.editor.history.undoCount === mixedHistory + 1
      && mixedSelectionOffsets.join(',') === '1,3'
      && window.getSelection()?.rangeCount === 1 && !window.getSelection().getRangeAt(0).collapsed);
  textSession.editor.undo();
  textView.setSlide(sourceSlide);
  textMount.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );

  editable = textMount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  marker = editable.querySelector('[data-r="0.0"]');
  selectOffsets(window, marker, 1);
  const firstAll = editable.dispatchEvent(key('a', { ctrlKey: true }));
  const textSelection = textSession.editor.selection;
  const selectedText = textSelection.kind === 'text'
    && textSelection.anchor.p === 0 && textSelection.anchor.r === 0 && textSelection.anchor.off === 0
    && textSelection.focus.p === 0 && textSelection.focus.r === 2 && textSelection.focus.off === 1;
  editable = textMount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const secondAll = editable.dispatchEvent(key('a', { ctrlKey: true }));
  const pageSelection = textSession.editor.selection;
  check('文字内 Ctrl/Cmd+A 首次全选当前编辑面，再按一次退出并全选本页元素',
    !firstAll && selectedText && !secondAll && !textMount.querySelector('[data-ppt-text-editor]')
      && pageSelection.kind === 'elements'
      && pageSelection.ids.every((id) => textSession.editor.doc.elements[id].parent === textView.slideId)
      && pageSelection.ids.length > 0
      && pageSelection.enteredGroup === null);
  textSession.editor.exec({ type: 'RemoveSlide', id: duplicateSlide });
  textSession.editor.history.clear();
  textSession.editor.markSaved();
  textSession.dispose();
  textMount.remove();
}
