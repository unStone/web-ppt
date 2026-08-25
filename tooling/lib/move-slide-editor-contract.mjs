import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 框架适配只依赖订阅事件与稳定 SlideId；DOM 视图不得另维护页序副本。 */
export async function runMoveSlideEditorContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ MoveSlide 多视图与动态字段上屏\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-add-slide.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-move-slide-' });
  const original = session.editor.doc.slideOrder[0];
  const layoutId = session.editor.doc.layoutOrder.find((id) =>
    session.editor.doc.layouts[id].name === '标题和正文');
  const firstAdded = [...session.editor.exec({
    type: 'AddSlide', layoutId, at: { after: original },
  }).createdSlides][0];
  const secondAdded = [...session.editor.exec({
    type: 'AddSlide', layoutId, at: { after: firstAdded },
  }).createdSlides][0];
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  document.body.append(editMount, viewMount);
  const editView = session.mount(editMount, { slideId: firstAdded, mode: 'edit', textMode: 'svg' });
  const viewView = session.mount(viewMount, { slideId: secondAdded, mode: 'view', textMode: 'svg' });
  const editStatic = editMount.querySelector('[data-ppt-layer="static"]');
  const viewStatic = viewMount.querySelector('[data-ppt-layer="static"]');
  const editSvg = editStatic.querySelector('svg');
  const viewSvg = viewStatic.querySelector('svg');
  const title = session.editor.doc.slides[firstAdded].children.find((id) =>
    session.editor.doc.elements[id].meta.ph?.type === 'title');
  session.editor.select({ kind: 'elements', ids: [title], enteredGroup: null });
  const events = [];
  const unsubscribe = session.editor.subscribe((change) => events.push(change));

  session.editor.exec({ type: 'MoveSlide', id: secondAdded, at: { after: null } });
  check('edit/view 保持稳定页身份并增量刷新各自页码字段',
    editView.slideId === firstAdded && viewView.slideId === secondAdded
      && /第\s*3\s*页/.test(editStatic.textContent) && /第\s*1\s*页/.test(viewStatic.textContent)
      && editStatic.querySelector('svg') === editSvg && viewStatic.querySelector('svg') === viewSvg
      && session.editor.selection.ids?.[0] === title,
  `edit=${editView.slideId}/${editStatic.textContent} view=${viewView.slideId}/${viewStatic.textContent}`
    + ` roots=${editStatic.querySelector('svg') === editSvg}/${viewStatic.querySelector('svg') === viewSvg}`
    + ` selection=${session.editor.selection.ids?.[0]}/${title}`);
  check('框架订阅从 movedSlides 识别页序变化而不收到伪造的增删事件',
    events.at(-1)?.movedSlides.has(secondAdded)
      && events.at(-1)?.createdSlides.size === 0 && events.at(-1)?.removedSlides.size === 0);

  unsubscribe();
  session.dispose();
  editMount.remove();
  viewMount.remove();
}
