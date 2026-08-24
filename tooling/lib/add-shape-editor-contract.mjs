import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 外置工具栏调用 headless 命令后，两种视图都只能复用既有增量 DOM 与文字入口。 */
export async function runAddShapeEditorContract({ check, lib, root, window }) {
  console.log('\n\x1b[36m▸ AddShape 增量 DOM 与文字入口\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-add-shape.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-add-shape-' });
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  document.body.append(editMount, viewMount);
  const editView = session.mount(editMount, { mode: 'edit', textMode: 'svg', snapping: false });
  const viewView = session.mount(viewMount, { mode: 'view', textMode: 'svg', snapping: false });
  const slideId = editView.slideId;
  const siblingId = session.editor.doc.slides[slideId].children[0];
  const editStatic = editMount.querySelector('[data-ppt-layer="static"]');
  const viewStatic = viewMount.querySelector('[data-ppt-layer="static"]');
  const editSvg = editStatic.querySelector('svg');
  const viewSvg = viewStatic.querySelector('svg');
  const editSibling = editStatic.querySelector(`[data-edit-id="${siblingId}"]`);
  const viewSibling = viewStatic.querySelector(`[data-edit-id="${siblingId}"]`);
  session.editor.exec({
    type: 'AddShape', slideId, preset: 'hexagon', rect: { x: 440, y: 180, w: 240, h: 150 },
  });
  const id = session.editor.selection.kind === 'elements' ? session.editor.selection.ids[0] : null;
  const editPartition = editStatic.querySelector(`[data-edit-id="${id}"]`);
  const viewPartition = viewStatic.querySelector(`[data-edit-id="${id}"]`);
  check('新增形状在编辑/查看视图同步增量插入且不重建页面或既有兄弟',
    !!id && !!editPartition && !!viewPartition
      && editStatic.querySelector('svg') === editSvg && viewStatic.querySelector('svg') === viewSvg
      && editStatic.querySelector(`[data-edit-id="${siblingId}"]`) === editSibling
      && viewStatic.querySelector(`[data-edit-id="${siblingId}"]`) === viewSibling
      && !!editMount.querySelector(`[data-edit-selection-id="${id}"]`)
      && viewMount.querySelector('[data-ppt-layer="interaction"]').style.display === 'none');

  editPartition.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));
  const editable = editMount.querySelector(`[data-ppt-text-editor="${id}"]`);
  check('新增空形状可直接复用既有双击文字编辑面',
    editable?.getAttribute('contenteditable') === 'true'
      && session.editor.selection.kind === 'text' && session.editor.selection.id === id);
  session.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
  const beforeMove = editStatic.querySelector(`[data-edit-id="${id}"]`);
  session.editor.exec({ type: 'SetXfrm', id, x: 480 });
  check('新增形状继续复用既有变换、撤销与分区替换路径',
    session.editor.effectiveElement(id).x === 480
      && editStatic.querySelector(`[data-edit-id="${id}"]`) !== beforeMove
      && editStatic.querySelector(`[data-edit-id="${siblingId}"]`) === editSibling);
  session.editor.undo();
  session.editor.undo();
  check('撤销新增只移除新分区并保留查看/编辑视图兄弟身份',
    !session.editor.doc.elements[id]
      && !editStatic.querySelector(`[data-edit-id="${id}"]`)
      && !viewStatic.querySelector(`[data-edit-id="${id}"]`)
      && editStatic.querySelector(`[data-edit-id="${siblingId}"]`) === editSibling
      && viewStatic.querySelector(`[data-edit-id="${siblingId}"]`) === viewSibling);
  editView.destroy();
  viewView.destroy();
  session.dispose();
  editMount.remove();
  viewMount.remove();
}
