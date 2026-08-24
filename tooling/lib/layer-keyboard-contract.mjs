/** 层级快捷键只经过发布会话、公开选区、DOM 事件与共享视图验收。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyboardEvent } from './keyboard-event.mjs';

const before = (left, right) => !!(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING);
const pointer = (type, x, y) => new MouseEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y,
});

export async function runLayerKeyboardContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ Ctrl/Cmd + [ / ] 元素层级\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-delete.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-layer-' });
  const eventContainer = document.createElement('div');
  const sharedContainer = document.createElement('div');
  const eventView = session.mount(eventContainer, { mode: 'edit', textMode: 'svg' });
  session.mount(sharedContainer, { mode: 'edit', textMode: 'svg' });
  const byName = (name) => Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === name);
  const shape = byName('delete-shape');
  const group = byName('delete-group');
  const peer = byName('delete-peer');
  const eventShape = eventContainer.querySelector(`[data-edit-root="${shape.id}"]`);
  const eventGroup = eventContainer.querySelector(`[data-edit-root="${group.id}"]`);
  const eventPeer = eventContainer.querySelector(`[data-edit-root="${peer.id}"]`);
  const sharedShape = sharedContainer.querySelector(`[data-edit-root="${shape.id}"]`);
  const sharedGroup = sharedContainer.querySelector(`[data-edit-root="${group.id}"]`);
  const sharedPeer = sharedContainer.querySelector(`[data-edit-root="${peer.id}"]`);
  session.editor.select({ kind: 'elements', ids: [shape.id], enteredGroup: null });

  const accepted = eventView.element.dispatchEvent(keyboardEvent('keydown', ']', { ctrlKey: true }));
  check('Ctrl+] 上移一层并在共享视图移动既有 DOM 节点',
    !accepted
      && session.editor.doc.slides[eventView.slideId].children.slice(0, 2).join(',')
        === [group.id, shape.id].join(',')
      && eventContainer.querySelector(`[data-edit-root="${shape.id}"]`) === eventShape
      && eventContainer.querySelector(`[data-edit-root="${group.id}"]`) === eventGroup
      && sharedContainer.querySelector(`[data-edit-root="${shape.id}"]`) === sharedShape
      && sharedContainer.querySelector(`[data-edit-root="${group.id}"]`) === sharedGroup
      && before(eventGroup, eventShape) && before(sharedGroup, sharedShape)
      && session.editor.history.undoCount === 1 && session.editor.history.redoCount === 0);

  const undone = eventView.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true }));
  const frontAccepted = eventView.element.dispatchEvent(keyboardEvent('keydown', '}', {
    code: 'BracketRight', ctrlKey: true, shiftKey: true,
  }));
  const frontDomCorrect = !frontAccepted
    && session.editor.doc.slides[eventView.slideId].children.at(-1) === shape.id
    && before(eventPeer, eventShape) && before(sharedPeer, sharedShape);
  const frontUndone = eventView.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true }));
  check('撤销恢复模型；置顶与撤销在两个视图移动同一批 DOM 节点',
    !undone && frontDomCorrect && !frontUndone
      && before(eventShape, eventGroup) && before(sharedShape, sharedGroup)
      && eventContainer.querySelector(`[data-edit-root="${shape.id}"]`) === eventShape
      && sharedContainer.querySelector(`[data-edit-root="${shape.id}"]`) === sharedShape
      && session.editor.history.undoCount === 0 && session.editor.history.redoCount === 1
      && !session.editor.isDirty());

  const childA = byName('delete-group-child-a');
  const childB = byName('delete-group-child-b');
  const childNode = eventContainer.querySelector(`[data-edit-root="${childA.id}"]`);
  session.editor.select({ kind: 'elements', ids: [childA.id], enteredGroup: group.id });
  const childAccepted = eventView.element.dispatchEvent(keyboardEvent('keydown', ']', { metaKey: true }));
  check('Meta+] 可在已进入组合内上移并保留子节点身份',
    !childAccepted && session.editor.doc.elements[group.id].children.join(',')
      === [childB.id, childA.id].join(',')
      && eventContainer.querySelector(`[data-edit-root="${childA.id}"]`) === childNode
      && session.editor.history.undoCount === 1);
  session.editor.undo();

  const frame = byName('delete-frame');
  session.editor.select({ kind: 'elements', ids: [group.id, frame.id], enteredGroup: null });
  const multiAccepted = eventView.element.dispatchEvent(keyboardEvent('keydown', '}', {
    code: 'BracketRight', ctrlKey: true, shiftKey: true,
  }));
  const top = session.editor.doc.slides[eventView.slideId].children.slice(-2);
  check('Ctrl+Shift+] 把非连续多选作为一个保持相对序的历史事务置顶',
    !multiAccepted && top.join(',') === [group.id, frame.id].join(',')
      && session.editor.history.undoCount === 1
      && session.editor.history.undoEntries[0].forward.length === 2);
  session.editor.undo();

  session.editor.select({ kind: 'elements', ids: [shape.id], enteredGroup: null });
  const boundaryHistory = session.editor.history.undoCount;
  const boundaryAccepted = eventView.element.dispatchEvent(keyboardEvent('keydown', '[', {
    ctrlKey: true,
  }));
  check('位于底层时 Ctrl+[ 只消费按键，不创建空历史',
    !boundaryAccepted && session.editor.history.undoCount === boundaryHistory
      && !session.editor.isDirty());

  const input = document.createElement('input');
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  const openHost = document.createElement('div');
  const openInput = document.createElement('input');
  openHost.attachShadow({ mode: 'open' }).append(openInput);
  const closedHost = document.createElement('div');
  const closedInput = document.createElement('input');
  closedHost.attachShadow({ mode: 'closed' }).append(closedInput);
  eventView.element.append(input, editable, openHost, closedHost);
  const controlsYield = [input, editable, openInput, closedInput].every((control) =>
    control.dispatchEvent(keyboardEvent('keydown', ']', { ctrlKey: true })));
  const invalidYield = [
    keyboardEvent('keydown', ']', {}),
    keyboardEvent('keydown', ']', { ctrlKey: true, metaKey: true }),
    keyboardEvent('keydown', '[', { ctrlKey: true, altKey: true }),
  ].every((event) => eventView.element.dispatchEvent(event));
  eventView.setMode('view');
  const viewYields = eventView.element.dispatchEvent(keyboardEvent('keydown', ']', { ctrlKey: true }));
  eventView.setMode('edit');
  session.editor.select({ kind: 'none' });
  const emptyConsumed = eventView.element.dispatchEvent(keyboardEvent('keydown', ']', { ctrlKey: true }));
  const secondPage = byName('delete-second-page');
  session.editor.select({ kind: 'elements', ids: [secondPage.id], enteredGroup: null });
  const offpageConsumed = eventView.element.dispatchEvent(keyboardEvent('keydown', '[', { metaKey: true }));
  check('view、控件和非法修饰保留浏览器所有权，空选区与其它页选区只消费不建历史',
    controlsYield && invalidYield && viewYields && !emptyConsumed && !offpageConsumed
      && session.editor.history.undoCount === 0 && session.editor.history.redoCount === 1);

  session.editor.select({ kind: 'elements', ids: [shape.id], enteredGroup: null });
  const dragTarget = eventContainer.querySelector(`[data-edit-id="${shape.id}"]`);
  dragTarget.dispatchEvent(pointer('pointerdown', 80, 80));
  eventView.element.dispatchEvent(pointer('pointermove', 110, 100));
  const dragStarted = !!eventContainer.querySelector('[data-edit-drag-ghost]');
  const duringDrag = eventView.element.dispatchEvent(keyboardEvent('keydown', ']', { ctrlKey: true }));
  const dragPreserved = !!eventContainer.querySelector('[data-edit-drag-ghost]')
    && session.editor.history.undoCount === 0 && !session.editor.isDirty();
  eventView.element.dispatchEvent(pointer('pointercancel', 110, 100));
  check('活动 pointer 手势只消费层级快捷键，不打断幽灵或修改历史',
    dragStarted && !duringDrag && dragPreserved
      && !eventContainer.querySelector('[data-edit-drag-ghost]'));
  session.dispose();

  const nested = await lib.openEditor(bytes, { idPrefix: 'editor-layer-nested-' });
  const outerView = nested.mount(document.createElement('div'), { mode: 'edit', textMode: 'svg' });
  const innerContainer = document.createElement('div');
  outerView.element.append(innerContainer);
  const innerView = nested.mount(innerContainer, { mode: 'edit', textMode: 'svg' });
  const nestedShape = Object.values(nested.editor.doc.elements)
    .find((record) => record.src.name === 'delete-shape');
  nested.editor.select({ kind: 'elements', ids: [nestedShape.id], enteredGroup: null });
  const nestedAccepted = innerView.element.dispatchEvent(keyboardEvent('keydown', ']', { ctrlKey: true }));
  check('嵌套挂载只让最内层视图处理一次层级快捷键',
    !nestedAccepted && nested.editor.history.undoCount === 1
      && nested.editor.doc.slides[innerView.slideId].children[1] === nestedShape.id);
  nested.dispose();
}
