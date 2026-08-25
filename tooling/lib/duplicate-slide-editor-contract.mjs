import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pageNumber = (root) => [...root.querySelectorAll('text, foreignObject')]
  .map((node) => node.textContent?.trim()).find((text) => /^\d+$/.test(text ?? ''));

/** 页面复制不抢当前视图；框架从 createdSlides 获得新页并可独立挂载。 */
export async function runDuplicateSlideEditorContract({ check, lib, root, window }) {
  console.log('\n\x1b[36m▸ DuplicateSlide 多视图、订阅与 DOM 身份\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-duplicate-slide.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-duplicate-slide-' });
  const source = [...session.editor.doc.slideOrder];
  const sourceMount = document.createElement('div');
  const successorMount = document.createElement('div');
  const duplicateMount = document.createElement('div');
  document.body.append(sourceMount, successorMount, duplicateMount);
  const sourceView = session.mount(sourceMount, {
    slideId: source[1], mode: 'edit', textMode: 'svg',
  });
  const successorView = session.mount(successorMount, {
    slideId: source[2], mode: 'view', textMode: 'svg',
  });
  const sourceStatic = sourceMount.querySelector('[data-ppt-layer="static"]');
  const successorStatic = successorMount.querySelector('[data-ppt-layer="static"]');
  const sourceSvg = sourceStatic.querySelector('svg');
  const successorSvg = successorStatic.querySelector('svg');
  const sourceTextId = session.editor.doc.slides[source[1]].children[0];
  sourceMount.querySelector(`[data-edit-id="${sourceTextId}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  const events = [];
  const unsubscribe = session.editor.subscribe((change) => events.push(change));

  const result = session.editor.exec({ type: 'DuplicateSlide', id: source[1] });
  const duplicateId = [...result.createdSlides][0];
  const duplicateView = session.mount(duplicateMount, {
    slideId: duplicateId, mode: 'edit', textMode: 'svg',
  });
  check('复制不会抢走来源 view/edit，活动文字面与静态 SVG 身份保持',
    sourceView.slideId === source[1]
      && sourceMount.querySelector('[data-ppt-text-editor]')
      && sourceStatic.querySelector('svg') === sourceSvg);
  check('后续 view 只增量刷新动态页码且完整 SVG 身份保持',
    successorView.slideId === source[2]
      && successorStatic.querySelector('svg') === successorSvg
      && pageNumber(successorStatic) === '4');
  check('框架订阅只报告新页，副本可按公开身份独立挂载编辑',
    events.at(-1)?.createdSlides.has(duplicateId)
      && !events.at(-1)?.removedSlides.size && !events.at(-1)?.movedSlides.size
      && duplicateView.slideId === duplicateId
      && duplicateMount.textContent.includes('可删除页面 2')
      && pageNumber(duplicateMount) === '3'
      && session.editor.doc.slides[duplicateId].children.every((id) =>
        !session.editor.doc.slides[source[1]].children.includes(id)));

  const duplicateStatic = duplicateMount.querySelector('[data-ppt-layer="static"]');
  const duplicateSvg = duplicateStatic.querySelector('svg');
  const duplicateElement = session.editor.doc.slides[duplicateId].children[0];
  const sourceElementNode = sourceMount.querySelector(`[data-edit-id="${sourceTextId}"]`);
  session.editor.exec({
    type: 'SetXfrm', id: duplicateElement,
    x: session.editor.doc.elements[duplicateElement].src.x + 20,
  });
  check('编辑副本只替换副本元素分区，不改变来源 DOM',
    duplicateStatic.querySelector('svg') === duplicateSvg
      && sourceMount.querySelector(`[data-edit-id="${sourceTextId}"]`) === sourceElementNode);

  session.editor.undo();
  const undo = session.editor.undo();
  check('撤销复制时挂在副本的视图按公开删除 fallback 切到原后继',
    undo?.removedSlides.has(duplicateId)
      && undo.removedSlideFallbacks.get(duplicateId) === source[2]
      && duplicateView.slideId === source[2]
      && duplicateMount.textContent.includes('可删除页面 3'));

  unsubscribe();
  session.dispose();
  sourceMount.remove();
  successorMount.remove();
  duplicateMount.remove();
}
