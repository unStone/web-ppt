/** 移动必须经过发布入口和 DOM 事件，才能同时约束框架接入、历史与静态预览身份。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pointer = (type, x, y) => new MouseEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y,
});
const near = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) <= epsilon;
const translation = (value) => (value?.match(/^translate\(([-\d.e]+) ([-\d.e]+)\)$/) ?? [])
  .slice(1).map(Number);

export async function runMoveGestureContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 移动手势与拖动幽灵\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-60.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-move-' });
  const container = document.createElement('div');
  const view = session.mount(container, { mode: 'edit', textMode: 'svg', zoom: 2, snapping: false });
  const [targetId, siblingId] = session.editor.doc.slides[view.slideId].children;
  const target = container.querySelector(`[data-edit-id="${targetId}"]`);
  const sibling = container.querySelector(`[data-edit-id="${siblingId}"]`);
  const staticSvg = container.querySelector('[data-ppt-layer="static"] svg');
  const defs = staticSvg.querySelector('defs');
  const source = session.editor.effectiveElement(targetId);
  const historyBefore = session.editor.history.undoCount;

  target.dispatchEvent(pointer('pointerdown', 100, 100));
  view.element.dispatchEvent(pointer('pointermove', 102, 102));
  const belowThreshold = !container.querySelector('[data-edit-drag-ghost]')
    && session.editor.history.undoCount === historyBefore
    && near(session.editor.effectiveElement(targetId).x, source.x);
  view.element.dispatchEvent(pointer('pointermove', 120, 116));
  const ghost = container.querySelector('[data-edit-drag-ghost]');
  const overlay = container.querySelector('[data-edit-selection-ids]');
  const previewOnly = ghost?.getAttribute('transform') === 'translate(10 8)'
    && overlay?.getAttribute('transform') === 'translate(10 8)'
    && view.element.style.cursor === 'grabbing'
    && session.editor.history.undoCount === historyBefore
    && near(session.editor.effectiveElement(targetId).x, source.x)
    && container.querySelector(`[data-edit-id="${targetId}"]`) === target;
  view.element.dispatchEvent(pointer('pointerup', 120, 116));
  const committed = session.editor.effectiveElement(targetId);
  const targetAfter = container.querySelector(`[data-edit-id="${targetId}"]`);
  const committedOnce = near(committed.x, source.x + 10) && near(committed.y, source.y + 8)
    && session.editor.history.undoCount === historyBefore + 1
    && !container.querySelector('[data-edit-drag-ghost]')
    && view.element.style.cursor === ''
    && !container.querySelector('[data-edit-selection-ids]')?.hasAttribute('transform')
    && targetAfter !== target && container.querySelector(`[data-edit-id="${siblingId}"]`) === sibling
    && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg
    && staticSvg.querySelector('defs') === defs;
  session.editor.undo();
  const undone = session.editor.effectiveElement(targetId);
  check('3px 前不启动，拖动中只变幽灵，松手一次提交且可撤销',
    belowThreshold && previewOnly && committedOnce
    && near(undone.x, source.x) && near(undone.y, source.y),
  `threshold=${belowThreshold} preview=${previewOnly} commit=${committedOnce}`
    + ` xy=${committed.x},${committed.y} history=${session.editor.history.redoCount}`
    + ` ghost=${!!container.querySelector('[data-edit-drag-ghost]')}`
    + ` target=${targetAfter !== target} sibling=${container.querySelector(`[data-edit-id="${siblingId}"]`) === sibling}`
    + ` svg=${container.querySelector('[data-ppt-layer="static"] svg') === staticSvg}`);
  session.dispose();

  const multiSession = await lib.openEditor(bytes, { idPrefix: 'editor-multi-move-' });
  const multiContainer = document.createElement('div');
  const multiView = multiSession.mount(multiContainer, { mode: 'edit', textMode: 'svg', snapping: false });
  const [firstId, secondId] = multiSession.editor.doc.slides[multiView.slideId].children;
  const firstSource = multiSession.editor.effectiveElement(firstId);
  const secondSource = multiSession.editor.effectiveElement(secondId);
  multiSession.editor.select({ kind: 'elements', ids: [firstId, secondId], enteredGroup: null });
  const first = multiContainer.querySelector(`[data-edit-id="${firstId}"]`);
  first.dispatchEvent(pointer('pointerdown', 10, 10));
  multiView.element.dispatchEvent(pointer('pointermove', 22, 16));
  const previewedTogether = multiContainer.querySelectorAll('[data-edit-drag-ghost]').length === 2
    && multiSession.editor.selection.kind === 'elements'
    && multiSession.editor.selection.ids.length === 2
    && near(multiSession.editor.effectiveElement(firstId).x, firstSource.x)
    && near(multiSession.editor.effectiveElement(secondId).x, secondSource.x);
  multiView.element.dispatchEvent(pointer('pointerup', 22, 16));
  const firstMoved = multiSession.editor.effectiveElement(firstId);
  const secondMoved = multiSession.editor.effectiveElement(secondId);
  const committedTogether = near(firstMoved.x, firstSource.x + 12) && near(firstMoved.y, firstSource.y + 6)
    && near(secondMoved.x, secondSource.x + 12) && near(secondMoved.y, secondSource.y + 6)
    && multiSession.editor.history.undoCount === 1
    && multiSession.editor.history.undoEntries[0].label === '移动元素'
    && multiSession.editor.selection.kind === 'elements'
    && multiSession.editor.selection.ids.length === 2;
  multiSession.editor.undo();
  check('拖动已选多选成员保持选区并把共同位移提交为一个历史单元',
    previewedTogether && committedTogether
    && near(multiSession.editor.effectiveElement(firstId).x, firstSource.x)
    && near(multiSession.editor.effectiveElement(secondId).x, secondSource.x),
  `preview=${previewedTogether} commit=${committedTogether}`);
  multiSession.dispose();

  const nestedBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-space.pptx')));
  const nestedSession = await lib.openEditor(nestedBytes, { idPrefix: 'editor-nested-move-' });
  const nestedContainer = document.createElement('div');
  const nestedView = nestedSession.mount(nestedContainer, { mode: 'edit', textMode: 'svg', snapping: false });
  const nestedRecord = Object.values(nestedSession.editor.doc.elements)
    .find((record) => record.src.name === 'space-nested-leaf');
  nestedSession.editor.select({
    kind: 'elements', ids: [nestedRecord.id], enteredGroup: nestedRecord.parent,
  });
  const nestedTarget = nestedContainer.querySelector(`[data-edit-id="${nestedRecord.id}"]`);
  nestedTarget.dispatchEvent(pointer('pointerdown', 300, 300));
  nestedView.element.dispatchEvent(pointer('pointermove', 340, 320));
  const nestedGhost = translation(nestedContainer.querySelector('[data-edit-drag-ghost]')?.getAttribute('transform'));
  const parentDeltaExact = near(nestedGhost[0], -11.160254037844396)
    && near(nestedGhost[1], 0.6698729810778019)
    && nestedContainer.querySelector('[data-edit-selection-ids]')?.getAttribute('transform') === 'translate(40 20)'
    && near(nestedSession.editor.effectiveElement(nestedRecord.id).x, 30)
    && near(nestedSession.editor.effectiveElement(nestedRecord.id).y, 20);
  nestedView.element.dispatchEvent(pointer('pointerup', 340, 320));
  const nestedMoved = nestedSession.editor.effectiveElement(nestedRecord.id);
  const nestedCommitted = near(nestedMoved.x, 18.839745962155604)
    && near(nestedMoved.y, 20.669872981077802)
    && nestedSession.editor.history.undoCount === 1
    && nestedSession.editor.history.undoEntries[0].forward.length === 2;
  const saved = await nestedSession.editor.save();
  const reopened = await lib.openEditor(saved, { idPrefix: 'editor-nested-move-reopen-' });
  const reopenedRecord = Object.values(reopened.editor.doc.elements)
    .find((record) => record.src.name === 'space-nested-leaf');
  const savedElement = reopened.editor.effectiveElement(reopenedRecord.id);
  check('嵌套旋转翻转组按父级子坐标移动并精确写回 OOXML',
    parentDeltaExact && nestedCommitted
    && near(savedElement.x, 18.839745962155604, 1 / 9525)
    && near(savedElement.y, 20.669872981077802, 1 / 9525),
  `preview=${parentDeltaExact} commit=${nestedCommitted} saved=${savedElement.x},${savedElement.y}`);
  reopened.dispose();
  nestedSession.dispose();

  const cancelBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-basic.pptx')));
  const cancelSession = await lib.openEditor(cancelBytes, { idPrefix: 'editor-cancel-move-' });
  const cancelContainer = document.createElement('div');
  const cancelView = cancelSession.mount(cancelContainer, { mode: 'edit', textMode: 'svg', snapping: false });
  const cancelId = cancelSession.editor.doc.slides[cancelView.slideId].children[0];
  const cancelSiblingId = cancelSession.editor.doc.slides[cancelView.slideId].children[1];
  const cancelSource = cancelSession.editor.effectiveElement(cancelId);
  const editOwnsTouch = cancelView.element.style.touchAction === 'none';
  const beginCancelDrag = () => {
    const node = cancelContainer.querySelector(`[data-edit-id="${cancelId}"]`);
    node.dispatchEvent(pointer('pointerdown', 40, 40));
    cancelView.element.dispatchEvent(pointer('pointermove', 60, 55));
    return !!cancelContainer.querySelector('[data-edit-drag-ghost]');
  };
  const pointerCancelStarted = beginCancelDrag();
  cancelView.element.dispatchEvent(pointer('pointercancel', 60, 55));
  const pointerCancelled = !cancelContainer.querySelector('[data-edit-drag-ghost]');
  const escapeStarted = beginCancelDrag();
  cancelView.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const escaped = !cancelContainer.querySelector('[data-edit-drag-ghost]')
    && cancelSession.editor.selection.kind === 'elements';
  const lostStarted = beginCancelDrag();
  cancelView.element.dispatchEvent(pointer('lostpointercapture', 60, 55));
  const captureLost = !cancelContainer.querySelector('[data-edit-drag-ghost]');
  const externalStarted = beginCancelDrag();
  cancelSession.editor.select({ kind: 'elements', ids: [cancelSiblingId], enteredGroup: null });
  const externalCancelled = !cancelContainer.querySelector('[data-edit-drag-ghost]');
  const zoomStarted = beginCancelDrag();
  cancelView.setZoom(1.25);
  const zoomCancelled = !cancelContainer.querySelector('[data-edit-drag-ghost]');
  const pageStarted = beginCancelDrag();
  cancelView.setSlide(cancelSession.editor.doc.slideOrder[1]);
  const pageCancelled = !cancelContainer.querySelector('[data-edit-drag-ghost]');
  cancelView.setSlide(cancelSession.editor.doc.slideOrder[0]);
  const modeStarted = beginCancelDrag();
  cancelView.setMode('view');
  const modeCancelled = !cancelContainer.querySelector('[data-edit-drag-ghost]')
    && cancelView.element.style.touchAction === '';
  cancelView.setMode('edit');
  const editRestoresTouch = cancelView.element.style.touchAction === 'none';
  const destroyStarted = beginCancelDrag();
  cancelView.destroy();
  const cancelledWithoutCommit = [
    pointerCancelStarted, escapeStarted, lostStarted, externalStarted,
    zoomStarted, pageStarted, modeStarted, destroyStarted,
  ].every(Boolean)
    && pointerCancelled && escaped && captureLost && externalCancelled && zoomCancelled
    && pageCancelled && modeCancelled && editOwnsTouch && editRestoresTouch
    && cancelSession.editor.history.undoCount === 0
    && near(cancelSession.editor.effectiveElement(cancelId).x, cancelSource.x)
    && near(cancelSession.editor.effectiveElement(cancelId).y, cancelSource.y)
    && cancelContainer.childElementCount === 0;
  check('八类中断路径都无提交回滚幽灵，且仅编辑态拥有触摸手势', cancelledWithoutCommit,
    `started=${[
      pointerCancelStarted, escapeStarted, lostStarted, externalStarted,
      zoomStarted, pageStarted, modeStarted, destroyStarted,
    ]}`
      + ` cancelled=${[
        pointerCancelled, escaped, captureLost, externalCancelled,
        zoomCancelled, pageCancelled, modeCancelled,
      ]} touch=${editOwnsTouch}/${editRestoresTouch}`);
  cancelSession.dispose();
}
