/** 触屏契约只从挂载视图、公开回调和 Pointer Events 观察，不读取内部手势状态。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryRecoveryStore } from './recovery-memory-store.mjs';

function touch(type, pointerId, x, y, isPrimary = pointerId === 1) {
  const event = new MouseEvent(type, {
    bubbles: true, composed: true, cancelable: true, button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: x, clientY: y,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId }, pointerType: { value: 'touch' }, isPrimary: { value: isPrimary },
  });
  return event;
}

function mousePointer(type, pointerId, x, y) {
  const event = new MouseEvent(type, {
    bubbles: true, composed: true, cancelable: true, button: 0,
    buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId }, pointerType: { value: 'mouse' }, isPrimary: { value: true },
  });
  return event;
}

const near = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) <= epsilon;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const bytesEqual = (left, right) => left.length === right.length
  && left.every((value, index) => value === right[index]);

export async function runTouchGestureContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 触屏画布导航\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-touch.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-touch-' });
  const container = document.createElement('div');
  const changes = [];
  const contextRequests = [];
  const view = session.mount(container, {
    mode: 'edit', textMode: 'svg', zoom: 1,
    onTouchNavigate: (change) => changes.push(change),
    onContextRequest: (request) => contextRequests.push(request),
  });
  const stage = container.querySelector('[data-ppt-stage]');
  stage.getBoundingClientRect = () => ({
    left: 100, top: 50, right: 1380, bottom: 770, width: 1280, height: 720, x: 100, y: 50,
    toJSON() {},
  });
  const historyBefore = session.editor.history.undoCount;
  const projectionBefore = JSON.stringify(session.editor.toSlide(view.slideId));

  view.element.dispatchEvent(touch('pointerdown', 1, 300, 250, true));
  view.element.dispatchEvent(touch('pointerdown', 2, 500, 250, false));
  view.element.dispatchEvent(touch('pointermove', 1, 250, 300, true));
  view.element.dispatchEvent(touch('pointermove', 2, 550, 300, false));
  view.element.dispatchEvent(touch('pointerup', 2, 550, 300, false));
  view.element.dispatchEvent(touch('pointermove', 1, 270, 320, true));
  view.element.dispatchEvent(touch('pointerup', 1, 270, 320, true));

  const start = changes.find((change) => change.phase === 'start');
  const scaled = changes.find((change) => change.phase === 'update'
    && near(change.viewport.zoom, 1.5));
  const end = changes.at(-1);
  check('单指升级双指并降级平移只发布视口结果，不写模型或历史',
    start?.pointerCount === 2
      && near(start.viewport.left, 100) && near(start.viewport.top, 50)
      && scaled?.pointerCount === 2
      && near(scaled.viewport.left, -50) && near(scaled.viewport.top, 0)
      && end?.phase === 'end' && end.pointerCount === 0
      && near(end.viewport.left, -30) && near(end.viewport.top, 20)
      && near(end.viewport.zoom, 1.5) && near(view.zoom, 1.5)
      && session.editor.history.undoCount === historyBefore
      && JSON.stringify(session.editor.toSlide(view.slideId)) === projectionBefore,
  `events=${JSON.stringify(changes)} zoom=${view.zoom} history=${session.editor.history.undoCount}`);

  view.setZoom(1);
  const outline = Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === 'touch-thin-outline');
  const target = container.querySelector(`[data-edit-id="${outline.id}"]`);
  target.dispatchEvent(touch('pointerdown', 3, 250, 160, true));
  await wait(450);
  const quietBeforeThreshold = contextRequests.length === 0;
  await wait(80);
  view.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  const keyboardYielded = !!session.editor.doc.elements[outline.id];
  target.dispatchEvent(touch('pointerup', 3, 250, 160, true));
  const unrelatedClick = new MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: 700, clientY: 500,
  });
  view.element.dispatchEvent(unrelatedClick);
  let leakedClick = 0;
  view.element.addEventListener('click', () => { leakedClick++; }, { capture: true, once: true });
  const click = new MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: 250, clientY: 160,
  });
  target.dispatchEvent(click);
  const request = contextRequests[0];
  check('触屏长按在 500ms 阈值后只发上下文请求',
    quietBeforeThreshold && keyboardYielded && !unrelatedClick.defaultPrevented
      && leakedClick === 0 && click.defaultPrevented
      && contextRequests.length === 1
      && request.source === 'touch' && request.targetId === outline.id
      && near(request.screen.x, 250) && near(request.screen.y, 160)
      && near(request.slide.x, 150) && near(request.slide.y, 110)
      && session.editor.history.undoCount === historyBefore
      && JSON.stringify(session.editor.toSlide(view.slideId)) === projectionBefore,
  `quiet=${quietBeforeThreshold} keyboard=${keyboardYielded}`
    + ` leakedClick=${leakedClick} requests=${JSON.stringify(contextRequests)}`);

  const nextTouchRequest = contextRequests.length;
  target.dispatchEvent(touch('pointerdown', 34, 250, 160, true));
  await wait(520);
  target.dispatchEvent(touch('pointerup', 34, 250, 160, true));
  target.dispatchEvent(touch('pointerdown', 35, 250, 160, true));
  target.dispatchEvent(touch('pointerup', 35, 250, 160, true));
  const nextTouchClick = new MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: 250, clientY: 160,
  });
  target.dispatchEvent(nextTouchClick);
  target.dispatchEvent(touch('pointerdown', 36, 250, 160, true));
  await wait(520);
  target.dispatchEvent(touch('pointerup', 36, 250, 160, true));
  target.dispatchEvent(mousePointer('pointerdown', 37, 250, 160));
  target.dispatchEvent(mousePointer('pointerup', 37, 250, 160));
  const nextMouseClick = new MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: 250, clientY: 160,
  });
  target.dispatchEvent(nextMouseClick);
  check('长按抑制不吞掉同位置的下一次触屏或真实鼠标操作',
    contextRequests.length === nextTouchRequest + 2
      && !nextTouchClick.defaultPrevented && !nextMouseClick.defaultPrevented,
  `requests=${contextRequests.length} touch=${nextTouchClick.defaultPrevented}`
    + ` mouse=${nextMouseClick.defaultPrevented}`);

  const requestCount = contextRequests.length;
  target.dispatchEvent(touch('pointerdown', 4, 250, 160, true));
  view.element.dispatchEvent(touch('pointermove', 4, 270, 180, true));
  view.element.dispatchEvent(touch('pointercancel', 4, 270, 180, true));
  await wait(520);
  check('长按越过移动阈值或 pointercancel 后不留下计时器',
    contextRequests.length === requestCount && !view.element.hasAttribute('data-touch-navigation'),
  `requests=${contextRequests.length} navigation=${view.element.dataset.touchNavigation}`);

  const moveSource = session.editor.effectiveElement(outline.id);
  const moveHistory = session.editor.history.undoCount;
  container.querySelector(`[data-edit-id="${outline.id}"]`)
    .dispatchEvent(touch('pointerdown', 5, 300, 220, true));
  view.element.dispatchEvent(touch('pointermove', 5, 322, 236, true));
  view.element.dispatchEvent(touch('pointerup', 5, 322, 236, true));
  const moved = session.editor.effectiveElement(outline.id);
  const touchMoveWorked = near(moved.x, moveSource.x + 22) && near(moved.y, moveSource.y + 16)
    && session.editor.history.undoCount === moveHistory + 1;
  session.editor.undo();
  session.editor.select({ kind: 'elements', ids: [outline.id], enteredGroup: null });
  const resizeHandle = container.querySelector('[data-edit-resize-handle="se"]');
  const resizeSource = session.editor.effectiveElement(outline.id);
  const resizeHistory = session.editor.history.undoCount;
  resizeHandle.dispatchEvent(touch('pointerdown', 6, 660, 380, true));
  view.element.dispatchEvent(touch('pointermove', 6, 680, 392, true));
  view.element.dispatchEvent(touch('pointerup', 6, 680, 392, true));
  const resized = session.editor.effectiveElement(outline.id);
  check('单指触屏仍进入既有对象移动和缩放事务',
    touchMoveWorked && near(resized.w, resizeSource.w + 20) && near(resized.h, resizeSource.h + 12)
      && session.editor.history.undoCount === resizeHistory + 1,
  `move=${JSON.stringify(moved)} resize=${JSON.stringify(resized)}`);
  session.editor.undo();
  session.editor.select({ kind: 'elements', ids: [outline.id], enteredGroup: null });
  const rotationHandle = container.querySelector('[data-edit-rotation-handle]');
  const rotationSource = session.editor.effectiveElement(outline.id);
  const rotationHistory = session.editor.history.undoCount;
  rotationHandle.dispatchEvent(touch('pointerdown', 7, 500, 170, true));
  view.element.dispatchEvent(touch('pointermove', 7, 620, 290, true));
  view.element.dispatchEvent(touch('pointerup', 7, 620, 290, true));
  const rotated = session.editor.effectiveElement(outline.id);
  check('单指触屏仍进入既有旋转事务',
    Math.abs(rotated.rot - rotationSource.rot) > 30
      && session.editor.history.undoCount === rotationHistory + 1,
  `source=${rotationSource.rot} rotated=${rotated.rot}`);
  session.editor.undo();

  const cancellationPhases = [];
  const cancellationContainer = document.createElement('div');
  const cancellationView = session.mount(cancellationContainer, {
    mode: 'edit', textMode: 'svg', zoom: 1,
    onTouchNavigate: (change) => cancellationPhases.push(change),
  });
  const cancellationStage = cancellationContainer.querySelector('[data-ppt-stage]');
  cancellationStage.getBoundingClientRect = stage.getBoundingClientRect;
  const startNavigation = (firstId, secondId) => {
    cancellationView.element.dispatchEvent(touch('pointerdown', firstId, 300, 250, true));
    cancellationView.element.dispatchEvent(touch('pointerdown', secondId, 500, 250, false));
  };
  startNavigation(10, 11);
  cancellationView.element.dispatchEvent(touch('pointercancel', 11, 500, 250, false));
  const pointerCancelClean = cancellationPhases.at(-1)?.phase === 'cancel'
    && !cancellationView.element.hasAttribute('data-touch-navigation');
  startNavigation(12, 13);
  cancellationView.element.dispatchEvent(touch('lostpointercapture', 12, 300, 250, true));
  const captureLossClean = cancellationPhases.at(-1)?.phase === 'cancel'
    && !cancellationView.element.hasAttribute('data-touch-navigation');
  startNavigation(14, 15);
  cancellationView.setMode('view');
  const modeSwitchClean = cancellationPhases.at(-1)?.phase === 'cancel'
    && cancellationView.element.style.touchAction === ''
    && !cancellationView.element.hasAttribute('data-touch-navigation');
  const viewModeEvent = touch('pointerdown', 16, 300, 250, true);
  cancellationView.element.dispatchEvent(viewModeEvent);
  const viewModeScrollOwnedByPage = !viewModeEvent.defaultPrevented;
  cancellationView.setMode('edit');
  startNavigation(17, 18);
  cancellationView.setZoom(2);
  const externalZoomClean = cancellationPhases.at(-1)?.phase === 'cancel'
    && cancellationView.zoom === 2
    && !cancellationView.element.hasAttribute('data-touch-navigation');
  check('cancel、capture 丢失、模式切换与宿主缩放统一收束触屏状态',
    pointerCancelClean && captureLossClean && modeSwitchClean
      && viewModeScrollOwnedByPage && externalZoomClean,
  `phases=${JSON.stringify(cancellationPhases)} viewDefault=${viewModeEvent.defaultPrevented}`);

  const isolatedStartsBefore = changes.filter((change) => change.phase === 'start').length
    + cancellationPhases.filter((change) => change.phase === 'start').length;
  view.element.dispatchEvent(touch('pointerdown', 20, 320, 260, true));
  cancellationView.element.dispatchEvent(touch('pointerdown', 21, 520, 260, true));
  view.element.dispatchEvent(touch('pointercancel', 20, 320, 260, true));
  cancellationView.element.dispatchEvent(touch('pointercancel', 21, 520, 260, true));
  const isolatedStartsAfter = changes.filter((change) => change.phase === 'start').length
    + cancellationPhases.filter((change) => change.phase === 'start').length;
  const destroyRequests = [];
  const destroyContainer = document.createElement('div');
  const destroyView = session.mount(destroyContainer, {
    mode: 'edit', textMode: 'svg',
    onContextRequest: (value) => destroyRequests.push(value),
  });
  const destroyTarget = destroyContainer.querySelector(`[data-edit-id="${outline.id}"]`);
  destroyTarget.dispatchEvent(touch('pointerdown', 30, 250, 160, true));
  const detachedRoot = destroyView.element;
  destroyView.destroy();
  detachedRoot.dispatchEvent(touch('pointerup', 30, 250, 160, true));
  await wait(520);
  const destroyNavigationChanges = [];
  const destroyNavigationContainer = document.createElement('div');
  const destroyNavigation = session.mount(destroyNavigationContainer, {
    mode: 'edit', textMode: 'svg',
    onTouchNavigate: (change) => destroyNavigationChanges.push(change),
  });
  const destroyNavigationStage = destroyNavigationContainer.querySelector('[data-ppt-stage]');
  destroyNavigationStage.getBoundingClientRect = stage.getBoundingClientRect;
  destroyNavigation.element.dispatchEvent(touch('pointerdown', 31, 300, 250, true));
  destroyNavigation.element.dispatchEvent(touch('pointerdown', 32, 500, 250, false));
  destroyNavigation.destroy();
  check('多视图触点不合并，destroy 后无悬挂监听器或长按回调',
    isolatedStartsAfter === isolatedStartsBefore && destroyRequests.length === 0
      && destroyView.destroyed && !detachedRoot.isConnected
      && destroyNavigationChanges.at(-1)?.phase === 'cancel'
      && !destroyNavigation.element.hasAttribute('data-touch-navigation'),
  `starts=${isolatedStartsBefore}/${isolatedStartsAfter}`
    + ` destroyRequests=${destroyRequests.length} navigation=${JSON.stringify(destroyNavigationChanges)}`);

  const pageBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-notes.pptx')));
  const pageSession = await lib.openEditor(pageBytes, { idPrefix: 'editor-touch-page-' });
  const pageContainer = document.createElement('div');
  const pageChanges = [];
  const pageView = pageSession.mount(pageContainer, {
    mode: 'edit', textMode: 'svg', onTouchNavigate: (change) => pageChanges.push(change),
  });
  pageContainer.querySelector('[data-ppt-stage]').getBoundingClientRect = stage.getBoundingClientRect;
  pageView.element.dispatchEvent(touch('pointerdown', 41, 300, 250, true));
  pageView.element.dispatchEvent(touch('pointerdown', 42, 500, 250, false));
  const nextSlide = pageSession.editor.doc.slideOrder[1];
  pageView.setSlide(nextSlide);
  check('切页收束双指导航并切到稳定 SlideId',
    pageChanges.at(-1)?.phase === 'cancel' && pageView.slideId === nextSlide
      && !pageView.element.hasAttribute('data-touch-navigation'),
  `changes=${JSON.stringify(pageChanges)} slide=${pageView.slideId}`);
  pageSession.dispose();

  const saved = await session.editor.save();
  check('触屏命中、导航、长按与取消路径保持保存字节和编辑历史不变',
    bytesEqual(saved, bytes) && session.editor.history.undoCount === historyBefore
      && JSON.stringify(session.editor.toSlide(view.slideId)) === projectionBefore,
  `source=${bytes.length} saved=${saved.length} history=${session.editor.history.undoCount}`);
  cancellationView.destroy();
  session.dispose();

  const { records, store } = createMemoryRecoveryStore();
  const recoverySession = await lib.openEditor(bytes, {
    idPrefix: 'editor-touch-recovery-', recovery: { store, decide: () => 'restore' },
  });
  const recoveryContainer = document.createElement('div');
  const recoveryView = recoverySession.mount(recoveryContainer, { mode: 'edit', textMode: 'svg' });
  const recoveryStage = recoveryContainer.querySelector('[data-ppt-stage]');
  recoveryStage.getBoundingClientRect = stage.getBoundingClientRect;
  recoveryView.element.dispatchEvent(touch('pointerdown', 61, 300, 250, true));
  recoveryView.element.dispatchEvent(touch('pointerdown', 62, 500, 250, false));
  recoveryView.element.dispatchEvent(touch('pointermove', 61, 250, 280, true));
  recoveryView.element.dispatchEvent(touch('pointermove', 62, 550, 280, false));
  recoveryView.element.dispatchEvent(touch('pointerup', 62, 550, 280, false));
  recoveryView.element.dispatchEvent(touch('pointerup', 61, 250, 280, true));
  await recoverySession.recovery.flush();
  const recoveryFrames = [...records.values()].reduce((total, record) => total + record.frames.length, 0);
  check('纯触屏导航不生成恢复帧或持久化日志',
    recoveryFrames === 0 && recoverySession.editor.history.undoCount === 0,
  `records=${records.size} frames=${recoveryFrames} history=${recoverySession.editor.history.undoCount}`);
  recoverySession.dispose();
}
