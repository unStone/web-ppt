import { readFileSync } from 'node:fs';
import { join } from 'node:path';

async function runMode({ check, lib, root, window, textMode }) {
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-body-props.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: `body-props-dom-${textMode}-` });
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === '文字方向-水平');
  const sibling = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === '文字方向-竖排');
  const container = document.createElement('div');
  document.body.append(container);
  const view = session.mount(container, { mode: 'edit', textMode });
  session.editor.select({ kind: 'elements', ids: [record.id], enteredGroup: null });
  const partition = container.querySelector(`[data-edit-id="${record.id}"]`);
  const siblingPartition = container.querySelector(`[data-edit-id="${sibling.id}"]`);
  const queried = view.queryBodyProps();
  const changed = view.setBodyProps({
    anchor: 'bottom', insets: [2, 3, 4, 5], wrap: false, columns: 2, columnGap: 12,
  });
  check(`${textMode} 元素选区属性 seam 同步模型、静态分区与选择框`,
    queried?.vert === 'horz' && changed
      && view.queryBodyProps()?.anchor === 'bottom'
      && session.editor.effectiveElement(record.id).text.columns === 2
      && container.querySelector(`[data-edit-id="${record.id}"]`) !== partition
      && container.querySelector(`[data-edit-id="${sibling.id}"]`) === siblingPartition
      && !!container.querySelector('[data-edit-selection-frame]'));

  container.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  const editorBefore = container.querySelector('[data-ppt-text-editor]');
  const textChanged = view.setBodyProps({ vert: 'vert270', autoFit: 'normal' });
  const editorAfter = container.querySelector('[data-ppt-text-editor]');
  check(`${textMode} 文字选区属性 seam 重建编辑面且保持文字态`,
    textChanged && editorAfter && editorAfter !== editorBefore
      && view.queryBodyProps()?.vert === 'vert270'
      && editorAfter.querySelector('[data-autofit="normal"]')
      && session.editor.selection.kind === 'text');

  view.setMode('view');
  const viewRejected = !view.setBodyProps({ anchor: 'top' });
  view.setMode('edit');
  session.editor.select({ kind: 'elements', ids: [record.id, sibling.id], enteredGroup: null });
  check(`${textMode} view 模式与多选不允许文字框属性写入`,
    viewRejected && view.queryBodyProps() === null
      && view.setBodyProps({ anchor: 'top' }) === false);
  view.destroy();
  session.dispose();
  container.remove();
}

export async function runBodyPropsEditorContract(options) {
  console.log('\n\x1b[36m▸ DOM 文字框属性\x1b[0m');
  await runMode({ ...options, textMode: 'html' });
  await runMode({ ...options, textMode: 'svg' });
}
