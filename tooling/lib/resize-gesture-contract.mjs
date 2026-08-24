/** 缩放必须经过发布入口与交互层事件，才能同时约束命中面积、历史和预览身份。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const near = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) <= epsilon;
const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
const pointer = (type, x, y, init = {}) => new MouseEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y, ...init,
});
const rectCenter = (rect) => ({
  x: Number(rect?.getAttribute('x')) + Number(rect?.getAttribute('width')) / 2,
  y: Number(rect?.getAttribute('y')) + Number(rect?.getAttribute('height')) / 2,
});
const selectionCorners = (container) => (container
  .querySelector('[data-edit-selection-frame]')?.getAttribute('points') ?? '')
  .split(' ').filter(Boolean).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
const sameCorners = (left, right, epsilon = 1e-6) => left.length === right.length
  && left.every((point, index) => near(point.x, right[index].x, epsilon)
    && near(point.y, right[index].y, epsilon));

export async function runResizeGestureContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 缩放手柄与尺寸事务\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-basic.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-resize-' });
  const container = document.createElement('div');
  const view = session.mount(container, { mode: 'edit', textMode: 'svg' });
  const targetId = session.editor.doc.slides[view.slideId].children[0];
  session.editor.select({ kind: 'elements', ids: [targetId], enteredGroup: null });
  const visualHandles = [...container.querySelectorAll('[data-edit-handle]:not([data-edit-handle="rotate"])')];
  const hitHandles = [...container.querySelectorAll('[data-edit-resize-handle]')];
  check('8 个缩放柄各有向外 4px 且不随 zoom 缩放的透明命中区',
    visualHandles.length === 8 && hitHandles.length === 8
    && visualHandles.every((handle) => near(Number(handle.getAttribute('width')), 8))
    && hitHandles.every((handle) => near(Number(handle.getAttribute('width')), 16)
      && handle.style.pointerEvents === 'all'),
  `visual=${visualHandles.length}/${visualHandles[0]?.getAttribute('width')}`
    + ` hit=${hitHandles.length}/${hitHandles[0]?.getAttribute('width')}`);

  const target = container.querySelector(`[data-edit-id="${targetId}"]`);
  const siblingId = session.editor.doc.slides[view.slideId].children[1];
  const sibling = container.querySelector(`[data-edit-id="${siblingId}"]`);
  const staticSvg = container.querySelector('[data-ppt-layer="static"] svg');
  const defs = staticSvg.querySelector('defs');
  const source = session.editor.effectiveElement(targetId);
  const historyBefore = session.editor.history.undoCount;
  const east = container.querySelector('[data-edit-resize-handle="e"]');
  east.dispatchEvent(pointer('pointerdown', 350, 195));
  view.element.dispatchEvent(pointer('pointermove', 352, 196));
  const belowThreshold = !container.querySelector('[data-edit-resize-ghost]')
    && session.editor.history.undoCount === historyBefore;
  view.element.dispatchEvent(pointer('pointermove', 390, 195));
  const previewCenter = rectCenter(container.querySelector('[data-edit-handle="e"]'));
  const previewOnly = !!container.querySelector('[data-edit-resize-ghost]')
    && near(previewCenter.x, 390) && near(previewCenter.y, 195)
    && near(session.editor.effectiveElement(targetId).w, 260)
    && session.editor.history.undoCount === historyBefore
    && container.querySelector(`[data-edit-id="${targetId}"]`) === target;
  view.element.dispatchEvent(pointer('pointerup', 390, 195));
  const resized = session.editor.effectiveElement(targetId);
  const committedOnce = near(resized.x, 90) && near(resized.y, 120)
    && near(resized.w, 300) && near(resized.h, 150)
    && !resized.flipH && !resized.flipV
    && session.editor.history.undoCount === historyBefore + 1
    && session.editor.history.undoEntries.at(-1)?.label === '缩放元素'
    && !container.querySelector('[data-edit-resize-ghost]')
    && container.querySelector(`[data-edit-id="${targetId}"]`) !== target
    && container.querySelector(`[data-edit-id="${siblingId}"]`) === sibling
    && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg
    && staticSvg.querySelector('defs') === defs;
  session.editor.undo();
  const restored = session.editor.effectiveElement(targetId);
  check('东侧手柄只预览尺寸，松手单事务提交且撤销恢复源框',
    belowThreshold && previewOnly && committedOnce
    && near(restored.x, 90) && near(restored.y, 120)
    && near(restored.w, 260) && near(restored.h, 150),
  `threshold=${belowThreshold} preview=${previewOnly} center=${previewCenter.x},${previewCenter.y}`
    + ` commit=${committedOnce} frame=${resized.x},${resized.y},${resized.w},${resized.h}`);

  const resize = (handle, start, end, modifiers = {}) => {
    container.querySelector(`[data-edit-resize-handle="${handle}"]`)
      .dispatchEvent(pointer('pointerdown', start.x, start.y, modifiers));
    view.element.dispatchEvent(pointer('pointermove', end.x, end.y, modifiers));
    const modelStable = near(session.editor.effectiveElement(targetId).w, 260);
    const previewCenter = rectCenter(container.querySelector(`[data-edit-handle="${handle}"]`));
    view.element.dispatchEvent(pointer('pointerup', end.x, end.y, modifiers));
    return { frame: session.editor.effectiveElement(targetId), modelStable, previewCenter };
  };
  const alt = resize('e', { x: 350, y: 195 }, { x: 390, y: 195 }, { altKey: true });
  const altFromCenter = alt.modelStable && near(alt.frame.x, 50) && near(alt.frame.w, 340)
    && near(alt.frame.x + alt.frame.w / 2, 220);
  session.editor.undo();
  const shift = resize('se', { x: 350, y: 270 }, { x: 430, y: 300 }, { shiftKey: true });
  const shiftRatio = shift.modelStable && near(shift.frame.x, 90) && near(shift.frame.y, 120)
    && near(shift.frame.w / shift.frame.h, 260 / 150) && shift.frame.w > 260 && shift.frame.h > 150;
  session.editor.undo();
  const both = resize('se', { x: 350, y: 270 }, { x: 390, y: 300 }, { altKey: true, shiftKey: true });
  const bothSemantics = both.modelStable && near(both.frame.x + both.frame.w / 2, 220)
    && near(both.frame.y + both.frame.h / 2, 195)
    && near(both.frame.w / both.frame.h, 260 / 150);
  session.editor.undo();
  const crossed = resize('e', { x: 350, y: 195 }, { x: 50, y: 195 });
  const crossedWithoutJump = crossed.modelStable && near(crossed.frame.x, 50) && near(crossed.frame.w, 40)
    && near(crossed.previewCenter.x, 50) && near(crossed.previewCenter.y, 195)
    && crossed.frame.flipH && !crossed.frame.flipV
    && session.editor.history.undoEntries.at(-1)?.forward.some((patch) => patch.path.at(-1) === 'flipH');
  const crossedSaved = await session.editor.save();
  const crossedReopened = await lib.openEditor(crossedSaved, { idPrefix: 'editor-resize-flip-reopen-' });
  const crossedSavedElement = Object.values(crossedReopened.editor.doc.elements)
    .find((record) => record.src.name === '普通形状');
  const crossedSavedExactly = near(crossedSavedElement.src.x, 50, 1 / 9525)
    && near(crossedSavedElement.src.w, 40, 1 / 9525) && crossedSavedElement.src.flipH;
  crossedReopened.dispose();
  session.editor.undo();
  check('Shift 等比、Alt 中心和过锚翻面可组合且各手势只有一个历史单元',
    altFromCenter && shiftRatio && bothSemantics && crossedWithoutJump && crossedSavedExactly
    && session.editor.history.undoCount === 0
    && near(session.editor.effectiveElement(targetId).w, 260)
    && !session.editor.effectiveElement(targetId).flipH,
  `alt=${altFromCenter} shift=${shiftRatio} both=${bothSemantics}`
    + ` cross=${crossedWithoutJump} saved=${crossedSavedExactly}`);

  const directionalCases = [
    ['nw', { x: 90, y: 120 }, { x: 50, y: 90 }, [50, 90, 300, 180]],
    ['n', { x: 220, y: 120 }, { x: 220, y: 90 }, [90, 90, 260, 180]],
    ['ne', { x: 350, y: 120 }, { x: 390, y: 90 }, [90, 90, 300, 180]],
    ['se', { x: 350, y: 270 }, { x: 390, y: 300 }, [90, 120, 300, 180]],
    ['s', { x: 220, y: 270 }, { x: 220, y: 300 }, [90, 120, 260, 180]],
    ['sw', { x: 90, y: 270 }, { x: 50, y: 300 }, [50, 120, 300, 180]],
    ['w', { x: 90, y: 195 }, { x: 50, y: 195 }, [50, 120, 300, 150]],
  ];
  const directionsPass = directionalCases.every(([handle, start, end, expected]) => {
    const result = resize(handle, start, end);
    const matches = [result.frame.x, result.frame.y, result.frame.w, result.frame.h]
      .every((value, index) => near(value, expected[index]));
    session.editor.undo();
    return result.modelStable && matches;
  });
  check('四角双轴、四边单轴的 8 个缩放方向语义完整', directionsPass);

  container.querySelector('[data-edit-resize-handle="se"]')
    .dispatchEvent(pointer('pointerdown', 350, 270));
  view.element.dispatchEvent(pointer('pointermove', 390, 300));
  const freeCorner = rectCenter(container.querySelector('[data-edit-handle="se"]'));
  view.element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Shift', shiftKey: true, bubbles: true,
  }));
  const constrainedCorner = rectCenter(container.querySelector('[data-edit-handle="se"]'));
  view.element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
  const releasedCorner = rectCenter(container.querySelector('[data-edit-handle="se"]'));
  view.element.dispatchEvent(pointer('pointercancel', 390, 300));
  check('手势中按下或释放 Shift 会立即切换等比预览且不提前写模型',
    near(freeCorner.x, 390) && near(freeCorner.y, 300)
    && near(constrainedCorner.x, 402) && near(constrainedCorner.y, 300)
    && near(releasedCorner.x, 390) && near(releasedCorner.y, 300)
    && near(session.editor.effectiveElement(targetId).w, 260)
    && session.editor.history.undoCount === 0);
  session.dispose();

  const spaceBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-space.pptx')));
  const spaceSession = await lib.openEditor(spaceBytes, { idPrefix: 'editor-resize-space-' });
  const spaceContainer = document.createElement('div');
  const spaceView = spaceSession.mount(spaceContainer, { mode: 'edit', textMode: 'svg' });
  const byName = (name) => Object.values(spaceSession.editor.doc.elements)
    .find((record) => record.src.name === name);
  const rotated = byName('space-rotated-flipped');
  spaceSession.editor.select({ kind: 'elements', ids: [rotated.id], enteredGroup: null });
  const rotatedNwBefore = rectCenter(spaceContainer.querySelector('[data-edit-handle="nw"]'));
  spaceContainer.querySelector('[data-edit-resize-handle="se"]')
    .dispatchEvent(pointer('pointerdown', 521.047500381816, 255.70337126663543));
  spaceView.element.dispatchEvent(pointer('pointermove', 544.621264011061, 299.79733534736295));
  const rotatedSePreview = rectCenter(spaceContainer.querySelector('[data-edit-handle="se"]'));
  const rotatedPreview = near(rotatedSePreview.x, 544.621264011061, 1e-6)
    && near(rotatedSePreview.y, 299.79733534736295, 1e-6)
    && near(spaceSession.editor.effectiveElement(rotated.id).w, 200);
  spaceView.element.dispatchEvent(pointer('pointerup', 544.621264011061, 299.79733534736295));
  const rotatedFrame = spaceSession.editor.effectiveElement(rotated.id);
  const rotatedNwAfter = rectCenter(spaceContainer.querySelector('[data-edit-handle="nw"]'));
  const rotatedAnchored = rotatedPreview
    && near(rotatedFrame.x, 351.7868818146225) && near(rotatedFrame.y, 87.04698204036373)
    && near(rotatedFrame.w, 240) && near(rotatedFrame.h, 170)
    && rotatedFrame.flipH && !rotatedFrame.flipV
    && near(rotatedNwAfter.x, rotatedNwBefore.x) && near(rotatedNwAfter.y, rotatedNwBefore.y);
  spaceSession.editor.undo();

  const nested = byName('space-nested-leaf');
  spaceSession.editor.select({ kind: 'elements', ids: [nested.id], enteredGroup: nested.parent });
  const nestedNwBefore = rectCenter(spaceContainer.querySelector('[data-edit-handle="nw"]'));
  spaceContainer.querySelector('[data-edit-resize-handle="se"]')
    .dispatchEvent(pointer('pointerdown', 908.8070075563378, 68.76329903952433));
  spaceView.element.dispatchEvent(pointer('pointermove', 894.6648719326067, 26.336892168331588));
  const nestedSePreview = rectCenter(spaceContainer.querySelector('[data-edit-handle="se"]'));
  const nestedPreview = near(nestedSePreview.x, 894.6648719326067, 1e-6)
    && near(nestedSePreview.y, 26.336892168331588, 1e-6)
    && near(spaceSession.editor.effectiveElement(nested.id).w, 140);
  spaceView.element.dispatchEvent(pointer('pointerup', 894.6648719326067, 26.336892168331588));
  const nestedFrame = spaceSession.editor.effectiveElement(nested.id);
  const nestedNwAfter = rectCenter(spaceContainer.querySelector('[data-edit-handle="nw"]'));
  const nestedAnchored = nestedPreview
    && near(nestedFrame.x, 29.182581518689048) && near(nestedFrame.y, 21.20890979123528)
    && near(nestedFrame.w, 150) && near(nestedFrame.h, 85)
    && !nestedFrame.flipH && nestedFrame.flipV
    && near(nestedNwAfter.x, nestedNwBefore.x) && near(nestedNwAfter.y, nestedNwBefore.y);
  check('旋转翻转元素与两层嵌套元素在父空间保持对角锚点',
    rotatedAnchored && nestedAnchored && spaceSession.editor.history.undoCount === 1,
  `rotated=${rotatedAnchored} frame=${rotatedFrame.x},${rotatedFrame.y},${rotatedFrame.w},${rotatedFrame.h}`
    + ` nested=${nestedAnchored} frame=${nestedFrame.x},${nestedFrame.y},${nestedFrame.w},${nestedFrame.h}`);
  spaceSession.editor.undo();

  const plain = byName('space-plain');
  spaceSession.editor.select({ kind: 'elements', ids: [plain.id, rotated.id], enteredGroup: null });
  const multiRotatedStart = rectCenter(spaceContainer.querySelector('[data-edit-handle="se"]'));
  const multiRotatedEnd = { x: multiRotatedStart.x + 120, y: multiRotatedStart.y + 70 };
  spaceContainer.querySelector('[data-edit-resize-handle="se"]')
    .dispatchEvent(pointer('pointerdown', multiRotatedStart.x, multiRotatedStart.y));
  spaceView.element.dispatchEvent(pointer('pointermove', multiRotatedEnd.x, multiRotatedEnd.y));
  const multiRotatedPreview = selectionCorners(spaceContainer);
  spaceView.element.dispatchEvent(pointer('pointerup', multiRotatedEnd.x, multiRotatedEnd.y));
  const multiRotatedCommitted = selectionCorners(spaceContainer);
  check('旋转元素参与非等比多选时提交框与缩放预览完全一致',
    sameCorners(multiRotatedPreview, multiRotatedCommitted),
  `preview=${JSON.stringify(multiRotatedPreview)} committed=${JSON.stringify(multiRotatedCommitted)}`);
  spaceSession.editor.undo();

  spaceSession.editor.select({ kind: 'elements', ids: [plain.id, rotated.id], enteredGroup: null });
  const multiCrossStart = rectCenter(spaceContainer.querySelector('[data-edit-handle="e"]'));
  const multiCrossEnd = { x: 60, y: multiCrossStart.y };
  spaceContainer.querySelector('[data-edit-resize-handle="e"]')
    .dispatchEvent(pointer('pointerdown', multiCrossStart.x, multiCrossStart.y));
  spaceView.element.dispatchEvent(pointer('pointermove', multiCrossEnd.x, multiCrossEnd.y));
  const multiCrossPreview = selectionCorners(spaceContainer);
  const multiCrossHandle = rectCenter(spaceContainer.querySelector('[data-edit-handle="e"]'));
  spaceView.element.dispatchEvent(pointer('pointerup', multiCrossEnd.x, multiCrossEnd.y));
  const multiCrossCommitted = selectionCorners(spaceContainer);
  check('旋转多选横跨锚点时活动边柄持续跟随指针',
    near(multiCrossHandle.x, multiCrossEnd.x, 0.5)
    && sameCorners(multiCrossPreview, multiCrossCommitted, 0.5),
  `handle=${multiCrossHandle.x},${multiCrossHandle.y} end=${multiCrossEnd.x},${multiCrossEnd.y}`
    + ` preview=${JSON.stringify(multiCrossPreview)} committed=${JSON.stringify(multiCrossCommitted)}`);
  spaceSession.editor.undo();

  const visualContentPoint = (record, u, v) => {
    const element = spaceSession.editor.effectiveElement(record.id);
    return lib.elementFrameToSlidePoint(spaceSession.editor.doc, record.id, {
      x: (element.flipH ? 1 - u : u) * element.w,
      y: (element.flipV ? 1 - v : v) * element.h,
    });
  };
  const resizeMultiCrossingTo = (x) => {
    spaceSession.editor.select({ kind: 'elements', ids: [plain.id, rotated.id], enteredGroup: null });
    const start = rectCenter(spaceContainer.querySelector('[data-edit-handle="e"]'));
    spaceContainer.querySelector('[data-edit-resize-handle="e"]')
      .dispatchEvent(pointer('pointerdown', start.x, start.y));
    spaceView.element.dispatchEvent(pointer('pointermove', x, start.y));
    spaceView.element.dispatchEvent(pointer('pointerup', x, start.y));
    const result = {
      frame: spaceSession.editor.effectiveElement(rotated.id),
      point: visualContentPoint(rotated, 0.2, 0.3),
    };
    spaceSession.editor.undo();
    return result;
  };
  const beforeCrossing = resizeMultiCrossingTo(80.1);
  const afterCrossing = resizeMultiCrossingTo(79.9);
  check('旋转多选越锚前后的非对称内容点连续趋近且只切换翻面',
    distance(beforeCrossing.point, afterCrossing.point) <= 0.5
    && beforeCrossing.frame.flipH === rotated.src.flipH
    && afterCrossing.frame.flipH !== rotated.src.flipH,
  `distance=${distance(beforeCrossing.point, afterCrossing.point)}`
    + ` frame=${JSON.stringify(beforeCrossing.frame)}/${JSON.stringify(afterCrossing.frame)}`);

  const rotated45 = byName('space-rotated-45');
  spaceSession.editor.select({ kind: 'elements', ids: [plain.id, rotated45.id], enteredGroup: null });
  const singularAnchor = rectCenter(spaceContainer.querySelector('[data-edit-handle="nw"]'));
  const singularStart = rectCenter(spaceContainer.querySelector('[data-edit-handle="se"]'));
  const singularEnd = { x: singularStart.x + 120, y: singularStart.y + 20 };
  spaceContainer.querySelector('[data-edit-resize-handle="se"]')
    .dispatchEvent(pointer('pointerdown', singularStart.x, singularStart.y));
  spaceView.element.dispatchEvent(pointer('pointermove', singularEnd.x, singularEnd.y));
  const singularPreview = selectionCorners(spaceContainer);
  const singularHandle = rectCenter(spaceContainer.querySelector('[data-edit-handle="se"]'));
  spaceView.element.dispatchEvent(pointer('pointerup', singularEnd.x, singularEnd.y));
  const singularCommitted = selectionCorners(spaceContainer);
  const singularFrame = spaceSession.editor.effectiveElement(rotated45.id);
  const singularScale = (singularEnd.x - singularAnchor.x) / (singularStart.x - singularAnchor.x)
    * (singularEnd.y - singularAnchor.y) / (singularStart.y - singularAnchor.y);
  const singularExpectedArea = rotated45.src.w * rotated45.src.h * singularScale;
  const singularAreaError = Math.abs(singularFrame.w * singularFrame.h - singularExpectedArea)
    / singularExpectedArea;
  check('45° 旋转多选非等比缩放仍守住活动角柄与提交框',
    near(singularHandle.x, singularEnd.x, 0.5) && near(singularHandle.y, singularEnd.y, 0.5)
    && sameCorners(singularPreview, singularCommitted, 0.5) && singularAreaError <= 0.15,
  `handle=${singularHandle.x},${singularHandle.y} end=${singularEnd.x},${singularEnd.y}`
    + ` area=${singularFrame.w * singularFrame.h}/${singularExpectedArea}`
    + ` preview=${JSON.stringify(singularPreview)} committed=${JSON.stringify(singularCommitted)}`);
  const multiSaved = await spaceSession.editor.save();
  const multiReopened = await lib.openEditor(multiSaved, { idPrefix: 'editor-resize-multi-reopen-' });
  const multiSavedExactly = [plain, rotated45].every((sourceRecord) => {
    const live = spaceSession.editor.effectiveElement(sourceRecord.id);
    const reopened = Object.values(multiReopened.editor.doc.elements)
      .find((record) => record.src.name === sourceRecord.src.name)?.src;
    return reopened && ['x', 'y', 'w', 'h', 'rot'].every((field) =>
      near(live[field], reopened[field], 1 / 9525))
      && live.flipH === reopened.flipH && live.flipV === reopened.flipV;
  });
  check('旋转多选的尺寸、角度与翻面保存重开保持 1 EMU 精度', multiSavedExactly);
  multiReopened.dispose();
  spaceSession.editor.undo();

  const outer = byName('space-outer-group');
  const groupSource = spaceSession.editor.effectiveElement(outer.id);
  spaceSession.editor.select({ kind: 'elements', ids: [outer.id], enteredGroup: null });
  const groupStart = rectCenter(spaceContainer.querySelector('[data-edit-handle="se"]'));
  const groupEnd = { x: groupStart.x + 80, y: groupStart.y + 50 };
  spaceContainer.querySelector('[data-edit-resize-handle="se"]')
    .dispatchEvent(pointer('pointerdown', groupStart.x, groupStart.y));
  spaceView.element.dispatchEvent(pointer('pointermove', groupEnd.x, groupEnd.y));
  spaceView.element.dispatchEvent(pointer('pointerup', groupEnd.x, groupEnd.y));
  const groupLive = spaceSession.editor.effectiveElement(outer.id);
  spaceSession.editor.select({ kind: 'elements', ids: [nested.id], enteredGroup: nested.parent });
  const liveLeafCorners = selectionCorners(spaceContainer);
  const groupSaved = await spaceSession.editor.save();
  const groupReopened = await lib.openEditor(groupSaved, { idPrefix: 'editor-resize-group-reopen-' });
  const groupReopenContainer = document.createElement('div');
  groupReopened.mount(groupReopenContainer, { mode: 'edit', textMode: 'svg' });
  const savedOuter = Object.values(groupReopened.editor.doc.elements)
    .find((record) => record.src.name === 'space-outer-group');
  const savedNested = Object.values(groupReopened.editor.doc.elements)
    .find((record) => record.src.name === 'space-nested-leaf');
  groupReopened.editor.select({ kind: 'elements', ids: [savedNested.id], enteredGroup: savedNested.parent });
  const savedLeafCorners = selectionCorners(groupReopenContainer);
  const savedGroup = groupReopened.editor.effectiveElement(savedOuter.id);
  check('直接缩放组后实时子坐标投影与保存重开一致',
    near(groupLive.scaleX, savedGroup.scaleX, 1 / 9525)
    && near(groupLive.scaleY, savedGroup.scaleY, 1 / 9525)
    && sameCorners(liveLeafCorners, savedLeafCorners, 1 / 9525),
  `scale=${groupLive.scaleX},${groupLive.scaleY}/${savedGroup.scaleX},${savedGroup.scaleY}`
    + ` live=${JSON.stringify(liveLeafCorners)} saved=${JSON.stringify(savedLeafCorners)}`);
  groupReopened.dispose();
  spaceSession.editor.undo();
  spaceSession.dispose();

  const multiBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-60.pptx')));
  const multiSession = await lib.openEditor(multiBytes, { idPrefix: 'editor-resize-multi-' });
  const multiContainer = document.createElement('div');
  const multiView = multiSession.mount(multiContainer, { mode: 'edit', textMode: 'svg' });
  const [firstId, secondId, thirdId] = multiSession.editor.doc.slides[multiView.slideId].children;
  multiSession.editor.select({ kind: 'elements', ids: [firstId, secondId], enteredGroup: null });
  const firstNode = multiContainer.querySelector(`[data-edit-id="${firstId}"]`);
  const secondNode = multiContainer.querySelector(`[data-edit-id="${secondId}"]`);
  const thirdNode = multiContainer.querySelector(`[data-edit-id="${thirdId}"]`);
  multiContainer.querySelector('[data-edit-resize-handle="se"]')
    .dispatchEvent(pointer('pointerdown', 256, 110));
  multiView.element.dispatchEvent(pointer('pointermove', 374, 155));
  const multiPreviewCenter = rectCenter(multiContainer.querySelector('[data-edit-handle="se"]'));
  const multiPreview = multiContainer.querySelectorAll('[data-edit-resize-ghost]').length === 2
    && near(multiPreviewCenter.x, 374) && near(multiPreviewCenter.y, 155)
    && near(multiSession.editor.effectiveElement(firstId).w, 112)
    && multiContainer.querySelector(`[data-edit-id="${firstId}"]`) === firstNode
    && multiContainer.querySelector(`[data-edit-id="${secondId}"]`) === secondNode;
  multiView.element.dispatchEvent(pointer('pointerup', 374, 155));
  const firstResized = multiSession.editor.effectiveElement(firstId);
  const secondResized = multiSession.editor.effectiveElement(secondId);
  const multiCommitted = near(firstResized.x, 20) && near(firstResized.y, 20)
    && near(firstResized.w, 168) && near(firstResized.h, 135)
    && near(secondResized.x, 206) && near(secondResized.y, 20)
    && near(secondResized.w, 168) && near(secondResized.h, 135)
    && multiSession.editor.history.undoCount === 1
    && multiSession.editor.history.undoEntries[0].label === '缩放元素'
    && multiContainer.querySelector(`[data-edit-id="${firstId}"]`) !== firstNode
    && multiContainer.querySelector(`[data-edit-id="${secondId}"]`) !== secondNode
    && multiContainer.querySelector(`[data-edit-id="${thirdId}"]`) === thirdNode;
  multiSession.editor.undo();
  check('多选按共同 AABB 比例缩放并在一个事务中提交全部根元素',
    multiPreview && multiCommitted
    && near(multiSession.editor.effectiveElement(firstId).w, 112)
    && near(multiSession.editor.effectiveElement(secondId).x, 144),
  `preview=${multiPreview} commit=${multiCommitted}`);
  multiSession.dispose();

  const cancelSession = await lib.openEditor(bytes, { idPrefix: 'editor-resize-cancel-' });
  const cancelContainer = document.createElement('div');
  const cancelView = cancelSession.mount(cancelContainer, { mode: 'edit', textMode: 'svg' });
  const [cancelId, cancelSiblingId] = cancelSession.editor.doc.slides[cancelView.slideId].children;
  cancelSession.editor.select({ kind: 'elements', ids: [cancelId], enteredGroup: null });
  const beginCancelledResize = () => {
    cancelContainer.querySelector('[data-edit-resize-handle="e"]')
      .dispatchEvent(pointer('pointerdown', 350, 195));
    cancelView.element.dispatchEvent(pointer('pointermove', 390, 195));
    return !!cancelContainer.querySelector('[data-edit-resize-ghost]');
  };
  const pointerStarted = beginCancelledResize();
  cancelView.element.dispatchEvent(pointer('pointercancel', 390, 195));
  const pointerCancelled = !cancelContainer.querySelector('[data-edit-resize-ghost]');
  const escapeStarted = beginCancelledResize();
  cancelView.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const escaped = !cancelContainer.querySelector('[data-edit-resize-ghost]');
  const lostStarted = beginCancelledResize();
  cancelView.element.dispatchEvent(pointer('lostpointercapture', 390, 195));
  const lost = !cancelContainer.querySelector('[data-edit-resize-ghost]');
  const externalStarted = beginCancelledResize();
  cancelSession.editor.select({ kind: 'elements', ids: [cancelSiblingId], enteredGroup: null });
  const external = !cancelContainer.querySelector('[data-edit-resize-ghost]');
  const zoomStarted = beginCancelledResize();
  cancelView.setZoom(1.25);
  const zoomed = !cancelContainer.querySelector('[data-edit-resize-ghost]');
  const pageStarted = beginCancelledResize();
  cancelView.setSlide(cancelSession.editor.doc.slideOrder[1]);
  const paged = !cancelContainer.querySelector('[data-edit-resize-ghost]');
  cancelView.setSlide(cancelSession.editor.doc.slideOrder[0]);
  const modeStarted = beginCancelledResize();
  cancelView.setMode('view');
  const viewed = !cancelContainer.querySelector('[data-edit-resize-ghost]');
  cancelView.setMode('edit');
  const destroyStarted = beginCancelledResize();
  cancelView.destroy();
  const cancelPass = [
    pointerStarted, escapeStarted, lostStarted, externalStarted,
    zoomStarted, pageStarted, modeStarted, destroyStarted,
    pointerCancelled, escaped, lost, external, zoomed, paged, viewed,
  ].every(Boolean)
    && cancelSession.editor.history.undoCount === 0
    && near(cancelSession.editor.effectiveElement(cancelId).w, 260)
    && cancelContainer.childElementCount === 0;
  check('八类中断路径都拆除缩放幽灵且不提交历史', cancelPass);
  cancelSession.dispose();
}
