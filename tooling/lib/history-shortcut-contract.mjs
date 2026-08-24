/** 历史快捷键只经过发布会话、DOM 键盘事件与公开 history/selection 验收。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyboardEvent } from './keyboard-event.mjs';
const pointer = (type, x, y) => new MouseEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y,
});

export async function runHistoryShortcutContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 撤销重做快捷键与跨页回显\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-history.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-history-' });
  const container = document.createElement('div');
  const view = session.mount(container, { mode: 'edit', textMode: 'svg' });
  const byName = (name) => Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === name);
  const first = byName('history-first');
  const peer = byName('history-peer');
  const source = session.editor.effectiveElement(first.id);
  const staticSvg = container.querySelector('[data-ppt-layer="static"] svg');
  const defs = staticSvg.querySelector('defs');
  const peerNode = container.querySelector(`[data-edit-id="${peer.id}"]`);
  session.editor.select({ kind: 'elements', ids: [first.id], enteredGroup: null });
  view.element.dispatchEvent(keyboardEvent('keydown', 'ArrowRight'));
  view.element.dispatchEvent(keyboardEvent('keyup', 'ArrowRight'));
  const accepted = view.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true }));
  const selection = session.editor.selection;
  check('Ctrl+Z 通过编辑视图撤销最近事务并恢复选区、dirty 与增量 DOM',
    !accepted && session.editor.effectiveElement(first.id).x === source.x
      && selection.kind === 'elements' && selection.ids.join(',') === first.id
      && selection.enteredGroup === null
      && session.editor.history.undoCount === 0 && session.editor.history.redoCount === 1
      && !session.editor.isDirty()
      && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg
      && staticSvg.querySelector('defs') === defs
      && container.querySelector(`[data-edit-id="${peer.id}"]`) === peerNode);
  const ctrlShiftZ = view.element.dispatchEvent(keyboardEvent('keydown', 'Z', {
    ctrlKey: true, shiftKey: true,
  }));
  const redoneByShiftZ = session.editor.effectiveElement(first.id).x === source.x + 1
    && session.editor.history.undoCount === 1 && session.editor.history.redoCount === 0
    && session.editor.isDirty();
  const metaZ = view.element.dispatchEvent(keyboardEvent('keydown', 'z', { metaKey: true }));
  const undoneByMeta = session.editor.effectiveElement(first.id).x === source.x;
  const metaY = view.element.dispatchEvent(keyboardEvent('keydown', 'Y', { metaKey: true }));
  const redoneByMetaY = session.editor.effectiveElement(first.id).x === source.x + 1;
  view.element.dispatchEvent(keyboardEvent('keydown', 'z', { metaKey: true }));
  const ctrlY = view.element.dispatchEvent(keyboardEvent('keydown', 'y', { ctrlKey: true }));
  const redoneByCtrlY = session.editor.effectiveElement(first.id).x === source.x + 1;
  view.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true }));
  const metaShiftZ = view.element.dispatchEvent(keyboardEvent('keydown', 'Z', {
    metaKey: true, shiftKey: true,
  }));
  check('Ctrl/Cmd+Shift+Z 与 Ctrl/Cmd+Y 均重做，键值大小写不影响历史指针',
    !ctrlShiftZ && redoneByShiftZ && !metaZ && undoneByMeta
      && !metaY && redoneByMetaY && !ctrlY && redoneByCtrlY && !metaShiftZ
      && session.editor.effectiveElement(first.id).x === source.x + 1
      && session.editor.history.undoCount === 1 && session.editor.history.redoCount === 0
      && session.editor.isDirty());
  session.dispose();

  const shared = await lib.openEditor(bytes, { idPrefix: 'editor-history-shared-' });
  const firstContainer = document.createElement('div');
  const otherContainer = document.createElement('div');
  const firstView = shared.mount(firstContainer, { mode: 'edit', textMode: 'svg' });
  const otherView = shared.mount(otherContainer, { mode: 'edit', textMode: 'svg' });
  const second = Object.values(shared.editor.doc.elements)
    .find((record) => record.src.name === 'history-second-page');
  const secondSlide = second.parent;
  const secondSource = shared.editor.effectiveElement(second.id);
  shared.editor.select({ kind: 'elements', ids: [second.id], enteredGroup: null });
  shared.editor.exec({ type: 'SetXfrm', id: second.id, x: secondSource.x + 7 });
  const crossUndo = firstView.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true }));
  const undoSelection = shared.editor.selection;
  const crossRedo = firstView.element.dispatchEvent(keyboardEvent('keydown', 'y', { metaKey: true }));
  check('跨页撤销重做只把收到事件的视图切到恢复选区所在页，其它共享视图保持原页',
    !crossUndo && !crossRedo && firstView.slideId === secondSlide
      && otherView.slideId === shared.editor.doc.slideOrder[0]
      && undoSelection.kind === 'elements' && undoSelection.ids.join(',') === second.id
      && shared.editor.effectiveElement(second.id).x === secondSource.x + 7
      && shared.editor.history.undoCount === 1 && shared.editor.history.redoCount === 0);
  firstView.setSlide(shared.editor.doc.slideOrder[0]);
  shared.editor.select({ kind: 'none' });
  shared.editor.exec({ type: 'SetXfrm', id: second.id, x: secondSource.x + 11 });
  firstView.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true }));
  check('历史选区为空时以首个脏页回显撤销结果',
    firstView.slideId === secondSlide && otherView.slideId === shared.editor.doc.slideOrder[0]
      && shared.editor.selection.kind === 'none'
      && shared.editor.effectiveElement(second.id).x === secondSource.x + 7
      && shared.editor.history.undoCount === 1 && shared.editor.history.redoCount === 1);
  shared.dispose();

  const guard = await lib.openEditor(bytes, { idPrefix: 'editor-history-guard-' });
  const guardContainer = document.createElement('div');
  const guardView = guard.mount(guardContainer, { mode: 'edit', textMode: 'svg' });
  const guardFirst = Object.values(guard.editor.doc.elements)
    .find((record) => record.src.name === 'history-first');
  guard.editor.select({ kind: 'elements', ids: [guardFirst.id], enteredGroup: null });
  guardView.element.dispatchEvent(keyboardEvent('keydown', 'ArrowRight'));
  guardView.element.dispatchEvent(keyboardEvent('keyup', 'ArrowRight'));
  const guardPosition = guard.editor.effectiveElement(guardFirst.id).x;
  const input = document.createElement('input');
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  const shadowHost = document.createElement('div');
  const shadowInput = document.createElement('input');
  shadowHost.attachShadow({ mode: 'open' }).append(shadowInput);
  guardView.element.append(input, editable, shadowHost);
  const controlsYield = [
    input.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true })),
    editable.dispatchEvent(keyboardEvent('keydown', 'y', { metaKey: true })),
    shadowInput.dispatchEvent(keyboardEvent('keydown', 'Z', { ctrlKey: true, shiftKey: true })),
  ].every(Boolean);
  const invalidYield = [
    guardView.element.dispatchEvent(keyboardEvent('keydown', 'z')),
    guardView.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true, metaKey: true })),
    guardView.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true, altKey: true })),
    guardView.element.dispatchEvent(keyboardEvent('keydown', 'y', { ctrlKey: true, shiftKey: true })),
  ].every(Boolean);
  guardView.setMode('view');
  const viewYields = guardView.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true }));
  guardView.setMode('edit');
  check('view 模式、原生文本控件和非规范修饰组合保留浏览器键盘所有权',
    controlsYield && invalidYield && viewYields
      && guard.editor.effectiveElement(guardFirst.id).x === guardPosition
      && guard.editor.history.undoCount === 1 && guard.editor.history.redoCount === 0);

  const dragTarget = guardContainer.querySelector(`[data-edit-id="${guardFirst.id}"]`);
  dragTarget.dispatchEvent(pointer('pointerdown', 120, 120));
  guardView.element.dispatchEvent(pointer('pointermove', 145, 135));
  const dragStarted = !!guardContainer.querySelector('[data-edit-drag-ghost]');
  const duringDrag = guardView.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true }));
  const dragPreserved = !!guardContainer.querySelector('[data-edit-drag-ghost]')
    && guard.editor.effectiveElement(guardFirst.id).x === guardPosition
    && guard.editor.history.undoCount === 1 && guard.editor.history.redoCount === 0;
  guardView.element.dispatchEvent(pointer('pointercancel', 145, 135));
  guard.editor.undo();
  guard.editor.history.clear();
  const emptyUndo = guardView.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true }));
  const emptyRedo = guardView.element.dispatchEvent(keyboardEvent('keydown', 'y', { metaKey: true }));
  check('活动 pointer 手势保留预览所有权，空历史仍消费快捷键但不产生状态',
    dragStarted && !duringDrag && dragPreserved
      && !guardContainer.querySelector('[data-edit-drag-ghost]')
      && !emptyUndo && !emptyRedo
      && guard.editor.history.undoCount === 0 && guard.editor.history.redoCount === 0
      && !guard.editor.isDirty());
  for (let index = 0; index < 3; index++) {
    guardView.element.dispatchEvent(keyboardEvent('keydown', 'ArrowRight'));
    guardView.element.dispatchEvent(keyboardEvent('keyup', 'ArrowRight'));
  }
  for (let index = 0; index < 3; index++) {
    guardView.element.dispatchEvent(keyboardEvent('keydown', 'z', {
      ctrlKey: true, repeat: index > 0,
    }));
  }
  const repeatedUndo = guard.editor.effectiveElement(guardFirst.id).x === guardFirst.src.x
    && guard.editor.history.undoCount === 0 && guard.editor.history.redoCount === 3;
  guardView.element.dispatchEvent(keyboardEvent('keydown', 'Z', {
    ctrlKey: true, shiftKey: true,
  }));
  guardView.element.dispatchEvent(keyboardEvent('keydown', 'y', { metaKey: true, repeat: true }));
  const steppedRedo = guard.editor.effectiveElement(guardFirst.id).x === guardFirst.src.x + 2
    && guard.editor.history.undoCount === 2 && guard.editor.history.redoCount === 1;
  guardView.element.dispatchEvent(keyboardEvent('keydown', 'ArrowDown'));
  guardView.element.dispatchEvent(keyboardEvent('keyup', 'ArrowDown'));
  check('连续快捷键逐项移动历史指针，撤销后的新编辑清空 redo',
    repeatedUndo && steppedRedo
      && guard.editor.effectiveElement(guardFirst.id).x === guardFirst.src.x + 2
      && guard.editor.effectiveElement(guardFirst.id).y === guardFirst.src.y + 1
      && guard.editor.history.undoCount === 3 && guard.editor.history.redoCount === 0);
  guard.dispose();

  const nested = await lib.openEditor(bytes, { idPrefix: 'editor-history-nested-view-' });
  const outerView = nested.mount(document.createElement('div'), { mode: 'edit', textMode: 'svg' });
  const innerContainer = document.createElement('div');
  outerView.element.append(innerContainer);
  const innerView = nested.mount(innerContainer, { mode: 'edit', textMode: 'svg' });
  const nestedFirst = Object.values(nested.editor.doc.elements)
    .find((record) => record.src.name === 'history-first');
  nested.editor.select({ kind: 'elements', ids: [nestedFirst.id], enteredGroup: null });
  nested.editor.exec({ type: 'SetXfrm', id: nestedFirst.id, x: nestedFirst.src.x + 1 });
  nested.editor.exec({ type: 'SetXfrm', id: nestedFirst.id, x: nestedFirst.src.x + 2 });
  const nestedAccepted = innerView.element.dispatchEvent(keyboardEvent('keydown', 'z', {
    ctrlKey: true,
  }));
  check('嵌套挂载视图只由最内层事件视图处理一次历史快捷键',
    !nestedAccepted && nested.editor.effectiveElement(nestedFirst.id).x === nestedFirst.src.x + 1
      && nested.editor.history.undoCount === 1 && nested.editor.history.redoCount === 1);
  nested.dispose();
}
