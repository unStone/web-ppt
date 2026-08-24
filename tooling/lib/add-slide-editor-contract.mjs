import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 外置工具栏新增页后，edit/view 视图只消费公开结果与既有 setSlide seam。 */
export async function runAddSlideEditorContract({ check, lib, root, window }) {
  console.log('\n\x1b[36m▸ AddSlide 多视图、占位符交互与文字入口\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-add-slide.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-add-slide-' });
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  document.body.append(editMount, viewMount);
  const editView = session.mount(editMount, { mode: 'edit', textMode: 'svg', snapping: false });
  const viewView = session.mount(viewMount, { mode: 'view', textMode: 'svg', snapping: false });
  const firstSlide = session.editor.doc.slideOrder[0];
  const layoutId = session.editor.doc.layoutOrder.find((id) =>
    session.editor.doc.layouts[id].name === '标题和正文');
  const result = session.editor.exec({ type: 'AddSlide', layoutId, at: { after: firstSlide } });
  const slideId = [...result.createdSlides][0];
  editView.setSlide(slideId);
  viewView.setSlide(slideId);
  const placeholders = session.editor.doc.slides[slideId].children.map((id) => session.editor.doc.elements[id])
    .filter((record) => ['title', 'body'].includes(record.meta.ph?.type));
  const mediaPlaceholder = session.editor.doc.slides[slideId].children.map((id) => session.editor.doc.elements[id])
    .find((record) => record.meta.ph?.type === 'pic');
  const editInteraction = editMount.querySelector('[data-ppt-layer="interaction"]');
  const viewInteraction = viewMount.querySelector('[data-ppt-layer="interaction"]');
  check('公开 createdSlides + setSlide 让 edit/view 同步切到新页且共用静态预览',
    editView.slideId === slideId && viewView.slideId === slideId
      && editMount.querySelector('[data-ppt-layer="static"]').textContent
        === viewMount.querySelector('[data-ppt-layer="static"]').textContent
      && editMount.querySelector('[data-edit-id]') && viewMount.querySelector('[data-edit-id]'));
  check('编辑模式只在 interaction 层显示三个空占位符提示，view 模式没有辅助节点',
    placeholders.length === 2
      && editInteraction.querySelectorAll('[data-edit-placeholder-id]').length === 3
      && !viewInteraction.querySelector('[data-edit-placeholder-id]')
      && viewInteraction.style.display === 'none'
      && !editMount.querySelector('[data-ppt-layer="static"] [data-edit-placeholder-id]'));
  const pictureHit = editInteraction.querySelector(`[data-edit-placeholder-id="${mediaPlaceholder.id}"]`);
  pictureHit.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));
  const pictureInput = editMount.querySelector('[data-web-ppt-image-input]');
  check('图片占位符打开受限文件选择器而不伪装成文字入口',
    !!mediaPlaceholder && pictureHit?.dataset.editPlaceholderType === 'pic'
      && editInteraction.textContent.includes('添加图片') && !!pictureInput
      && !editMount.querySelector(`[data-ppt-text-editor="${mediaPlaceholder.id}"]`));
  pictureInput?.dispatchEvent(new window.Event('cancel'));

  const title = placeholders.find((record) => record.meta.ph.type === 'title');
  const hintBefore = editInteraction.querySelector('[data-edit-placeholder-layer]');
  const pointsBefore = editInteraction.querySelector(`[data-edit-placeholder-id="${title.id}"]`)
    .getAttribute('points');
  session.editor.select({ kind: 'elements', ids: [title.id], enteredGroup: null });
  check('仅选区变化不会重建占位符提示 DOM',
    editInteraction.querySelector('[data-edit-placeholder-layer]') === hintBefore);
  session.editor.exec({ type: 'SetXfrm', id: title.id, x: title.src.x + 5 });
  check('占位符几何变化会刷新 interaction 命中区域',
    editInteraction.querySelector('[data-edit-placeholder-layer]') !== hintBefore
      && editInteraction.querySelector(`[data-edit-placeholder-id="${title.id}"]`)
        .getAttribute('points') !== pointsBefore);

  const hit = editInteraction.querySelector(`[data-edit-placeholder-id="${title.id}"]`);
  hit.dispatchEvent(new window.PointerEvent('pointerdown', {
    bubbles: true, composed: true, cancelable: true, pointerType: 'mouse', pointerId: 701,
    isPrimary: true, button: 0, buttons: 1,
  }));
  hit.dispatchEvent(new window.PointerEvent('pointerup', {
    bubbles: true, composed: true, cancelable: true, pointerType: 'mouse', pointerId: 701,
    isPrimary: true, button: 0, buttons: 0,
  }));
  check('空占位符的 interaction 命中进入既有元素选区',
    session.editor.selection.kind === 'elements' && session.editor.selection.ids[0] === title.id);
  hit.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));
  check('双击空占位符直接复用现有文字编辑面',
    !!editMount.querySelector(`[data-ppt-text-editor="${title.id}"]`)
      && session.editor.selection.kind === 'text' && session.editor.selection.id === title.id);

  session.editor.exec({
    type: 'EditText', id: title.id,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '直接输入标题',
    }],
  });
  session.editor.select({ kind: 'elements', ids: [title.id], enteredGroup: null });
  check('输入后辅助框消失且 edit/view 静态层同步显示真实文字',
    !editInteraction.querySelector(`[data-edit-placeholder-id="${title.id}"]`)
      && editMount.querySelector('[data-ppt-layer="static"]').textContent.includes('直接输入标题')
      && viewMount.querySelector('[data-ppt-layer="static"]').textContent.includes('直接输入标题'));

  session.editor.undo();
  session.editor.undo();
  session.editor.undo();
  check('撤销新增页时所有停留在该页的视图安全回到现有页',
    editView.slideId === firstSlide && viewView.slideId === firstSlide
      && !session.editor.doc.slides[slideId]);
  session.dispose();
  editMount.remove();
  viewMount.remove();
}
