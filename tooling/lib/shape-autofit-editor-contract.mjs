import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function caretAtEnd(window, root) {
  const marker = [...root.querySelectorAll('[data-r]')].at(-1);
  const walker = window.document.createTreeWalker(marker, window.NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let last = node;
  while (node) { last = node; node = walker.nextNode(); }
  const range = window.document.createRange();
  range.setStart(last ?? marker, last?.textContent.length ?? marker.childNodes.length);
  range.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
}

const pointsOf = (node) => node.getAttribute('points').split(' ').map((value) => {
  const [x, y] = value.split(',').map(Number);
  return { x, y };
});

const expectedCorners = (edit, editor, id) => {
  const element = editor.effectiveElement(id);
  return [[0, 0], [element.w, 0], [element.w, element.h], [0, element.h]]
    .map(([x, y]) => edit.elementFrameToSlidePoint(editor.doc, id, { x, y }));
};

const nearCorners = (left, right) => left.length === right.length && left.every((point, index) =>
  Math.hypot(point.x - right[index].x, point.y - right[index].y) <= 1e-6);

async function runMode({ check, edit, lib, root, window, textMode }) {
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-sp-autofit.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: `shape-autofit-dom-${textMode}-` });
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === 'sp-autofit-rotated');
  const container = document.createElement('div');
  document.body.append(container);
  const view = session.mount(container, { mode: 'edit', textMode });
  let partition = container.querySelector(`[data-edit-id="${record.id}"]`);
  partition.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));
  let editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const initialHeight = session.editor.effectiveElement(record.id).h;
  caretAtEnd(window, editable);
  const event = new window.InputEvent('beforeinput', {
    inputType: 'insertText', data: '编辑面同步增高，'.repeat(70),
    bubbles: true, composed: true, cancelable: true,
  });
  editable.dispatchEvent(event);
  const effective = session.editor.effectiveElement(record.id);
  const nextPartition = container.querySelector(`[data-edit-id="${record.id}"]`);
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const hidden = textMode === 'svg'
    ? [...nextPartition.querySelectorAll('text')].every((node) => node.style.visibility === 'hidden')
    : [...nextPartition.querySelectorAll('foreignObject')].every((node) => node.style.visibility === 'hidden');
  const caretRestored = window.getSelection().isCollapsed
    && editable.contains(window.getSelection().anchorNode);
  const editingOutline = container.querySelector('[data-edit-selection-frame]');
  check(`${textMode} 输入同步更新模型、静态分区与文字层高度`,
    event.defaultPrevented && effective.h > initialHeight
      && Number.parseFloat(editable.style.height) === effective.h
      && nextPartition !== partition
      && caretRestored && hidden && !!editingOutline
      && nearCorners(pointsOf(editingOutline), expectedCorners(edit, session.editor, record.id)),
  `h=${initialHeight}/${effective.h}/${editable?.style.height} prevented=${event.defaultPrevented}`
    + ` partition=${nextPartition !== partition} caret=${caretRestored} hidden=${hidden}`);

  editable.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, composed: true, cancelable: true,
  }));
  let outline = container.querySelector('[data-edit-selection-frame]');
  check(`${textMode} 退出文字态后静态预览与选框使用同一有效几何`,
    !container.querySelector('[data-ppt-text-editor]')
      && !!outline
      && nearCorners(pointsOf(outline), expectedCorners(edit, session.editor, record.id)));

  const grownHeight = effective.h;
  session.editor.undo();
  const undoHeight = session.editor.effectiveElement(record.id).h;
  session.editor.select({ kind: 'elements', ids: [record.id], enteredGroup: null });
  session.editor.redo();
  const redoHeight = session.editor.effectiveElement(record.id).h;
  session.editor.select({ kind: 'elements', ids: [record.id], enteredGroup: null });
  outline = container.querySelector('[data-edit-selection-frame]');
  check(`${textMode} 撤销与重做同步恢复静态预览及选框几何`,
    undoHeight === initialHeight && redoHeight === grownHeight
      && !!outline && nearCorners(pointsOf(outline), expectedCorners(edit, session.editor, record.id)),
  `h=${initialHeight}/${undoHeight}/${redoHeight}/${grownHeight} outline=${!!outline}`);
  view.destroy();
  session.dispose();
  container.remove();
}

export async function runShapeAutofitEditorContract(options) {
  console.log('\n\x1b[36m▸ DOM spAutoFit 文字形状改高\x1b[0m');
  await runMode({ ...options, textMode: 'html' });
  await runMode({ ...options, textMode: 'svg' });
}
