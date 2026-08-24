/** 旋转必须经过发布入口和真实 DOM 事件，才能约束命中、预览、历史与写回属于同一用户操作。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const near = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) <= epsilon;
const pointer = (type, x, y, init = {}) => new MouseEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y, ...init,
});
const pointAt = (center, radius, degrees) => {
  const radians = degrees * Math.PI / 180;
  return { x: center.x + Math.cos(radians) * radius, y: center.y + Math.sin(radians) * radius };
};

export async function runRotationGestureContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 旋转手柄与角度事务\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-space.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-rotate-' });
  const container = document.createElement('div');
  const view = session.mount(container, { mode: 'edit', textMode: 'svg' });
  const target = Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === 'space-plain');
  session.editor.select({ kind: 'elements', ids: [target.id], enteredGroup: null });
  const visual = container.querySelector('[data-edit-handle="rotate"]');
  const hit = container.querySelector('[data-edit-rotation-handle]');
  check('旋转柄有向外 4px 且不随 zoom 缩放的透明命中区',
    near(Number(visual?.getAttribute('r')), 4)
      && near(Number(hit?.getAttribute('r')), 8)
      && hit?.style.pointerEvents === 'all');
  view.setZoom(2);
  const zoomedVisual = container.querySelector('[data-edit-handle="rotate"]');
  const zoomedHit = container.querySelector('[data-edit-rotation-handle]');
  check('旋转柄视觉与命中尺寸保持屏幕 8/16px',
    near(Number(zoomedVisual?.getAttribute('r')), 2)
      && near(Number(zoomedHit?.getAttribute('r')), 4));

  view.setZoom(1);
  const rotate = container.querySelector('[data-edit-rotation-handle]');
  const targetNode = container.querySelector(`[data-edit-id="${target.id}"]`);
  const staticSvg = container.querySelector('[data-ppt-layer="static"] svg');
  const defs = staticSvg.querySelector('defs');
  const historyBefore = session.editor.history.undoCount;
  rotate.dispatchEvent(pointer('pointerdown', 170, 56));
  view.element.dispatchEvent(pointer('pointermove', 172, 57));
  const belowThreshold = !container.querySelector('[data-edit-rotation-ghost]')
    && session.editor.history.undoCount === historyBefore;
  view.element.dispatchEvent(pointer('pointermove', 254, 140));
  const previewOnly = container.querySelectorAll('[data-edit-rotation-ghost]').length === 1
    && near(session.editor.effectiveElement(target.id).rot, 0)
    && session.editor.history.undoCount === historyBefore
    && container.querySelector(`[data-edit-id="${target.id}"]`) === targetNode
    && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg
    && staticSvg.querySelector('defs') === defs;
  view.element.dispatchEvent(pointer('pointerup', 254, 140));
  const committed = session.editor.effectiveElement(target.id);
  const committedOnce = near(committed.rot, 90)
    && session.editor.history.undoCount === historyBefore + 1
    && session.editor.history.undoEntries.at(-1)?.label === '旋转元素'
    && !container.querySelector('[data-edit-rotation-ghost]');
  session.editor.undo();
  check('3px 前不启动，旋转中只变幽灵，松手单事务提交顺时针角度且可撤销',
    belowThreshold && previewOnly && committedOnce
      && near(session.editor.effectiveElement(target.id).rot, 0),
  `threshold=${belowThreshold} preview=${previewOnly} commit=${committed.rot}`);

  const center = { x: 170, y: 140 };
  const radius = 84;
  const continuousHandle = container.querySelector('[data-edit-rotation-handle]');
  continuousHandle.dispatchEvent(pointer('pointerdown', 170, 56));
  for (const degrees of [0, 90, 170, -170]) {
    const point = pointAt(center, radius, degrees);
    view.element.dispatchEvent(pointer('pointermove', point.x, point.y));
  }
  const finalPoint = pointAt(center, radius, -170);
  view.element.dispatchEvent(pointer('pointerup', finalPoint.x, finalPoint.y));
  const continuous = session.editor.effectiveElement(target.id).rot;
  check('指针跨越正负 180° 时连续累计顺时针角度而不反转一整圈',
    near(continuous, 280), `rot=${continuous}`);
  session.editor.undo();

  const constrainedHandle = container.querySelector('[data-edit-rotation-handle]');
  const freePoint = pointAt(center, radius, -38);
  constrainedHandle.dispatchEvent(pointer('pointerdown', 170, 56));
  view.element.dispatchEvent(pointer('pointermove', freePoint.x, freePoint.y));
  const angleLabel = () => container.querySelector('[data-edit-rotation-angle]');
  const freePreview = angleLabel()?.textContent === '52°';
  const altIgnored = view.element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Alt', altKey: true, bubbles: true, cancelable: true,
  }));
  view.element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Shift', shiftKey: true, bubbles: true, cancelable: true,
  }));
  const snappedPreview = angleLabel()?.textContent === '45°';
  view.element.dispatchEvent(new KeyboardEvent('keyup', {
    key: 'Shift', shiftKey: false, bubbles: true, cancelable: true,
  }));
  const releasedPreview = angleLabel()?.textContent === '52°';
  view.element.dispatchEvent(pointer('pointerup', freePoint.x, freePoint.y));
  const freeCommit = session.editor.effectiveElement(target.id).rot;
  check('Shift 可在手势中动态吸附 15°，释放即恢复自由角度并显示实时值',
    freePreview && altIgnored && snappedPreview && releasedPreview && near(freeCommit, 52)
      && !angleLabel()?.hasAttribute('data-edit-rotation-active'),
  `label=${freePreview}/${snappedPreview}/${releasedPreview} alt=${altIgnored} rot=${freeCommit}`);
  session.editor.undo();

  const nested = Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === 'space-nested-leaf');
  session.editor.select({ kind: 'elements', ids: [nested.id], enteredGroup: nested.parent });
  const nestedHandle = container.querySelector('[data-edit-rotation-handle]');
  const nestedStart = {
    x: Number(nestedHandle.getAttribute('cx')),
    y: Number(nestedHandle.getAttribute('cy')),
  };
  const nestedEnd = { x: 597.5525938020953, y: 435.5595231456314 };
  const nestedNode = container.querySelector(`[data-edit-id="${nested.id}"]`);
  nestedHandle.dispatchEvent(pointer('pointerdown', nestedStart.x, nestedStart.y));
  view.element.dispatchEvent(pointer('pointermove', nestedEnd.x, nestedEnd.y));
  const nestedPreview = !!container.querySelector('[data-edit-rotation-ghost]')
    && container.querySelector(`[data-edit-id="${nested.id}"]`) === nestedNode
    && near(session.editor.effectiveElement(nested.id).rot, 15);
  view.element.dispatchEvent(pointer('pointerup', nestedEnd.x, nestedEnd.y));
  const nestedCommit = session.editor.effectiveElement(nested.id);
  const saved = await session.editor.save();
  const reopened = await lib.openEditor(saved, { idPrefix: 'editor-rotate-reopen-' });
  const reopenedNested = Object.values(reopened.editor.doc.elements)
    .find((record) => record.src.name === 'space-nested-leaf');
  const savedNested = reopened.editor.effectiveElement(reopenedNested.id);
  check('自身翻转元素在两层旋转翻转组内按父空间旋转并以 1/60000 度写回',
    nestedPreview && near(nestedCommit.rot, 52) && nestedCommit.flipV
      && near(nestedCommit.x, 30) && near(nestedCommit.y, 20)
      && near(savedNested.rot, 52, 1 / 60000) && savedNested.flipV
      && near(savedNested.x, 30, 1 / 9525) && near(savedNested.y, 20, 1 / 9525),
  `preview=${nestedPreview} live=${nestedCommit.rot} saved=${savedNested.rot}`);
  reopened.dispose();
  session.dispose();

  const multiSession = await lib.openEditor(bytes, { idPrefix: 'editor-multi-rotate-' });
  const multiContainer = document.createElement('div');
  const multiView = multiSession.mount(multiContainer, { mode: 'edit', textMode: 'svg' });
  const byName = (name) => Object.values(multiSession.editor.doc.elements)
    .find((record) => record.src.name === name);
  const plain = byName('space-plain');
  const flipped = byName('space-rotated-flipped');
  multiSession.editor.select({ kind: 'elements', ids: [plain.id, flipped.id], enteredGroup: null });
  const multiHandle = multiContainer.querySelector('[data-edit-rotation-handle]');
  const multiStart = {
    x: Number(multiHandle.getAttribute('cx')),
    y: Number(multiHandle.getAttribute('cy')),
  };
  const multiEnd = { x: 459.8103997793924, y: 150 };
  multiHandle.dispatchEvent(pointer('pointerdown', multiStart.x, multiStart.y));
  multiView.element.dispatchEvent(pointer('pointermove', multiEnd.x, multiEnd.y));
  const multiPreview = multiContainer.querySelectorAll('[data-edit-rotation-ghost]').length === 2
    && near(multiSession.editor.effectiveElement(plain.id).rot, 0)
    && near(multiSession.editor.effectiveElement(flipped.id).rot, 25)
    && multiContainer.querySelector('[data-edit-rotation-angle]')?.style.display === 'none';
  multiView.element.dispatchEvent(pointer('pointerup', multiEnd.x, multiEnd.y));
  const nextPlain = multiSession.editor.effectiveElement(plain.id);
  const nextFlipped = multiSession.editor.effectiveElement(flipped.id);
  const multiCommitted = near(nextPlain.x, 250.107028512757)
    && near(nextPlain.y, -70.107028512757) && near(nextPlain.rot, 90)
    && near(nextFlipped.x, 230.107028512757)
    && near(nextFlipped.y, 209.892971487243) && near(nextFlipped.rot, 115)
    && nextFlipped.flipH && multiSession.editor.history.undoCount === 1
    && multiSession.editor.history.undoEntries[0].label === '旋转元素'
    && multiSession.editor.history.undoEntries[0].forward.length === 6;
  const multiSaved = await multiSession.editor.save();
  const multiReopened = await lib.openEditor(multiSaved, { idPrefix: 'editor-multi-rotate-reopen-' });
  const reopenedByName = (name) => Object.values(multiReopened.editor.doc.elements)
    .find((record) => record.src.name === name);
  const savedPlain = multiReopened.editor.effectiveElement(reopenedByName('space-plain').id);
  const savedFlipped = multiReopened.editor.effectiveElement(reopenedByName('space-rotated-flipped').id);
  const multiRoundTrip = near(savedPlain.x, nextPlain.x, 1 / 9525)
    && near(savedPlain.y, nextPlain.y, 1 / 9525) && near(savedPlain.rot, nextPlain.rot, 1 / 60000)
    && near(savedFlipped.x, nextFlipped.x, 1 / 9525)
    && near(savedFlipped.y, nextFlipped.y, 1 / 9525)
    && near(savedFlipped.rot, nextFlipped.rot, 1 / 60000) && savedFlipped.flipH;
  multiReopened.dispose();
  multiSession.editor.undo();
  check('多选围绕共同 AABB 中心同步更新每个选择根的中心与角度',
    multiPreview && multiCommitted && multiRoundTrip
      && near(multiSession.editor.effectiveElement(plain.id).x, 80)
      && near(multiSession.editor.effectiveElement(flipped.id).rot, 25),
  `preview=${multiPreview} roundtrip=${multiRoundTrip} plain=${nextPlain.x},${nextPlain.y},${nextPlain.rot}`
    + ` flipped=${nextFlipped.x},${nextFlipped.y},${nextFlipped.rot}`);

  const oddInner = byName('space-inner-group');
  const oddSibling = byName('space-outer-sibling');
  const oddOuter = byName('space-outer-group');
  multiSession.editor.select({
    kind: 'elements', ids: [oddInner.id, oddSibling.id], enteredGroup: oddOuter.id,
  });
  const oddFrame = multiContainer.querySelector('[data-edit-selection-frame]')
    .getAttribute('points').split(' ').map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });
  const oddCenter = {
    x: (oddFrame[0].x + oddFrame[2].x) / 2,
    y: (oddFrame[0].y + oddFrame[2].y) / 2,
  };
  const oddHandle = multiContainer.querySelector('[data-edit-rotation-handle]');
  const oddStart = {
    x: Number(oddHandle.getAttribute('cx')), y: Number(oddHandle.getAttribute('cy')),
  };
  const oddRadius = Math.hypot(oddStart.x - oddCenter.x, oddStart.y - oddCenter.y);
  oddHandle.dispatchEvent(pointer('pointerdown', oddStart.x, oddStart.y));
  for (const degrees of [0, 90, 170, -170]) {
    const point = pointAt(oddCenter, oddRadius, degrees);
    multiView.element.dispatchEvent(pointer('pointermove', point.x, point.y));
  }
  const oddFinal = pointAt(oddCenter, oddRadius, -170);
  const oddPreview = multiContainer.querySelectorAll('[data-edit-rotation-ghost]').length === 2
    && near(multiSession.editor.effectiveElement(oddInner.id).rot, oddInner.src.rot)
    && near(multiSession.editor.effectiveElement(oddSibling.id).rot, oddSibling.src.rot);
  multiView.element.dispatchEvent(pointer('pointerup', oddFinal.x, oddFinal.y));
  const nextOddInner = multiSession.editor.effectiveElement(oddInner.id);
  const nextOddSibling = multiSession.editor.effectiveElement(oddSibling.id);
  const oddSaved = await multiSession.editor.save();
  const oddReopened = await lib.openEditor(oddSaved, { idPrefix: 'editor-odd-rotate-reopen-' });
  const oddSavedByName = (name) => Object.values(oddReopened.editor.doc.elements)
    .find((record) => record.src.name === name);
  const savedOddInner = oddReopened.editor.effectiveElement(oddSavedByName('space-inner-group').id);
  const savedOddSibling = oddReopened.editor.effectiveElement(oddSavedByName('space-outer-sibling').id);
  check('奇数次祖先翻转下多选跨过 ±180° 仍按父空间反向连续展开',
    oddPreview && near(nextOddInner.rot, oddInner.src.rot - 280)
      && near(nextOddSibling.rot, oddSibling.src.rot - 280)
      && near(savedOddInner.rot, nextOddInner.rot, 1 / 60000)
      && near(savedOddSibling.rot, nextOddSibling.rot, 1 / 60000),
  `inner=${nextOddInner.rot}/${savedOddInner.rot} sibling=${nextOddSibling.rot}/${savedOddSibling.rot}`);
  oddReopened.dispose();
  multiSession.dispose();

  const cancelBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-basic.pptx')));
  const cancelSession = await lib.openEditor(cancelBytes, { idPrefix: 'editor-rotate-cancel-' });
  const cancelContainer = document.createElement('div');
  const cancelView = cancelSession.mount(cancelContainer, { mode: 'edit', textMode: 'svg' });
  const slideChildren = cancelSession.editor.doc.slides[cancelView.slideId].children;
  const frameId = slideChildren.find((id) => cancelSession.editor.doc.elements[id].meta.editable === 'frame');
  const [cancelId, cancelSiblingId] = slideChildren
    .filter((id) => cancelSession.editor.doc.elements[id].meta.editable === 'full');
  cancelSession.editor.select({ kind: 'elements', ids: [frameId], enteredGroup: null });
  const frameOnly = !cancelContainer.querySelector('[data-edit-rotation-handle]')
    && cancelContainer.querySelectorAll('[data-edit-resize-handle]').length === 8;
  cancelSession.editor.select({ kind: 'elements', ids: [cancelId, frameId], enteredGroup: null });
  const mixed = !cancelContainer.querySelector('[data-edit-rotation-handle]');
  cancelSession.editor.select({ kind: 'elements', ids: [cancelId], enteredGroup: null });
  check('只允许改框的对象与混合多选不暴露无法写回的旋转柄',
    frameOnly && mixed && !!cancelContainer.querySelector('[data-edit-rotation-handle]'));
  const cancelSource = cancelSession.editor.effectiveElement(cancelId);
  const beginCancelledRotation = () => {
    const handle = cancelContainer.querySelector('[data-edit-rotation-handle]');
    const frame = (cancelContainer.querySelector('[data-edit-selection-frame]')
      ?.getAttribute('points') ?? '').split(' ').filter(Boolean).map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });
    const center = { x: (frame[0].x + frame[2].x) / 2, y: (frame[0].y + frame[2].y) / 2 };
    const start = { x: Number(handle.getAttribute('cx')), y: Number(handle.getAttribute('cy')) };
    const vector = { x: start.x - center.x, y: start.y - center.y };
    const end = {
      x: center.x + (vector.x - vector.y) / Math.SQRT2,
      y: center.y + (vector.x + vector.y) / Math.SQRT2,
    };
    handle.dispatchEvent(pointer('pointerdown', start.x, start.y));
    cancelView.element.dispatchEvent(pointer('pointermove', end.x, end.y));
    return { started: !!cancelContainer.querySelector('[data-edit-rotation-ghost]'), end };
  };
  const pointerCancel = beginCancelledRotation();
  cancelView.element.dispatchEvent(pointer('pointercancel', pointerCancel.end.x, pointerCancel.end.y));
  const pointerCancelled = !cancelContainer.querySelector('[data-edit-rotation-ghost]');
  const escape = beginCancelledRotation();
  cancelView.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const escaped = !cancelContainer.querySelector('[data-edit-rotation-ghost]');
  const lost = beginCancelledRotation();
  cancelView.element.dispatchEvent(pointer('lostpointercapture', lost.end.x, lost.end.y));
  const captureLost = !cancelContainer.querySelector('[data-edit-rotation-ghost]');
  const external = beginCancelledRotation();
  cancelSession.editor.select({ kind: 'elements', ids: [cancelSiblingId], enteredGroup: null });
  const externalCancelled = !cancelContainer.querySelector('[data-edit-rotation-ghost]');
  cancelSession.editor.select({ kind: 'elements', ids: [cancelId], enteredGroup: null });
  const zoom = beginCancelledRotation();
  cancelView.setZoom(1.25);
  const zoomCancelled = !cancelContainer.querySelector('[data-edit-rotation-ghost]');
  const page = beginCancelledRotation();
  cancelView.setSlide(cancelSession.editor.doc.slideOrder[1]);
  const pageCancelled = !cancelContainer.querySelector('[data-edit-rotation-ghost]');
  cancelView.setSlide(cancelSession.editor.doc.slideOrder[0]);
  const mode = beginCancelledRotation();
  cancelView.setMode('view');
  const modeCancelled = !cancelContainer.querySelector('[data-edit-rotation-ghost]');
  cancelView.setMode('edit');
  const destroy = beginCancelledRotation();
  cancelView.destroy();
  const cancelled = [
    pointerCancel.started, escape.started, lost.started, external.started,
    zoom.started, page.started, mode.started, destroy.started,
    pointerCancelled, escaped, captureLost, externalCancelled,
    zoomCancelled, pageCancelled, modeCancelled,
  ].every(Boolean)
    && cancelSession.editor.history.undoCount === 0
    && near(cancelSession.editor.effectiveElement(cancelId).rot, cancelSource.rot)
    && cancelContainer.childElementCount === 0;
  check('八类中断路径都拆除旋转幽灵且不提交历史', cancelled);
  cancelSession.dispose();
}
