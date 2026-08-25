import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pageNumber = (root) => [...root.querySelectorAll('text, foreignObject')]
  .map((node) => node.textContent?.trim()).find((text) => /^\d+$/.test(text ?? ''));

/** 删除当前页时，每个视图只依赖公开 fallback 切页；其余视图保持稳定页与 DOM。 */
export async function runRemoveSlideEditorContract({ check, lib, root, window }) {
  console.log('\n\x1b[36m▸ RemoveSlide 多视图 fallback 与 DOM 身份\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-remove-slide.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-remove-slide-' });
  const source = [...session.editor.doc.slideOrder];
  const editMount = document.createElement('div');
  const successorMount = document.createElement('div');
  const tailMount = document.createElement('div');
  document.body.append(editMount, successorMount, tailMount);
  const editView = session.mount(editMount, { slideId: source[1], mode: 'edit', textMode: 'svg' });
  const successorView = session.mount(successorMount, { slideId: source[2], mode: 'view', textMode: 'svg' });
  const tailView = session.mount(tailMount, { slideId: source[3], mode: 'view', textMode: 'svg' });
  const successorStatic = successorMount.querySelector('[data-ppt-layer="static"]');
  const tailStatic = tailMount.querySelector('[data-ppt-layer="static"]');
  const successorSvg = successorStatic.querySelector('svg');
  const tailSvg = tailStatic.querySelector('svg');
  const textId = session.editor.doc.slides[source[1]].children[0];
  editMount.querySelector(`[data-edit-id="${textId}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  const events = [];
  const unsubscribe = session.editor.subscribe((change) => events.push(change));

  const result = session.editor.exec({ type: 'RemoveSlide', id: source[1] });
  check('删除当前中间页会关闭文字态并把该视图切到原后继',
    editView.slideId === source[2]
      && editMount.querySelector('[data-ppt-layer="static"]').textContent.includes('可删除页面 3')
      && !editMount.querySelector('[data-ppt-text-editor]')
      && session.editor.selection.kind === 'none');
  check('未被删除的 view 视图保持稳定页与整页 SVG，只增量刷新页码',
    successorView.slideId === source[2] && tailView.slideId === source[3]
      && successorStatic.querySelector('svg') === successorSvg
      && tailStatic.querySelector('svg') === tailSvg
      && pageNumber(successorStatic) === '2' && pageNumber(tailStatic) === '3');
  check('框架订阅只从公开 removedSlides/fallback 获得导航决定',
    result.removedSlideFallbacks.get(source[1]) === source[2]
      && events.at(-1)?.removedSlideFallbacks.get(source[1]) === source[2]
      && events.at(-1)?.removedSlides.has(source[1])
      && !events.at(-1)?.createdSlides.size && !events.at(-1)?.movedSlides.size);

  session.editor.undo();
  check('撤销恢复页面时现有视图仍保持自己的稳定身份与 SVG 根节点',
    session.editor.doc.slideOrder.join(',') === source.join(',')
      && successorView.slideId === source[2] && tailView.slideId === source[3]
      && successorStatic.querySelector('svg') === successorSvg
      && tailStatic.querySelector('svg') === tailSvg
      && pageNumber(successorStatic) === '3' && pageNumber(tailStatic) === '4');

  editView.setSlide(source[3]);
  const tailResult = session.editor.exec({ type: 'RemoveSlide', id: source[3] });
  check('删除末页时当前视图切到原前驱',
    tailResult.removedSlideFallbacks.get(source[3]) === source[2]
      && editView.slideId === source[2]
      && editMount.querySelector('[data-ppt-layer="static"]').textContent.includes('可删除页面 3'));

  unsubscribe();
  session.dispose();
  editMount.remove();
  successorMount.remove();
  tailMount.remove();
}
