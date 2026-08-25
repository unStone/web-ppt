import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 页面级视觉属性重建整页；纯目录属性与无关页面保持 DOM 身份。 */
export async function runSlidePropertiesEditorContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 页面属性多视图与整页增量边界\x1b[0m');
  if (!check('editor 发布入口转出页面属性查询',
    typeof lib.querySlideBackground === 'function'
      && typeof lib.querySlideHidden === 'function')) return;
  const bytes = new Uint8Array(readFileSync(
    join(root, 'fixtures/sample-editor-slide-properties.pptx'),
  ));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-slide-properties-' });
  const [first, second] = session.editor.doc.slideOrder;
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  const otherMount = document.createElement('div');
  const editView = session.mount(editMount, { slideId: first, mode: 'edit', textMode: 'svg' });
  const viewView = session.mount(viewMount, { slideId: first, mode: 'view', textMode: 'svg' });
  const otherView = session.mount(otherMount, { slideId: second, mode: 'edit', textMode: 'svg' });
  const editStatic = editMount.querySelector('[data-ppt-layer="static"]');
  const viewStatic = viewMount.querySelector('[data-ppt-layer="static"]');
  const otherStatic = otherMount.querySelector('[data-ppt-layer="static"]');
  const editBefore = editStatic.querySelector('svg');
  const viewBefore = viewStatic.querySelector('svg');
  const otherBefore = otherStatic.querySelector('svg');
  session.editor.exec({
    type: 'SetBackground', id: first,
    fill: {
      type: 'gradient', angle: 45,
      stops: [{ pos: 0, color: '#DBEAFE' }, { pos: 1, color: '#1D4ED8' }],
    },
  });
  const editAfter = editStatic.querySelector('svg');
  const viewAfter = viewStatic.querySelector('svg');
  check('同页 edit/view 视图重建背景，无关页保持完整 SVG 身份',
    editAfter !== editBefore && viewAfter !== viewBefore
      && otherStatic.querySelector('svg') === otherBefore
      && editAfter?.querySelector('linearGradient')
      && lib.querySlideBackground(session.editor.doc, [first]).direct);

  session.editor.exec({ type: 'SetHidden', id: first, v: true });
  check('隐藏状态同步公开查询但不重建视觉不变的 SVG',
    lib.querySlideHidden(session.editor.doc, [first]).value === true
      && editStatic.querySelector('svg') === editAfter
      && viewStatic.querySelector('svg') === viewAfter
      && otherStatic.querySelector('svg') === otherBefore);
  editView.destroy();
  viewView.destroy();
  otherView.destroy();
  session.dispose();
}
