import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function caret(window, marker, offset = 1) {
  const range = window.document.createRange();
  range.setStart(marker.firstChild, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

const tab = (window, shiftKey = false) => new window.KeyboardEvent('keydown', {
  key: 'Tab', shiftKey, bubbles: true, composed: true, cancelable: true,
});

async function mountList(lib, root, idPrefix, textMode) {
  const session = await lib.openEditor(
    new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-list-level.pptx'))),
    { idPrefix },
  );
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === '多级列表');
  const container = document.createElement('div');
  document.body.append(container);
  const view = session.mount(container, { mode: 'edit', textMode });
  container.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  return { session, record, container, view };
}

/** Tab 只能在普通文字态改级；表格导航继续由既有契约独占。 */
export async function runListLevelEditorContract({ check, lib, root, window }) {
  console.log('\n\x1b[36m▸ DOM 文本列表升降级\x1b[0m');
  const html = await mountList(lib, root, 'editor-list-level-html-', 'html');
  let editable = html.container.querySelector('[data-ppt-text-editor]');
  caret(window, editable.querySelector('[data-r="2.0"]'));
  const beforeRoot = editable;
  const promote = tab(window);
  editable.dispatchEvent(promote);
  editable = html.container.querySelector('[data-ppt-text-editor]');
  const selection = html.session.editor.selection;
  check('普通文字 Tab 阻止焦点逃逸、升一级并触发编辑面重排',
    promote.defaultPrevented && editable !== beforeRoot
      && html.session.editor.effectiveElement(html.record.id).text.paragraphs[2].lvl === 2
      && html.session.editor.history.undoCount === 1
      && selection.kind === 'text' && selection.anchor.p === 2 && selection.focus.p === 2);

  const demote = tab(window, true);
  editable.dispatchEvent(demote);
  check('Shift+Tab 降一级且每次按键只形成一个历史单元',
    demote.defaultPrevented
      && html.session.editor.effectiveElement(html.record.id).text.paragraphs[2].lvl === 1
      && html.session.editor.history.undoCount === 2);

  editable = html.container.querySelector('[data-ppt-text-editor]');
  caret(window, editable.querySelector('[data-r="0.0"]'));
  const lowerHistory = html.session.editor.history.undoCount;
  const lower = tab(window, true);
  editable.dispatchEvent(lower);
  editable = html.container.querySelector('[data-ppt-text-editor]');
  caret(window, editable.querySelector('[data-r="6.0"]'));
  const upper = tab(window);
  editable.dispatchEvent(upper);
  check('0/8 边界按键被消费但不制造模型历史',
    lower.defaultPrevented && upper.defaultPrevented
      && html.session.editor.history.undoCount === lowerHistory
      && html.session.editor.effectiveElement(html.record.id).text.paragraphs[0].lvl === 0
      && html.session.editor.effectiveElement(html.record.id).text.paragraphs[6].lvl === 8);
  html.view.destroy(); html.session.dispose(); html.container.remove();

  const engine = await mountList(lib, root, 'editor-list-level-engine-', 'svg');
  editable = engine.container.querySelector('[data-ppt-text-editor]');
  caret(window, editable.querySelector('[data-r="2.0"]'));
  const engineDemote = tab(window, true);
  editable.dispatchEvent(engineDemote);
  check('engine 行盒文字态复用同一降级命令与选区 seam',
    !!engine.container.querySelector('[data-layout="engine"]')
      && engineDemote.defaultPrevented
      && engine.session.editor.effectiveElement(engine.record.id).text.paragraphs[2].lvl === 0
      && engine.session.editor.selection.kind === 'text'
      && engine.session.editor.selection.anchor.p === 2);
  engine.view.destroy(); engine.session.dispose(); engine.container.remove();
}
