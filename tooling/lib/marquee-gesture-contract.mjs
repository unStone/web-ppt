/** 框选只经过发布会话与 DOM 手势，避免测试内部几何求解器。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pointer = (type, x, y, init = {}) => new MouseEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0,
  clientX: x, clientY: y, ...init,
});

export async function runMarqueeGestureContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ PowerPoint 语义框选\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-basic.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-marquee-click-' });
  const container = document.createElement('div');
  const view = session.mount(container, { mode: 'edit', textMode: 'svg' });
  const id = session.editor.doc.slides[view.slideId].children[0];
  session.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
  const staticSvg = container.querySelector('[data-ppt-layer="static"] svg');
  const history = session.editor.history.undoCount;
  const accepted = view.element.dispatchEvent(pointer('pointerdown', 800, 600));
  const delayed = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids[0] === id;
  view.element.dispatchEvent(pointer('pointerup', 800, 600));
  check('空白点击延迟到 pointerup 才清空选区且不写历史或静态 DOM',
    !accepted && delayed && session.editor.selection.kind === 'none'
      && session.editor.history.undoCount === history
      && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg);
  session.dispose();

  const marqueeBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-marquee.pptx')));
  const marqueeSession = await lib.openEditor(marqueeBytes, { idPrefix: 'editor-marquee-top-' });
  const marqueeContainer = document.createElement('div');
  const marqueeView = marqueeSession.mount(marqueeContainer, { mode: 'edit', textMode: 'svg' });
  const byName = (name) => Object.values(marqueeSession.editor.doc.elements)
    .find((record) => record.src.name === name);
  const plain = byName('marquee-plain');
  const prior = byName('marquee-rotated-flipped');
  marqueeSession.editor.select({ kind: 'elements', ids: [prior.id], enteredGroup: null });
  const marqueeStatic = marqueeContainer.querySelector('[data-ppt-layer="static"] svg');
  const marqueeHistory = marqueeSession.editor.history.undoCount;
  let selectionEvents = 0;
  const unsubscribe = marqueeSession.editor.subscribe((change) => {
    if (change.source === 'selection') selectionEvents++;
  });
  marqueeView.element.dispatchEvent(pointer('pointerdown', 50, 50));
  marqueeView.element.dispatchEvent(pointer('pointermove', 300, 250));
  const marquee = marqueeContainer.querySelector('[data-edit-marquee-frame]');
  const previewOnly = marquee?.getAttribute('x') === '50'
    && marquee.getAttribute('y') === '50'
    && marquee.getAttribute('width') === '250'
    && marquee.getAttribute('height') === '200'
    && marqueeContainer.querySelector(`[data-edit-marquee-candidate="${plain.id}"]`)
      ?.getAttribute('display') !== 'none'
    && marqueeSession.editor.selection.kind === 'elements'
    && marqueeSession.editor.selection.ids[0] === prior.id
    && marqueeContainer.querySelector('[data-edit-selection-ids]')?.getAttribute('display') === 'none'
    && marqueeContainer.querySelector('[data-ppt-layer="static"] svg') === marqueeStatic;
  marqueeView.element.dispatchEvent(pointer('pointerup', 300, 250));
  const forward = marqueeSession.editor.selection.kind === 'elements'
    && marqueeSession.editor.selection.ids.length === 1
    && marqueeSession.editor.selection.ids[0] === plain.id;
  marqueeView.element.dispatchEvent(pointer('pointerdown', 300, 250));
  marqueeView.element.dispatchEvent(pointer('pointermove', 50, 50));
  const reverseMarquee = marqueeContainer.querySelector('[data-edit-marquee-frame]');
  const reversePreview = reverseMarquee?.getAttribute('x') === '50'
    && reverseMarquee.getAttribute('y') === '50'
    && reverseMarquee.getAttribute('width') === '250'
    && reverseMarquee.getAttribute('height') === '200';
  marqueeView.element.dispatchEvent(pointer('pointerup', 50, 50));
  check('框选任意方向都归一化矩形，只在松手提交完全包含元素',
    previewOnly && forward && reversePreview
      && marqueeSession.editor.selection.kind === 'elements'
      && marqueeSession.editor.selection.ids[0] === plain.id
      && !marqueeContainer.querySelector('[data-edit-marquee-layer]')
      && marqueeSession.editor.history.undoCount === marqueeHistory
      && selectionEvents === 1,
  `preview=${previewOnly} forward=${forward} reverse=${reversePreview} events=${selectionEvents}`);

  marqueeView.element.dispatchEvent(pointer('pointerdown', 100, 100));
  marqueeView.element.dispatchEvent(pointer('pointermove', 219, 180));
  const intersectionSkipped = marqueeContainer
    .querySelector(`[data-edit-marquee-candidate="${plain.id}"]`)?.getAttribute('display') === 'none';
  marqueeView.element.dispatchEvent(pointer('pointerup', 219, 180));
  marqueeView.element.dispatchEvent(pointer('pointerdown', 100, 100));
  marqueeView.element.dispatchEvent(pointer('pointermove', 220, 180));
  const boundaryIncluded = marqueeContainer
    .querySelector(`[data-edit-marquee-candidate="${plain.id}"]`)?.getAttribute('display') !== 'none';
  marqueeView.element.dispatchEvent(pointer('pointerup', 220, 180));
  check('相交不命中，世界 OBB 四角压在边界上视为完全包含', intersectionSkipped
    && boundaryIncluded && marqueeSession.editor.selection.kind === 'elements'
    && marqueeSession.editor.selection.ids.length === 1
    && marqueeSession.editor.selection.ids[0] === plain.id);

  const outer = byName('marquee-outer-group');
  const inner = byName('marquee-inner-group');
  const sibling = byName('marquee-group-sibling');
  const nestedLeaf = byName('marquee-nested-leaf');
  marqueeSession.editor.select({ kind: 'elements', ids: [sibling.id], enteredGroup: outer.id });
  marqueeView.element.dispatchEvent(pointer('pointerdown', -2000, -2000));
  marqueeView.element.dispatchEvent(pointer('pointermove', 3000, 3000));
  const groupPreviewIds = [...marqueeContainer.querySelectorAll(
    '[data-edit-marquee-candidate]:not([display="none"])',
  )].map((node) => node.getAttribute('data-edit-marquee-candidate'));
  marqueeView.element.dispatchEvent(pointer('pointerup', 3000, 3000));
  const groupSelection = marqueeSession.editor.selection;
  check('进组后框选只考虑当前组直属可选子项，不跨层命中叶子',
    groupPreviewIds.length === 2 && groupPreviewIds[0] === inner.id && groupPreviewIds[1] === sibling.id
      && !groupPreviewIds.includes(nestedLeaf.id)
      && groupSelection.kind === 'elements' && groupSelection.enteredGroup === outer.id
      && groupSelection.ids[0] === inner.id && groupSelection.ids[1] === sibling.id,
  `preview=${groupPreviewIds.join(',')} selection=${groupSelection.kind === 'elements'
    ? `${groupSelection.ids.join(',')}@${groupSelection.enteredGroup}` : groupSelection.kind}`);

  marqueeSession.editor.select({ kind: 'elements', ids: [prior.id], enteredGroup: null });
  const cancelHistory = marqueeSession.editor.history.undoCount;
  const startCancelable = () => {
    marqueeView.element.dispatchEvent(pointer('pointerdown', 50, 50));
    marqueeView.element.dispatchEvent(pointer('pointermove', 300, 250));
    return !!marqueeContainer.querySelector('[data-edit-marquee-layer]');
  };
  const escapeStarted = startCancelable();
  marqueeView.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const escapeRestored = !marqueeContainer.querySelector('[data-edit-marquee-layer]')
    && marqueeSession.editor.selection.kind === 'elements'
    && marqueeSession.editor.selection.ids[0] === prior.id
    && !marqueeContainer.querySelector('[data-edit-selection-ids]')?.hasAttribute('display');
  const pointerCancelStarted = startCancelable();
  marqueeView.element.dispatchEvent(pointer('pointercancel', 300, 250));
  const pointerCancelRestored = !marqueeContainer.querySelector('[data-edit-marquee-layer]')
    && marqueeSession.editor.selection.kind === 'elements'
    && marqueeSession.editor.selection.ids[0] === prior.id;
  const externalStarted = startCancelable();
  marqueeSession.editor.select({ kind: 'elements', ids: [plain.id], enteredGroup: null });
  const externalOwnsSelection = !marqueeContainer.querySelector('[data-edit-marquee-layer]')
    && marqueeSession.editor.selection.kind === 'elements'
    && marqueeSession.editor.selection.ids[0] === plain.id;
  check('Escape、pointer cancel 与外部选区更新都清理预览，不提交手势或历史',
    escapeStarted && escapeRestored && pointerCancelStarted && pointerCancelRestored
      && externalStarted && externalOwnsSelection
      && marqueeSession.editor.history.undoCount === cancelHistory);

  marqueeSession.editor.select({ kind: 'elements', ids: [prior.id], enteredGroup: null });
  marqueeView.element.dispatchEvent(pointer('pointerdown', 10, 10));
  marqueeView.element.dispatchEvent(pointer('pointermove', 12.99, 10));
  const belowThreshold = !marqueeContainer.querySelector('[data-edit-marquee-layer]');
  marqueeView.element.dispatchEvent(pointer('pointercancel', 12.99, 10));
  marqueeView.element.dispatchEvent(pointer('pointerdown', 10, 10));
  marqueeView.element.dispatchEvent(pointer('pointermove', 13, 10));
  const atThreshold = !!marqueeContainer.querySelector('[data-edit-marquee-layer]');
  marqueeView.element.dispatchEvent(pointer('lostpointercapture', 13, 10));
  check('框选阈值固定为屏幕 3px，lost capture 与 cancel 一样恢复原选区',
    belowThreshold && atThreshold && !marqueeContainer.querySelector('[data-edit-marquee-layer]')
      && marqueeSession.editor.selection.kind === 'elements'
      && marqueeSession.editor.selection.ids[0] === prior.id);

  const zoomStarted = startCancelable();
  marqueeView.setZoom(2);
  const zoomCanceled = !marqueeContainer.querySelector('[data-edit-marquee-layer]')
    && marqueeSession.editor.selection.kind === 'elements'
    && marqueeSession.editor.selection.ids[0] === prior.id;
  const modeStarted = startCancelable();
  marqueeView.setMode('view');
  const modeCanceled = !marqueeContainer.querySelector('[data-edit-marquee-layer]')
    && marqueeSession.editor.selection.kind === 'elements'
    && marqueeSession.editor.selection.ids[0] === prior.id;
  marqueeView.setMode('edit');
  const slideStarted = startCancelable();
  marqueeView.setSlide(marqueeSession.editor.doc.slideOrder[1]);
  const slideCanceled = !marqueeContainer.querySelector('[data-edit-marquee-layer]')
    && marqueeSession.editor.selection.kind === 'elements'
    && marqueeSession.editor.selection.ids[0] === prior.id;
  marqueeView.setSlide(marqueeSession.editor.doc.slideOrder[0]);
  marqueeSession.editor.select({ kind: 'elements', ids: [sibling.id], enteredGroup: outer.id });
  marqueeView.setSlide(marqueeSession.editor.doc.slideOrder[1]);
  const secondSlideId = marqueeSession.editor.doc.slides[marqueeView.slideId].children[0];
  marqueeView.element.dispatchEvent(pointer('pointerdown', 0, 0));
  marqueeView.element.dispatchEvent(pointer('pointermove', 500, 400));
  marqueeView.element.dispatchEvent(pointer('pointerup', 500, 400));
  const crossSlideScoped = marqueeSession.editor.selection.kind === 'elements'
    && marqueeSession.editor.selection.ids.length === 1
    && marqueeSession.editor.selection.ids[0] === secondSlideId
    && marqueeSession.editor.selection.enteredGroup === null;
  marqueeView.setSlide(marqueeSession.editor.doc.slideOrder[0]);
  marqueeSession.editor.select({ kind: 'elements', ids: [prior.id], enteredGroup: null });
  const destroyStarted = startCancelable();
  marqueeView.destroy();
  const destroyCanceled = !marqueeContainer.querySelector('[data-edit-marquee-layer]')
    && marqueeSession.editor.selection.kind === 'elements'
    && marqueeSession.editor.selection.ids[0] === prior.id;
  check('缩放、切模式、切页与销毁都取消框选并保留手势前选区',
    zoomStarted && zoomCanceled && modeStarted && modeCanceled
      && slideStarted && slideCanceled && crossSlideScoped && destroyStarted && destroyCanceled,
  `crossSlideScoped=${crossSlideScoped}`);
  unsubscribe();
  marqueeSession.dispose();
}
