/** 删除键只经过发布会话、DOM 事件、公开选区和共享视图验收。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyboardEvent } from './keyboard-event.mjs';

const pointer = (type, x, y) => new MouseEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y,
});

export async function runDeleteKeyboardContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ Delete/Backspace 元素删除\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-delete.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-delete-' });
  const eventContainer = document.createElement('div');
  const sharedContainer = document.createElement('div');
  const eventView = session.mount(eventContainer, { mode: 'edit', textMode: 'svg' });
  const sharedView = session.mount(sharedContainer, { mode: 'edit', textMode: 'svg' });
  const target = Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === 'delete-shape');
  const peer = Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === 'delete-peer');
  const peerEventNode = eventContainer.querySelector(`[data-edit-id="${peer.id}"]`);
  const peerSharedNode = sharedContainer.querySelector(`[data-edit-id="${peer.id}"]`);
  session.editor.select({ kind: 'elements', ids: [target.id], enteredGroup: null });
  const accepted = eventView.element.dispatchEvent(keyboardEvent('keydown', 'Delete'));
  check('Delete 从共享会话全部视图删除目标并形成一个可撤销事务',
    !accepted && !session.editor.doc.elements[target.id]
      && !eventContainer.querySelector(`[data-edit-id="${target.id}"]`)
      && !sharedContainer.querySelector(`[data-edit-id="${target.id}"]`)
      && !!eventContainer.querySelector(`[data-edit-id="${peer.id}"]`)
      && !!sharedContainer.querySelector(`[data-edit-id="${peer.id}"]`)
      && eventContainer.querySelector(`[data-edit-id="${peer.id}"]`) === peerEventNode
      && sharedContainer.querySelector(`[data-edit-id="${peer.id}"]`) === peerSharedNode
      && session.editor.selection.kind === 'none'
      && session.editor.history.undoCount === 1 && session.editor.history.redoCount === 0);
  const restored = eventView.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true }));
  check('历史快捷键恢复删除元素、原选区与共享视图 DOM',
    !restored && !!session.editor.doc.elements[target.id]
      && !!eventContainer.querySelector(`[data-edit-id="${target.id}"]`)
      && !!sharedContainer.querySelector(`[data-edit-id="${target.id}"]`)
      && eventContainer.querySelector(`[data-edit-id="${peer.id}"]`) === peerEventNode
      && sharedContainer.querySelector(`[data-edit-id="${peer.id}"]`) === peerSharedNode
      && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids.join(',') === target.id
      && session.editor.history.undoCount === 0 && session.editor.history.redoCount === 1
      && !session.editor.isDirty());
  session.dispose();

  const mixed = await lib.openEditor(bytes, { idPrefix: 'editor-delete-mixed-' });
  const mixedContainer = document.createElement('div');
  const mixedView = mixed.mount(mixedContainer, { mode: 'edit', textMode: 'svg' });
  const byName = (name) => Object.values(mixed.editor.doc.elements)
    .find((record) => record.src.name === name);
  const shape = byName('delete-shape');
  const group = byName('delete-group');
  const child = byName('delete-group-child-a');
  const filled = byName('delete-placeholder-filled');
  mixed.editor.select({
    kind: 'elements', ids: [group.id, child.id, shape.id, filled.id], enteredGroup: null,
  });
  const mixedAccepted = mixedView.element.dispatchEvent(keyboardEvent('keydown', 'Backspace', {
    shiftKey: true,
  }));
  const mixedSelection = mixed.editor.selection;
  check('多选删除归一祖先根、递归移除组，并在同一事务保留已清空占位符',
    !mixedAccepted && !mixed.editor.doc.elements[group.id]
      && !mixed.editor.doc.elements[child.id] && !mixed.editor.doc.elements[shape.id]
      && !!mixed.editor.doc.elements[filled.id] && mixed.editor.effectiveElement(filled.id).text === null
      && !mixedContainer.querySelector(`[data-edit-id="${group.id}"]`)
      && !mixedContainer.querySelector(`[data-edit-id="${child.id}"]`)
      && !mixedContainer.querySelector(`[data-edit-id="${shape.id}"]`)
      && !!mixedContainer.querySelector(`[data-edit-id="${filled.id}"]`)
      && mixedSelection.kind === 'elements' && mixedSelection.ids.join(',') === filled.id
      && mixed.editor.history.undoCount === 1 && mixed.editor.history.redoCount === 0);
  mixed.editor.undo();
  check('撤销混合删除一次恢复完整组树、普通元素、占位符内容与原多选',
    !!mixed.editor.doc.elements[group.id] && !!mixed.editor.doc.elements[child.id]
      && !!mixed.editor.doc.elements[shape.id] && mixed.editor.effectiveElement(filled.id).text !== null
      && !!mixedContainer.querySelector(`[data-edit-id="${group.id}"]`)
      && !!mixedContainer.querySelector(`[data-edit-id="${child.id}"]`)
      && !!mixedContainer.querySelector(`[data-edit-id="${shape.id}"]`)
      && mixed.editor.selection.kind === 'elements'
      && mixed.editor.selection.ids.join(',') === [group.id, child.id, shape.id, filled.id].join(',')
      && mixed.editor.history.undoCount === 0 && mixed.editor.history.redoCount === 1);
  mixed.dispose();

  const guard = await lib.openEditor(bytes, { idPrefix: 'editor-delete-guard-' });
  const guardContainer = document.createElement('div');
  const guardView = guard.mount(guardContainer, { mode: 'edit', textMode: 'svg' });
  const guardByName = (name) => Object.values(guard.editor.doc.elements)
    .find((record) => record.src.name === name);
  const guardShape = guardByName('delete-shape');
  const secondPage = guardByName('delete-second-page');
  const frame = guardByName('delete-frame');
  const empty = guardByName('delete-placeholder-empty');
  const input = document.createElement('input');
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  const shadowHost = document.createElement('div');
  const shadowInput = document.createElement('input');
  shadowHost.attachShadow({ mode: 'open' }).append(shadowInput);
  const closedHost = document.createElement('div');
  const closedInput = document.createElement('input');
  closedHost.attachShadow({ mode: 'closed' }).append(closedInput);
  guardView.element.append(input, editable, shadowHost, closedHost);
  const controlsYield = [
    input.dispatchEvent(keyboardEvent('keydown', 'Delete')),
    editable.dispatchEvent(keyboardEvent('keydown', 'Backspace')),
    shadowInput.dispatchEvent(keyboardEvent('keydown', 'Delete')),
    closedInput.dispatchEvent(keyboardEvent('keydown', 'Backspace')),
  ].every(Boolean);
  guard.editor.select({ kind: 'elements', ids: [guardShape.id], enteredGroup: null });
  const invalidYield = [
    guardView.element.dispatchEvent(keyboardEvent('keydown', 'Delete', { ctrlKey: true })),
    guardView.element.dispatchEvent(keyboardEvent('keydown', 'Backspace', { metaKey: true })),
    guardView.element.dispatchEvent(keyboardEvent('keydown', 'Delete', { altKey: true })),
  ].every(Boolean);
  guardView.setMode('view');
  const viewYields = guardView.element.dispatchEvent(keyboardEvent('keydown', 'Delete'));
  guardView.setMode('edit');
  guard.editor.select({ kind: 'none' });
  const emptyDelete = guardView.element.dispatchEvent(keyboardEvent('keydown', 'Delete'));
  const emptyBackspace = guardView.element.dispatchEvent(keyboardEvent('keydown', 'Backspace'));
  guard.editor.select({ kind: 'elements', ids: [secondPage.id], enteredGroup: null });
  const otherPageConsumed = guardView.element.dispatchEvent(keyboardEvent('keydown', 'Delete'));
  check('view、原生控件与修饰组合保留浏览器所有权，空选区和其它页选区只消费不建历史',
    controlsYield && invalidYield && viewYields && !emptyDelete && !emptyBackspace && !otherPageConsumed
      && !!guard.editor.doc.elements[guardShape.id] && !!guard.editor.doc.elements[secondPage.id]
      && guard.editor.history.undoCount === 0 && guard.editor.history.redoCount === 0);

  guard.editor.select({ kind: 'elements', ids: [guardShape.id], enteredGroup: null });
  const dragTarget = guardContainer.querySelector(`[data-edit-id="${guardShape.id}"]`);
  dragTarget.dispatchEvent(pointer('pointerdown', 100, 100));
  guardView.element.dispatchEvent(pointer('pointermove', 125, 115));
  const dragStarted = !!guardContainer.querySelector('[data-edit-drag-ghost]');
  const duringDrag = guardView.element.dispatchEvent(keyboardEvent('keydown', 'Delete'));
  const dragPreserved = !!guardContainer.querySelector('[data-edit-drag-ghost]')
    && !!guard.editor.doc.elements[guardShape.id] && guard.editor.history.undoCount === 0;
  guardView.element.dispatchEvent(pointer('pointercancel', 125, 115));
  guard.editor.select({ kind: 'elements', ids: [frame.id], enteredGroup: null });
  const frameDeleted = guardView.element.dispatchEvent(keyboardEvent('keydown', 'Backspace', {
    shiftKey: true,
  }));
  guard.editor.undo();
  guard.editor.select({ kind: 'elements', ids: [empty.id], enteredGroup: null });
  const emptyPlaceholderDeleted = guardView.element.dispatchEvent(keyboardEvent('keydown', 'Delete'));
  check('活动 pointer 只消费删除，Shift+Backspace 可删框架，空占位符一次即删除',
    dragStarted && !duringDrag && dragPreserved && !guardContainer.querySelector('[data-edit-drag-ghost]')
      && !frameDeleted && !!guard.editor.doc.elements[frame.id]
      && !emptyPlaceholderDeleted && !guard.editor.doc.elements[empty.id]
      && guard.editor.history.undoCount === 1 && guard.editor.history.redoCount === 0);
  guard.dispose();

  const nested = await lib.openEditor(bytes, { idPrefix: 'editor-delete-nested-' });
  const outerView = nested.mount(document.createElement('div'), { mode: 'edit', textMode: 'svg' });
  const innerContainer = document.createElement('div');
  outerView.element.append(innerContainer);
  const innerView = nested.mount(innerContainer, { mode: 'edit', textMode: 'svg' });
  const nestedFilled = Object.values(nested.editor.doc.elements)
    .find((record) => record.src.name === 'delete-placeholder-filled');
  nested.editor.select({ kind: 'elements', ids: [nestedFilled.id], enteredGroup: null });
  const nestedAccepted = innerView.element.dispatchEvent(keyboardEvent('keydown', 'Delete'));
  check('嵌套挂载只由最内层视图处理一次，占位符不会被一次按键直接删框',
    !nestedAccepted && !!nested.editor.doc.elements[nestedFilled.id]
      && nested.editor.effectiveElement(nestedFilled.id).text === null
      && nested.editor.history.undoCount === 1 && nested.editor.history.redoCount === 0);
  nested.dispose();
}
