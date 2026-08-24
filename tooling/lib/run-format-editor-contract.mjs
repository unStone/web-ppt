import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function selectOffsets(window, marker, from, to = from) {
  const text = marker.firstChild;
  const range = window.document.createRange();
  range.setStart(text, from);
  range.setEnd(text, to);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 从发布挂载入口验证字符格式的真实 Range 与浏览器输入生命周期。 */
export async function runRunFormatEditorContract({ check, lib, root, window }) {
  console.log('\n\x1b[36m▸ DOM 文字字符格式\x1b[0m');
  const session = await lib.openEditor(
    new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-text.pptx'))),
    { idPrefix: 'editor-run-format-' },
  );
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === '重复格式');
  const container = document.createElement('div');
  const secondaryContainer = document.createElement('div');
  const toolbar = document.createElement('div');
  const formatButton = document.createElement('button');
  toolbar.append(formatButton);
  document.body.append(container, secondaryContainer, toolbar);
  const view = session.mount(container, { mode: 'edit' });
  const secondaryView = session.mount(secondaryContainer, { mode: 'view' });
  const unregisterToolbar = view.registerTextUi(toolbar);
  container.querySelector(`[data-edit-id="${record.id}"]`)
    .dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));

  let editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  let marker = editable.querySelector('[data-r="0.0"]');
  selectOffsets(window, marker, 0, 1);
  marker.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, composed: true, button: 0 }));
  const publicSelection = session.editor.selection;
  formatButton.dispatchEvent(new window.PointerEvent('pointerdown', {
    bubbles: true, composed: true, button: 0, isPrimary: true,
  }));
  const secondaryBefore = secondaryContainer.querySelector(`[data-edit-id="${record.id}"]`)?.outerHTML;
  session.editor.exec({
    type: 'SetRunProps', id: record.id,
    range: { from: publicSelection.anchor, to: publicSelection.focus }, props: { strike: true },
  });
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  let publicRange = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
  check('DOM Range 同步到公开 selection 且外部命令保持当前选区',
    publicSelection.kind === 'text' && publicSelection.anchor.off === 0 && publicSelection.focus.off === 1
      && session.editor.effectiveElement(record.id).text.paragraphs[0].runs[0].strike
      && !publicRange?.collapsed && !!container.querySelector(`[data-ppt-text-editor="${record.id}"]`)
      && view.queryRunProps()?.strike.value === true);
  check('headless 字符格式事务同步刷新同会话的其它挂载视图',
    secondaryContainer.querySelector(`[data-edit-id="${record.id}"]`)?.outerHTML !== secondaryBefore);
  session.editor.undo();
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  marker = editable.querySelector('[data-r="0.0"]');
  selectOffsets(window, marker, 0, 1);
  const bold = new window.InputEvent('beforeinput', {
    bubbles: true, composed: true, cancelable: true, inputType: 'formatBold',
  });
  marker.dispatchEvent(bold);
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const selected = session.editor.effectiveElement(record.id).text.paragraphs[0].runs[0];
  const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
  check('formatBold 受控格式化真实选区并在重渲后保留 Range',
    bold.defaultPrevented && selected.b === true && !range?.collapsed
      && session.editor.selection.kind === 'text' && session.editor.history.undoCount === 1);

  session.editor.undo();
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  marker = editable.querySelector('[data-r="0.0"]');
  selectOffsets(window, marker, 0);
  const publicPending = view.setRunProps({ font: 'Noto Sans' });
  const pendingFontState = view.queryRunProps()?.font;
  const shortcut = new window.KeyboardEvent('keydown', {
    bubbles: true, composed: true, cancelable: true, key: 'b', ctrlKey: true,
  });
  marker.dispatchEvent(shortcut);
  const beforeTypingHistory = session.editor.history.undoCount;
  marker.dispatchEvent(new window.InputEvent('beforeinput', {
    bubbles: true, composed: true, cancelable: true, inputType: 'insertText', data: '新',
  }));
  const typedRuns = session.editor.effectiveElement(record.id).text.paragraphs[0].runs;
  check('折叠光标快捷键只设置待输入格式且文字与格式原子提交',
    publicPending && pendingFontState?.value === 'Noto Sans' && !pendingFontState.mixed
      && shortcut.defaultPrevented && beforeTypingHistory === 0
      && session.editor.history.undoCount === 1
      && typedRuns.map((run) => run.text).join('') === '新同同同'
      && typedRuns[0].text === '新' && typedRuns[0].b === true && typedRuns[0].fonts[0] === 'Noto Sans'
      && typedRuns[1].text === '同' && typedRuns[1].b === false);

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const italic = new window.InputEvent('beforeinput', {
    bubbles: true, composed: true, cancelable: true, inputType: 'formatItalic',
  });
  editable.dispatchEvent(italic);
  editable.dispatchEvent(new window.InputEvent('beforeinput', {
    bubbles: true, composed: true, cancelable: true, inputType: 'insertText', data: '斜',
  }));
  const afterItalic = session.editor.effectiveElement(record.id).text.paragraphs[0].runs;
  check('折叠光标 beforeinput 格式可叠加到后续输入',
    italic.defaultPrevented && afterItalic.some((run) => run.text === '斜' && run.b && run.i));

  const saved = await session.editor.save();
  const reopened = await lib.openEditor(saved, { idPrefix: 'editor-run-format-reopen-' });
  const reopenedRecord = Object.values(reopened.editor.doc.elements)
    .find((candidate) => candidate.src.name === '重复格式');
  const reopenedRuns = reopened.editor.effectiveElement(reopenedRecord.id).text.paragraphs[0].runs;
  check('DOM 待输入格式写回 OOXML 后重开仍保持文字与字符格式',
    reopenedRuns.map((run) => run.text).join('') === '新斜同同同'
      && reopenedRuns.some((run) => run.text === '新' && run.b && run.fonts[0] === 'Noto Sans')
      && reopenedRuns.some((run) => run.text === '斜' && run.b && run.i
        && run.fonts[0] === 'Noto Sans'));
  reopened.dispose();

  view.setMode('view');
  check('view 模式关闭输入所有权且不能误触视图字符格式命令',
    view.queryRunProps() === null && view.setRunProps({ b: false }) === false);

  unregisterToolbar();
  secondaryView.destroy();
  view.destroy();
  session.dispose();
  container.remove();
  secondaryContainer.remove();
  toolbar.remove();
}
