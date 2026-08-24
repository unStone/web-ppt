/** 键盘微移只经过发布会话与 DOM 事件，避免测试私有控制器。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const key = (type, value, init = {}) => new KeyboardEvent(type, {
  key: value, bubbles: true, composed: true, cancelable: true, ...init,
});
const pointer = (type, x, y) => new MouseEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y,
});

export async function runKeyboardNudgeContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 方向键微移与连续撤销\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-basic.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-keyboard-nudge-' });
  const container = document.createElement('div');
  const view = session.mount(container, { mode: 'edit', textMode: 'svg' });
  const id = session.editor.doc.slides[view.slideId].children[0];
  const source = session.editor.effectiveElement(id);
  session.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
  const staticSvg = container.querySelector('[data-ppt-layer="static"] svg');
  const target = container.querySelector(`[data-edit-id="${id}"]`);
  const history = session.editor.history.undoCount;
  const accepted = view.element.dispatchEvent(key('keydown', 'ArrowRight'));
  const moved = session.editor.effectiveElement(id);
  check('编辑视图的方向键以 1px 微移单选元素，保留选区并只增量提交一个历史单元',
    !accepted && moved.x === source.x + 1 && moved.y === source.y
      && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === id
      && session.editor.history.undoCount === history + 1
      && container.querySelector(`[data-edit-id="${id}"]`) !== target
      && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg);
  view.element.dispatchEvent(key('keyup', 'ArrowRight'));
  session.editor.undo();
  check('方向键微移可撤销并恢复原坐标与选区',
    session.editor.effectiveElement(id).x === source.x
      && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === id);
  session.dispose();

  const nestedBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-keyboard.pptx')));
  const nestedSession = await lib.openEditor(nestedBytes, { idPrefix: 'editor-keyboard-nested-' });
  const nestedContainer = document.createElement('div');
  const nestedView = nestedSession.mount(nestedContainer, { mode: 'edit', textMode: 'svg' });
  const byName = (name) => Object.values(nestedSession.editor.doc.elements)
    .find((record) => record.src.name === name);
  const leaf = byName('nudge-nested-leaf');
  const framePoints = () => (nestedContainer.querySelector('[data-edit-selection-frame]')
    ?.getAttribute('points') ?? '').trim().split(/\s+/).filter(Boolean).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
  nestedSession.editor.select({ kind: 'elements', ids: [leaf.id], enteredGroup: leaf.parent });
  const before = framePoints();
  const nestedHistory = nestedSession.editor.history.undoCount;
  const nestedAccepted = nestedView.element.dispatchEvent(key('keydown', 'ArrowRight', { shiftKey: true }));
  const after = framePoints();
  const worldTen = before.length === 4 && after.length === 4 && after.every((point, index) =>
    Math.abs(point.x - before[index].x - 10) < 1e-6
      && Math.abs(point.y - before[index].y) < 1e-6);
  check('Shift+方向键在旋转翻转非均匀缩放组内仍精确世界微移 10px',
    !nestedAccepted && worldTen
      && nestedSession.editor.selection.kind === 'elements'
      && nestedSession.editor.selection.ids[0] === leaf.id
      && nestedSession.editor.selection.enteredGroup === leaf.parent
      && nestedSession.editor.history.undoCount === nestedHistory + 1,
  `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  nestedView.element.dispatchEvent(key('keyup', 'ArrowRight'));
  nestedSession.editor.undo();
  const restored = framePoints();
  check('嵌套组微移撤销后世界 OBB 逐角恢复', restored.length === before.length
    && restored.every((point, index) => Math.abs(point.x - before[index].x) < 1e-6
      && Math.abs(point.y - before[index].y) < 1e-6));

  const plain = byName('nudge-plain');
  const rotated = byName('nudge-rotated-flipped');
  const plainBefore = nestedSession.editor.effectiveElement(plain.id);
  const rotatedBefore = nestedSession.editor.effectiveElement(rotated.id);
  nestedSession.editor.select({ kind: 'elements', ids: [plain.id, rotated.id], enteredGroup: null });
  const multiHistory = nestedSession.editor.history.undoCount;
  const multiAccepted = nestedView.element.dispatchEvent(key('keydown', 'ArrowDown'));
  const plainAfter = nestedSession.editor.effectiveElement(plain.id);
  const rotatedAfter = nestedSession.editor.effectiveElement(rotated.id);
  check('多选方向键在一个事务内为每个选择根应用相同世界位移',
    !multiAccepted
      && plainAfter.x === plainBefore.x && plainAfter.y === plainBefore.y + 1
      && rotatedAfter.x === rotatedBefore.x && rotatedAfter.y === rotatedBefore.y + 1
      && nestedSession.editor.selection.kind === 'elements'
      && nestedSession.editor.selection.ids.join(',') === `${plain.id},${rotated.id}`
      && nestedSession.editor.history.undoCount === multiHistory + 1);
  nestedView.element.dispatchEvent(key('keyup', 'ArrowDown'));
  nestedSession.editor.undo();

  nestedSession.editor.select({ kind: 'elements', ids: [plain.id], enteredGroup: null });
  const repeatSource = nestedSession.editor.effectiveElement(plain.id);
  nestedView.element.dispatchEvent(key('keydown', 'ArrowRight'));
  for (let index = 0; index < 4; index++) {
    nestedView.element.dispatchEvent(key('keydown', 'ArrowRight', { repeat: true }));
  }
  const repeated = nestedSession.editor.effectiveElement(plain.id);
  const oneHold = repeated.x === repeatSource.x + 5
    && nestedSession.editor.history.undoCount === 1;
  nestedView.element.dispatchEvent(key('keyup', 'ArrowRight'));
  nestedView.element.dispatchEvent(key('keydown', 'ArrowRight'));
  nestedView.element.dispatchEvent(key('keyup', 'ArrowRight'));
  const secondPress = nestedSession.editor.effectiveElement(plain.id).x === repeatSource.x + 6
    && nestedSession.editor.history.undoCount === 2;
  nestedSession.editor.undo();
  const firstUndo = nestedSession.editor.effectiveElement(plain.id).x === repeatSource.x + 5;
  nestedSession.editor.undo();
  check('同一物理按住的 auto-repeat 合并为一个撤销单元，keyup 后再按则分开',
    oneHold && secondPress && firstUndo
      && nestedSession.editor.effectiveElement(plain.id).x === repeatSource.x,
  `hold=${oneHold} second=${secondPress} firstUndo=${firstUndo}`);

  const oppositeSource = nestedSession.editor.effectiveElement(plain.id);
  nestedView.element.dispatchEvent(key('keydown', 'ArrowRight'));
  nestedView.element.dispatchEvent(key('keydown', 'ArrowLeft'));
  nestedView.element.dispatchEvent(key('keyup', 'ArrowLeft'));
  nestedView.element.dispatchEvent(key('keydown', 'ArrowLeft'));
  nestedView.element.dispatchEvent(key('keyup', 'ArrowLeft'));
  nestedView.element.dispatchEvent(key('keyup', 'ArrowRight'));
  const oppositeSeparated = nestedSession.editor.effectiveElement(plain.id).x === oppositeSource.x - 1
    && nestedSession.editor.history.undoCount === 3;
  nestedSession.editor.undo();
  const oppositeUndoOne = nestedSession.editor.effectiveElement(plain.id).x === oppositeSource.x;
  nestedSession.editor.undo();
  const oppositeUndoTwo = nestedSession.editor.effectiveElement(plain.id).x === oppositeSource.x + 1;
  nestedSession.editor.undo();
  check('其它方向仍按住时，同一方向松开再按也会开始新的撤销单元',
    oppositeSeparated && oppositeUndoOne && oppositeUndoTwo
    && nestedSession.editor.effectiveElement(plain.id).x === oppositeSource.x);

  const editableSource = nestedSession.editor.effectiveElement(plain.id);
  const editableHistory = nestedSession.editor.history.undoCount;
  const input = document.createElement('input');
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  const shadowHost = document.createElement('div');
  const shadowInput = document.createElement('input');
  shadowHost.attachShadow({ mode: 'open' }).append(shadowInput);
  nestedView.element.append(input, editable, shadowHost);
  const inputAccepted = input.dispatchEvent(key('keydown', 'ArrowRight'));
  const editableAccepted = editable.dispatchEvent(key('keydown', 'ArrowDown', { shiftKey: true }));
  const shadowAccepted = shadowInput.dispatchEvent(key('keydown', 'ArrowLeft'));
  check('普通与 Shadow DOM 表单控件、contenteditable 的方向键由文本编辑拥有',
    inputAccepted && editableAccepted && shadowAccepted
      && nestedSession.editor.effectiveElement(plain.id).x === editableSource.x
      && nestedSession.editor.effectiveElement(plain.id).y === editableSource.y
      && nestedSession.editor.history.undoCount === editableHistory);

  const dragTarget = nestedContainer.querySelector(`[data-edit-id="${plain.id}"]`);
  const dragSource = nestedSession.editor.effectiveElement(plain.id);
  const dragHistory = nestedSession.editor.history.undoCount;
  dragTarget.dispatchEvent(pointer('pointerdown', 120, 120));
  nestedView.element.dispatchEvent(pointer('pointermove', 140, 135));
  const dragStarted = !!nestedContainer.querySelector('[data-edit-drag-ghost]');
  const arrowDuringDragAccepted = nestedView.element.dispatchEvent(key('keydown', 'ArrowRight'));
  const dragPreserved = !!nestedContainer.querySelector('[data-edit-drag-ghost]')
    && nestedSession.editor.effectiveElement(plain.id).x === dragSource.x
    && nestedSession.editor.effectiveElement(plain.id).y === dragSource.y
    && nestedSession.editor.history.undoCount === dragHistory;
  nestedView.element.dispatchEvent(pointer('pointercancel', 140, 135));
  check('活动 pointer 手势期间方向键只阻止滚动，不提交或打断当前预览',
    dragStarted && !arrowDuringDragAccepted && dragPreserved
      && !nestedContainer.querySelector('[data-edit-drag-ghost]'));

  const blurSource = nestedSession.editor.effectiveElement(plain.id);
  nestedView.element.dispatchEvent(key('keydown', 'ArrowRight'));
  nestedView.element.dispatchEvent(new document.defaultView.Event('blur'));
  nestedView.element.dispatchEvent(key('keydown', 'ArrowRight'));
  nestedView.element.dispatchEvent(key('keyup', 'ArrowRight'));
  const blurSeparated = nestedSession.editor.effectiveElement(plain.id).x === blurSource.x + 2
    && nestedSession.editor.history.undoCount === 2;
  nestedSession.editor.undo();
  const blurUndoOne = nestedSession.editor.effectiveElement(plain.id).x === blurSource.x + 1;
  nestedSession.editor.undo();
  check('blur 在 keyup 丢失时仍结束 auto-repeat 合并序列', blurSeparated && blurUndoOne
    && nestedSession.editor.effectiveElement(plain.id).x === blurSource.x);

  const modeSource = nestedSession.editor.effectiveElement(plain.id);
  nestedView.element.dispatchEvent(key('keydown', 'ArrowRight'));
  nestedView.setMode('view');
  const viewAccepted = nestedView.element.dispatchEvent(key('keydown', 'ArrowRight'));
  nestedView.setMode('edit');
  nestedView.element.dispatchEvent(key('keydown', 'ArrowRight'));
  nestedView.element.dispatchEvent(key('keyup', 'ArrowRight'));
  const modeSeparated = viewAccepted
    && nestedSession.editor.effectiveElement(plain.id).x === modeSource.x + 2
    && nestedSession.editor.history.undoCount === 2;
  nestedSession.editor.undo();
  const modeUndoOne = nestedSession.editor.effectiveElement(plain.id).x === modeSource.x + 1;
  nestedSession.editor.undo();
  check('切换 view/edit 模式会结束未收到 keyup 的微移合并序列', modeSeparated && modeUndoOne
    && nestedSession.editor.effectiveElement(plain.id).x === modeSource.x);

  const guardSource = nestedSession.editor.effectiveElement(plain.id);
  const guardHistory = nestedSession.editor.history.undoCount;
  nestedSession.editor.select({ kind: 'none' });
  const noneAccepted = nestedView.element.dispatchEvent(key('keydown', 'ArrowRight'));
  nestedSession.editor.select({ kind: 'elements', ids: [plain.id], enteredGroup: null });
  const modifiedAccepted = [
    nestedView.element.dispatchEvent(key('keydown', 'ArrowRight', { ctrlKey: true })),
    nestedView.element.dispatchEvent(key('keydown', 'ArrowRight', { metaKey: true })),
    nestedView.element.dispatchEvent(key('keydown', 'ArrowRight', { altKey: true })),
  ].every(Boolean);
  const secondSlide = nestedSession.editor.doc.slideOrder[1];
  nestedView.setSlide(secondSlide);
  const otherPageAccepted = nestedView.element.dispatchEvent(key('keydown', 'ArrowRight'));
  nestedView.setSlide(nestedSession.editor.doc.slideOrder[0]);
  check('无元素选区、系统修饰键和非当前页选区不会劫持方向键',
    noneAccepted && modifiedAccepted && otherPageAccepted
      && nestedSession.editor.effectiveElement(plain.id).x === guardSource.x
      && nestedSession.editor.history.undoCount === guardHistory);

  nestedSession.editor.select({ kind: 'elements', ids: [plain.id, rotated.id], enteredGroup: null });
  const restrictedSource = [plain, rotated].map((record) => nestedSession.editor.effectiveElement(record.id));
  const restrictedHistory = nestedSession.editor.history.undoCount;
  rotated.meta.locked = true;
  const lockedAccepted = nestedView.element.dispatchEvent(key('keydown', 'ArrowDown'));
  rotated.meta.locked = false;
  rotated.meta.hiddenByUser = true;
  const hiddenAccepted = nestedView.element.dispatchEvent(key('keydown', 'ArrowDown'));
  rotated.meta.hiddenByUser = false;
  rotated.meta.editable = 'none';
  const uneditableAccepted = nestedView.element.dispatchEvent(key('keydown', 'ArrowDown'));
  rotated.meta.editable = 'full';
  const restrictionsStayedAtomic = [plain, rotated].every((record, index) => {
    const current = nestedSession.editor.effectiveElement(record.id);
    return current.x === restrictedSource[index].x && current.y === restrictedSource[index].y;
  });
  check('多选含锁定、隐藏或不可编辑元素时整次微移原子拒绝',
    lockedAccepted && hiddenAccepted && uneditableAccepted && restrictionsStayedAtomic
      && nestedSession.editor.history.undoCount === restrictedHistory);

  const inner = byName('nudge-inner-group');
  const innerSource = nestedSession.editor.effectiveElement(inner.id);
  const leafSource = nestedSession.editor.effectiveElement(leaf.id);
  nestedSession.editor.select({
    kind: 'elements', ids: [inner.id, leaf.id], enteredGroup: inner.parent,
  });
  const ancestorBefore = framePoints();
  nestedView.element.dispatchEvent(key('keydown', 'ArrowDown'));
  nestedView.element.dispatchEvent(key('keyup', 'ArrowDown'));
  const ancestorAfter = framePoints();
  const innerMoved = nestedSession.editor.effectiveElement(inner.id);
  const leafStayedLocal = nestedSession.editor.effectiveElement(leaf.id);
  const ancestorShiftedOnce = ancestorAfter.length === ancestorBefore.length
    && ancestorAfter.every((point, index) => Math.abs(point.x - ancestorBefore[index].x) < 1e-6
      && Math.abs(point.y - ancestorBefore[index].y - 1) < 1e-6);
  check('祖先与后代同时入选时只移动最外层选择根，世界位移不重复叠加',
    ancestorShiftedOnce
      && (innerMoved.x !== innerSource.x || innerMoved.y !== innerSource.y)
      && leafStayedLocal.x === leafSource.x && leafStayedLocal.y === leafSource.y
      && nestedSession.editor.selection.kind === 'elements'
      && nestedSession.editor.selection.ids.join(',') === `${inner.id},${leaf.id}`
      && nestedSession.editor.history.undoEntries.at(-1).forward.length === 2,
  `before=${JSON.stringify(ancestorBefore)} after=${JSON.stringify(ancestorAfter)}`);
  nestedSession.editor.undo();

  nestedSession.editor.select({ kind: 'elements', ids: [leaf.id], enteredGroup: leaf.parent });
  nestedView.element.dispatchEvent(key('keydown', 'ArrowLeft', { shiftKey: true }));
  nestedView.element.dispatchEvent(key('keyup', 'ArrowLeft'));
  const savedLive = nestedSession.editor.effectiveElement(leaf.id);
  const saved = await nestedSession.editor.save();
  const reopened = await lib.openEditor(saved, { idPrefix: 'editor-keyboard-reopen-' });
  const reopenedLeaf = Object.values(reopened.editor.doc.elements)
    .find((record) => record.src.name === 'nudge-nested-leaf');
  const savedLeaf = reopened.editor.effectiveElement(reopenedLeaf.id);
  check('键盘微移复用 SetXfrm 写回链路，保存重开后嵌套组局部坐标误差不超过 1 EMU',
    Math.abs(savedLeaf.x - savedLive.x) <= 1 / 9525
      && Math.abs(savedLeaf.y - savedLive.y) <= 1 / 9525,
  `live=${savedLive.x},${savedLive.y} saved=${savedLeaf.x},${savedLeaf.y}`);
  reopened.dispose();
  nestedSession.dispose();

  const sharedSession = await lib.openEditor(nestedBytes, { idPrefix: 'editor-keyboard-shared-' });
  const firstView = sharedSession.mount(document.createElement('div'), { mode: 'edit', textMode: 'svg' });
  const secondView = sharedSession.mount(document.createElement('div'), { mode: 'edit', textMode: 'svg' });
  const sharedPlain = Object.values(sharedSession.editor.doc.elements)
    .find((record) => record.src.name === 'nudge-plain');
  const sharedSource = sharedSession.editor.effectiveElement(sharedPlain.id);
  sharedSession.editor.select({ kind: 'elements', ids: [sharedPlain.id], enteredGroup: null });
  firstView.element.dispatchEvent(key('keydown', 'ArrowRight'));
  firstView.element.dispatchEvent(key('keyup', 'ArrowRight'));
  secondView.element.dispatchEvent(key('keydown', 'ArrowRight'));
  secondView.element.dispatchEvent(key('keyup', 'ArrowRight'));
  const sharedSeparated = sharedSession.editor.effectiveElement(sharedPlain.id).x === sharedSource.x + 2
    && sharedSession.editor.history.undoCount === 2;
  sharedSession.editor.undo();
  const sharedUndoOne = sharedSession.editor.effectiveElement(sharedPlain.id).x === sharedSource.x + 1;
  sharedSession.editor.undo();
  check('共享会话的两个视图不会把各自首次物理按键错误合并', sharedSeparated && sharedUndoOne
    && sharedSession.editor.effectiveElement(sharedPlain.id).x === sharedSource.x);
  sharedSession.dispose();

  const limitedSession = await lib.openEditor(nestedBytes, {
    idPrefix: 'editor-keyboard-limited-', historyByteLimit: 2000,
  });
  const limitedView = limitedSession.mount(document.createElement('div'), { mode: 'edit', textMode: 'svg' });
  const limitedPlain = Object.values(limitedSession.editor.doc.elements)
    .find((record) => record.src.name === 'nudge-plain');
  const limitedSource = limitedSession.editor.effectiveElement(limitedPlain.id);
  limitedSession.editor.select({ kind: 'elements', ids: [limitedPlain.id], enteredGroup: null });
  for (let index = 0; index < 120; index++) {
    limitedView.element.dispatchEvent(key('keydown', 'ArrowRight', { repeat: index > 0 }));
  }
  limitedView.element.dispatchEvent(key('keyup', 'ArrowRight'));
  const limitedEntry = limitedSession.editor.history.undoEntries[0];
  const compactHold = limitedSession.editor.effectiveElement(limitedPlain.id).x === limitedSource.x + 120
    && limitedSession.editor.history.undoCount === 1
    && limitedEntry?.forward.length === 1 && limitedEntry?.inverse.length === 1
    && limitedSession.editor.history.byteSize <= 2000;
  limitedSession.editor.undo();
  check('长按 auto-repeat 压缩同路径 patch，在小历史字节预算下仍可一次撤销', compactHold
    && limitedSession.editor.effectiveElement(limitedPlain.id).x === limitedSource.x,
  `count=${limitedSession.editor.history.undoCount} bytes=${limitedSession.editor.history.byteSize}`);
  limitedSession.dispose();
}
