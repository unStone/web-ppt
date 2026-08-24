/** 只经过发布会话与 DOM 手势观察吸附，确保求解、幽灵、参考线与历史是同一次用户操作。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const near = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) <= epsilon;
const pointer = (type, x, y, init = {}) => new MouseEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y, ...init,
});

export async function runSnapGestureContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 移动吸附与智能参考线\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-snap.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-snap-' });
  const container = document.createElement('div');
  const view = session.mount(container, { mode: 'edit', textMode: 'svg' });
  const byName = (name) => Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === name);
  const target = byName('snap-threshold-target');
  session.editor.select({ kind: 'elements', ids: [target.id], enteredGroup: null });
  const node = container.querySelector(`[data-edit-id="${target.id}"]`);
  node.dispatchEvent(pointer('pointerdown', 110, 110));
  view.element.dispatchEvent(pointer('pointermove', 204, 110));
  const ghost = container.querySelector('[data-edit-drag-ghost]');
  const guide = container.querySelector('[data-edit-snap-guide="x"]');
  const preview = ghost?.getAttribute('transform') === 'translate(100 0)'
    && near(Number(guide?.getAttribute('x1')), 300)
    && near(Number(guide?.getAttribute('x2')), 300)
    && near(session.editor.effectiveElement(target.id).x, 100);
  view.element.dispatchEvent(pointer('pointerup', 204, 110));
  const committed = session.editor.effectiveElement(target.id);
  const commit = near(committed.x, 200) && near(committed.y, 100)
    && session.editor.history.undoCount === 1
    && !container.querySelector('[data-edit-snap-guides]');
  session.editor.undo();
  check('屏幕 6px 阈值边界会吸到同组兄弟边并只提交一次',
    preview && commit && near(session.editor.effectiveElement(target.id).x, 100),
  `preview=${preview} commit=${committed.x},${committed.y}`);

  const thresholdSibling = byName('snap-threshold-sibling');
  session.editor.select({
    kind: 'elements', ids: [target.id, thresholdSibling.id], enteredGroup: null,
  });
  container.querySelector(`[data-edit-id="${target.id}"]`)
    .dispatchEvent(pointer('pointerdown', 110, 110));
  view.element.dispatchEvent(pointer('pointermove', 204, 110));
  const multiPreview = container.querySelectorAll('[data-edit-drag-ghost]').length === 2
    && [...container.querySelectorAll('[data-edit-drag-ghost]')]
      .every((ghostNode) => ghostNode.getAttribute('transform') === 'translate(100 0)')
    && near(Number(container.querySelector('[data-edit-snap-guide="x"]')?.getAttribute('x1')), 500);
  view.element.dispatchEvent(pointer('pointerup', 204, 110));
  const multiTarget = session.editor.effectiveElement(target.id);
  const multiSibling = session.editor.effectiveElement(thresholdSibling.id);
  check('多选以共同 AABB 吸附并把同一位移作为一个撤销单元',
    multiPreview && near(multiTarget.x, 200) && near(multiSibling.x, 400)
      && session.editor.history.undoCount === 1
      && session.editor.history.undoEntries[0].label === '移动元素');
  session.editor.undo();

  view.setSlide(session.editor.doc.slideOrder[1]);
  const priorityTarget = byName('snap-priority-target');
  session.editor.select({ kind: 'elements', ids: [priorityTarget.id], enteredGroup: null });
  const priorityNode = container.querySelector(`[data-edit-id="${priorityTarget.id}"]`);
  priorityNode.dispatchEvent(pointer('pointerdown', 110, 260));
  view.element.dispatchEvent(pointer('pointermove', 457, 260));
  const priorityGuide = container.querySelector('[data-edit-snap-guide="x"]');
  const priorityPreview = container.querySelector('[data-edit-drag-ghost]')
    ?.getAttribute('transform') === 'translate(350 0)'
    && priorityGuide?.getAttribute('data-edit-snap-source') === 'canvas-center'
    && near(Number(priorityGuide.getAttribute('x1')), 500);
  view.element.dispatchEvent(pointer('pointerup', 457, 260));
  const priorityCommit = session.editor.effectiveElement(priorityTarget.id);
  check('画布中线在 6px 内优先于距离更近的元素边',
    priorityPreview && near(priorityCommit.x, 450),
  `preview=${priorityPreview} x=${priorityCommit.x} source=${priorityGuide?.getAttribute('data-edit-snap-source')}`);

  view.setSlide(session.editor.doc.slideOrder[2]);
  const centerTarget = byName('snap-center-target');
  session.editor.select({ kind: 'elements', ids: [centerTarget.id], enteredGroup: null });
  const centerNode = container.querySelector(`[data-edit-id="${centerTarget.id}"]`);
  centerNode.dispatchEvent(pointer('pointerdown', 110, 110));
  view.element.dispatchEvent(pointer('pointermove', 405, 345));
  const centerX = container.querySelector('[data-edit-snap-guide="x"]');
  const centerY = container.querySelector('[data-edit-snap-guide="y"]');
  const centerPreview = container.querySelector('[data-edit-drag-ghost]')
    ?.getAttribute('transform') === 'translate(300 240)'
    && centerX?.getAttribute('data-edit-snap-source') === 'element-center'
    && centerY?.getAttribute('data-edit-snap-source') === 'element-center'
    && near(Number(centerX.getAttribute('x1')), 450)
    && near(Number(centerY.getAttribute('y1')), 380);
  view.element.dispatchEvent(pointer('pointerup', 405, 345));
  const centerCommit = session.editor.effectiveElement(centerTarget.id);
  check('宽高不同的同组兄弟可在两轴以中线吸附',
    centerPreview && near(centerCommit.x, 400) && near(centerCommit.y, 340),
  `preview=${centerPreview} xy=${centerCommit.x},${centerCommit.y}`);

  view.setSlide(session.editor.doc.slideOrder[3]);
  const canvasTarget = byName('snap-canvas-target');
  session.editor.select({ kind: 'elements', ids: [canvasTarget.id], enteredGroup: null });
  const canvasNode = container.querySelector(`[data-edit-id="${canvasTarget.id}"]`);
  canvasNode.dispatchEvent(pointer('pointerdown', 110, 110));
  view.element.dispatchEvent(pointer('pointermove', 905, 525));
  const canvasX = container.querySelector('[data-edit-snap-guide="x"]');
  const canvasY = container.querySelector('[data-edit-snap-guide="y"]');
  const canvasPreview = container.querySelector('[data-edit-drag-ghost]')
    ?.getAttribute('transform') === 'translate(800 420)'
    && canvasX?.getAttribute('data-edit-snap-source') === 'canvas-edge'
    && canvasY?.getAttribute('data-edit-snap-source') === 'canvas-edge'
    && near(Number(canvasX.getAttribute('x1')), 1000)
    && near(Number(canvasY.getAttribute('y1')), 600);
  view.element.dispatchEvent(pointer('pointerup', 905, 525));
  const canvasCommit = session.editor.effectiveElement(canvasTarget.id);
  check('选区外边可吸到画布四边且参考线沿整页展开',
    canvasPreview && near(canvasCommit.x, 900) && near(canvasCommit.y, 520),
  `preview=${canvasPreview} xy=${canvasCommit.x},${canvasCommit.y}`);

  view.setSlide(session.editor.doc.slideOrder[4]);
  const spacingTarget = byName('snap-spacing-target');
  session.editor.select({ kind: 'elements', ids: [spacingTarget.id], enteredGroup: null });
  const spacingNode = container.querySelector(`[data-edit-id="${spacingTarget.id}"]`);
  spacingNode.dispatchEvent(pointer('pointerdown', 60, 110));
  view.element.dispatchEvent(pointer('pointermove', 654, 110));
  const spacingGuide = container.querySelector('[data-edit-spacing-guide="x"]');
  const segments = [...(spacingGuide?.querySelectorAll('[data-edit-spacing-segment]') ?? [])];
  const spacingPreview = container.querySelector('[data-edit-drag-ghost]')
    ?.getAttribute('transform') === 'translate(600 0)'
    && spacingGuide?.getAttribute('data-edit-snap-source') === 'equal-spacing'
    && segments.length === 2
    && near(Number(segments[0].getAttribute('x1')), 330)
    && near(Number(segments[0].getAttribute('x2')), 450)
    && near(Number(segments[1].getAttribute('x1')), 530)
    && near(Number(segments[1].getAttribute('x2')), 650)
    && spacingGuide.querySelectorAll('[data-edit-spacing-arrow]').length === 4;
  view.element.dispatchEvent(pointer('pointerup', 654, 110));
  const spacingCommit = session.editor.effectiveElement(spacingTarget.id);
  check('相邻间距可线性求解并用两段双向箭头提示等距',
    spacingPreview && near(spacingCommit.x, 650),
  `preview=${spacingPreview} x=${spacingCommit.x} segments=${segments.length}`);

  const verticalSpacingTarget = byName('snap-spacing-vertical-target');
  session.editor.select({
    kind: 'elements', ids: [verticalSpacingTarget.id], enteredGroup: null,
  });
  const verticalSpacingNode = container
    .querySelector(`[data-edit-id="${verticalSpacingTarget.id}"]`);
  verticalSpacingNode.dispatchEvent(pointer('pointerdown', 810, 460));
  view.element.dispatchEvent(pointer('pointermove', 810, 226));
  const verticalSpacingGuide = container.querySelector('[data-edit-spacing-guide="y"]');
  const verticalSegments = [
    ...(verticalSpacingGuide?.querySelectorAll('[data-edit-spacing-segment]') ?? []),
  ];
  const verticalSpacingPreview = container.querySelector('[data-edit-drag-ghost]')
    ?.getAttribute('transform') === 'translate(0 -240)'
    && verticalSpacingGuide?.getAttribute('data-edit-snap-source') === 'equal-spacing'
    && verticalSegments.length === 2
    && near(Number(verticalSegments[0].getAttribute('y1')), 130)
    && near(Number(verticalSegments[0].getAttribute('y2')), 210)
    && near(Number(verticalSegments[1].getAttribute('y1')), 290)
    && near(Number(verticalSegments[1].getAttribute('y2')), 370)
    && verticalSpacingGuide.querySelectorAll('[data-edit-spacing-arrow]').length === 4;
  view.element.dispatchEvent(pointer('pointerup', 810, 226));
  const verticalSpacingCommit = session.editor.effectiveElement(verticalSpacingTarget.id);
  check('纵向相邻间距与横向共用线性求解和双向箭头语义',
    verticalSpacingPreview && near(verticalSpacingCommit.y, 210),
  `preview=${verticalSpacingPreview} y=${verticalSpacingCommit.y} segments=${verticalSegments.length}`);

  view.setSlide(session.editor.doc.slideOrder[5]);
  const groupTarget = byName('snap-group-target');
  const snapGroup = byName('snap-group');
  session.editor.select({
    kind: 'elements', ids: [groupTarget.id], enteredGroup: snapGroup.id,
  });
  const groupNode = container.querySelector(`[data-edit-id="${groupTarget.id}"]`);
  groupNode.dispatchEvent(pointer('pointerdown', 150, 250));
  view.element.dispatchEvent(pointer('pointermove', 264, 250));
  const groupPreview = container.querySelector('[data-edit-drag-ghost]')
    ?.getAttribute('transform') === 'translate(60 0)'
    && container.querySelector('[data-edit-selection-ids]')
      ?.getAttribute('transform') === 'translate(120 0)'
    && near(Number(container.querySelector('[data-edit-snap-guide="x"]')?.getAttribute('x1')), 340);
  view.element.dispatchEvent(pointer('pointerup', 264, 250));
  const groupCommit = session.editor.effectiveElement(groupTarget.id);
  check('组内只与直接兄弟吸附，世界位移再反解回组的子坐标',
    groupPreview && near(groupCommit.x, 80) && near(groupCommit.y, 20),
  `preview=${groupPreview} xy=${groupCommit.x},${groupCommit.y}`);

  const slideElement = (slideIndex, name) => session.editor.doc.slides[
    session.editor.doc.slideOrder[slideIndex]
  ].children.map((id) => session.editor.doc.elements[id])
    .find((record) => record.src.name === name);
  const edgePriority = [];
  for (const slideIndex of [6, 7]) {
    view.setSlide(session.editor.doc.slideOrder[slideIndex]);
    const edgeTarget = slideElement(slideIndex, 'snap-priority-edge-target');
    session.editor.select({ kind: 'elements', ids: [edgeTarget.id], enteredGroup: null });
    container.querySelector(`[data-edit-id="${edgeTarget.id}"]`)
      .dispatchEvent(pointer('pointerdown', 30, 110));
    view.element.dispatchEvent(pointer('pointermove', 410, 110));
    const edgeGuide = container.querySelector('[data-edit-snap-guide="x"]');
    const preview = container.querySelector('[data-edit-drag-ghost]')
      ?.getAttribute('transform') === 'translate(384 0)'
      && edgeGuide?.getAttribute('data-edit-snap-source') === 'element-edge'
      && near(Number(edgeGuide.getAttribute('x1')), 504);
    view.element.dispatchEvent(pointer('pointerup', 410, 110));
    const committed = session.editor.effectiveElement(edgeTarget.id);
    edgePriority.push(preview && near(committed.x, 404));
    session.editor.undo();
  }
  check('元素边优先于更近的元素中线和精确等距，且兄弟反序不改变结果',
    edgePriority.every(Boolean), `states=${edgePriority.join('/')}`);

  view.setSlide(session.editor.doc.slideOrder[8]);
  const centerPriorityTarget = slideElement(8, 'snap-priority-edge-target');
  session.editor.select({
    kind: 'elements', ids: [centerPriorityTarget.id], enteredGroup: null,
  });
  container.querySelector(`[data-edit-id="${centerPriorityTarget.id}"]`)
    .dispatchEvent(pointer('pointerdown', 30, 110));
  view.element.dispatchEvent(pointer('pointermove', 410, 110));
  const centerPriorityGuide = container.querySelector('[data-edit-snap-guide="x"]');
  const centerPriorityPreview = container.querySelector('[data-edit-drag-ghost]')
    ?.getAttribute('transform') === 'translate(382 0)'
    && centerPriorityGuide?.getAttribute('data-edit-snap-source') === 'element-center'
    && near(Number(centerPriorityGuide.getAttribute('x1')), 452);
  view.element.dispatchEvent(pointer('pointerup', 410, 110));
  check('元素中线优先于距离更近的精确等距候选', centerPriorityPreview
    && near(session.editor.effectiveElement(centerPriorityTarget.id).x, 402));
  session.dispose();

  const marginSession = await lib.openEditor(bytes, { idPrefix: 'editor-snap-margin-' });
  const marginContainer = document.createElement('div');
  const marginView = marginSession.mount(marginContainer, {
    mode: 'edit', textMode: 'svg', slideId: marginSession.editor.doc.slideOrder[3],
    snapMargins: { left: 40, right: 60, top: 30, bottom: 50 },
  });
  const marginTarget = Object.values(marginSession.editor.doc.elements)
    .find((record) => record.src.name === 'snap-canvas-target');
  marginSession.editor.select({ kind: 'elements', ids: [marginTarget.id], enteredGroup: null });
  const marginNode = marginContainer.querySelector(`[data-edit-id="${marginTarget.id}"]`);
  marginNode.dispatchEvent(pointer('pointerdown', 110, 110));
  marginView.element.dispatchEvent(pointer('pointermove', 56, 46));
  const marginX = marginContainer.querySelector('[data-edit-snap-guide="x"]');
  const marginY = marginContainer.querySelector('[data-edit-snap-guide="y"]');
  const marginPreview = marginContainer.querySelector('[data-edit-drag-ghost]')
    ?.getAttribute('transform') === 'translate(-60 -70)'
    && marginX?.getAttribute('data-edit-snap-source') === 'page-margin'
    && marginY?.getAttribute('data-edit-snap-source') === 'page-margin'
    && near(Number(marginX.getAttribute('x1')), 40)
    && near(Number(marginY.getAttribute('y1')), 30);
  marginView.element.dispatchEvent(pointer('pointerup', 56, 46));
  const marginCommit = marginSession.editor.effectiveElement(marginTarget.id);
  const marginLeftTop = marginPreview && near(marginCommit.x, 40) && near(marginCommit.y, 30);
  marginSession.editor.undo();
  marginContainer.querySelector(`[data-edit-id="${marginTarget.id}"]`)
    .dispatchEvent(pointer('pointerdown', 110, 110));
  marginView.element.dispatchEvent(pointer('pointermove', 856, 486));
  const marginRight = marginContainer.querySelector('[data-edit-snap-guide="x"]');
  const marginBottom = marginContainer.querySelector('[data-edit-snap-guide="y"]');
  const marginRightBottomPreview = marginContainer.querySelector('[data-edit-drag-ghost]')
    ?.getAttribute('transform') === 'translate(740 370)'
    && marginRight?.getAttribute('data-edit-snap-source') === 'page-margin'
    && marginBottom?.getAttribute('data-edit-snap-source') === 'page-margin'
    && near(Number(marginRight.getAttribute('x1')), 940)
    && near(Number(marginBottom.getAttribute('y1')), 550);
  marginView.element.dispatchEvent(pointer('pointerup', 856, 486));
  const marginRightBottomCommit = marginSession.editor.effectiveElement(marginTarget.id);
  check('四侧页边距只由视图显式配置并在屏幕 6px 内吸附',
    marginLeftTop && marginRightBottomPreview
      && near(marginRightBottomCommit.x, 840) && near(marginRightBottomCommit.y, 470),
  `leftTop=${marginLeftTop} rightBottom=${marginRightBottomPreview}`);
  marginSession.dispose();

  const controlSession = await lib.openEditor(bytes, { idPrefix: 'editor-snap-control-' });
  const controlContainer = document.createElement('div');
  const controlView = controlSession.mount(controlContainer, { mode: 'edit', textMode: 'svg' });
  const controlTarget = Object.values(controlSession.editor.doc.elements)
    .find((record) => record.src.name === 'snap-threshold-target');
  controlSession.editor.select({ kind: 'elements', ids: [controlTarget.id], enteredGroup: null });
  const controlNode = controlContainer.querySelector(`[data-edit-id="${controlTarget.id}"]`);
  const controlGhost = () => controlContainer.querySelector('[data-edit-drag-ghost]')
    ?.getAttribute('transform');
  controlNode.dispatchEvent(pointer('pointerdown', 110, 110));
  controlView.element.dispatchEvent(pointer('pointermove', 204, 110));
  const guideLayer = controlContainer.querySelector('[data-edit-snap-guides]');
  const guideNodes = [guideLayer, ...guideLayer.querySelectorAll('*')];
  const enabled = controlGhost() === 'translate(100 0)'
    && !!controlContainer.querySelector('[data-edit-snap-guide="x"]');
  const consumed = !controlView.element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Control', ctrlKey: true, bubbles: true, cancelable: true,
  }));
  const disabled = controlGhost() === 'translate(94 0)'
    && !controlContainer.querySelector('[data-edit-snap-guide="x"]');
  controlView.element.dispatchEvent(new KeyboardEvent('keyup', {
    key: 'Control', ctrlKey: false, bubbles: true, cancelable: true,
  }));
  const restored = controlGhost() === 'translate(100 0)'
    && !!controlContainer.querySelector('[data-edit-snap-guide="x"]')
    && [guideLayer, ...guideLayer.querySelectorAll('*')]
      .every((node, index) => node === guideNodes[index]);
  controlView.element.dispatchEvent(pointer('pointerup', 204, 110));
  check('Ctrl 动态开关只改固定参考线节点的属性与显隐',
    enabled && consumed && disabled && restored
      && near(controlSession.editor.effectiveElement(controlTarget.id).x, 200),
  `state=${enabled}/${consumed}/${disabled}/${restored}`);
  controlSession.editor.undo();
  let globalSwitch = false;
  if (typeof controlView.setSnapping === 'function') {
    controlView.setSnapping(false);
    controlContainer.querySelector(`[data-edit-id="${controlTarget.id}"]`)
      .dispatchEvent(pointer('pointerdown', 110, 110));
    controlView.element.dispatchEvent(pointer('pointermove', 204, 110));
    const raw = controlGhost() === 'translate(94 0)'
      && !controlContainer.querySelector('[data-edit-snap-guide="x"]');
    controlView.element.dispatchEvent(pointer('pointerup', 204, 110));
    controlView.setSnapping(true);
    globalSwitch = raw && controlView.snapping === true
      && near(controlSession.editor.effectiveElement(controlTarget.id).x, 194);
  }
  check('视图级开关可在不重建会话的前提下全局关闭吸附', globalSwitch);
  controlSession.dispose();

  const cancelSession = await lib.openEditor(bytes, { idPrefix: 'editor-snap-cancel-' });
  const cancelContainer = document.createElement('div');
  const cancelView = cancelSession.mount(cancelContainer, { mode: 'edit', textMode: 'svg' });
  const cancelTarget = Object.values(cancelSession.editor.doc.elements)
    .find((record) => record.src.name === 'snap-threshold-target');
  const cancelSibling = Object.values(cancelSession.editor.doc.elements)
    .find((record) => record.src.name === 'snap-threshold-sibling');
  const cancelSource = cancelSession.editor.effectiveElement(cancelTarget.id);
  const beginCancel = () => {
    cancelSession.editor.select({ kind: 'elements', ids: [cancelTarget.id], enteredGroup: null });
    cancelContainer.querySelector(`[data-edit-id="${cancelTarget.id}"]`)
      .dispatchEvent(pointer('pointerdown', 110, 110));
    cancelView.element.dispatchEvent(pointer('pointermove', 204, 110));
    return !!cancelContainer.querySelector('[data-edit-drag-ghost]')
      && !!cancelContainer.querySelector('[data-edit-snap-guides]');
  };
  const pointerStarted = beginCancel();
  cancelView.element.dispatchEvent(pointer('pointercancel', 204, 110));
  const pointerCleared = !cancelContainer.querySelector('[data-edit-snap-guides]');
  const escapeStarted = beginCancel();
  cancelView.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const escapeCleared = !cancelContainer.querySelector('[data-edit-snap-guides]');
  const lostStarted = beginCancel();
  cancelView.element.dispatchEvent(pointer('lostpointercapture', 204, 110));
  const lostCleared = !cancelContainer.querySelector('[data-edit-snap-guides]');
  const externalStarted = beginCancel();
  cancelSession.editor.select({ kind: 'elements', ids: [cancelSibling.id], enteredGroup: null });
  const externalCleared = !cancelContainer.querySelector('[data-edit-snap-guides]');
  const zoomStarted = beginCancel();
  cancelView.setZoom(1.25);
  const zoomCleared = !cancelContainer.querySelector('[data-edit-snap-guides]');
  cancelView.setZoom(1);
  const pageStarted = beginCancel();
  cancelView.setSlide(cancelSession.editor.doc.slideOrder[1]);
  const pageCleared = !cancelContainer.querySelector('[data-edit-snap-guides]');
  cancelView.setSlide(cancelSession.editor.doc.slideOrder[0]);
  const modeStarted = beginCancel();
  cancelView.setMode('view');
  const modeCleared = !cancelContainer.querySelector('[data-edit-snap-guides]');
  cancelView.setMode('edit');
  const switchStarted = beginCancel();
  cancelView.setSnapping(false);
  const switchCleared = !cancelContainer.querySelector('[data-edit-snap-guides]');
  cancelView.setSnapping(true);
  const destroyStarted = beginCancel();
  cancelView.destroy();
  const cancelled = [
    pointerStarted, escapeStarted, lostStarted, externalStarted,
    zoomStarted, pageStarted, modeStarted, switchStarted, destroyStarted,
    pointerCleared, escapeCleared, lostCleared, externalCleared,
    zoomCleared, pageCleared, modeCleared, switchCleared,
  ].every(Boolean)
    && cancelSession.editor.history.undoCount === 0
    && near(cancelSession.editor.effectiveElement(cancelTarget.id).x, cancelSource.x)
    && cancelContainer.childElementCount === 0;
  check('九类中断路径都清理幽灵与参考线且零提交', cancelled);
  cancelSession.dispose();
}
