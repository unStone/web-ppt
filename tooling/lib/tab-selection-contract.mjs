/** Tab 选择只通过发布会话、焦点与 DOM 键盘事件验收。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const key = (init = {}) => new KeyboardEvent('keydown', {
  key: 'Tab', bubbles: true, composed: true, cancelable: true, ...init,
});
const pointer = (type, x, y) => new MouseEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y,
});

export async function runTabSelectionContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ Tab 元素遍历与焦点所有权\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-tab.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-tab-' });
  const container = document.createElement('div');
  document.body.append(container);
  const view = session.mount(container, { mode: 'edit', textMode: 'svg' });
  const byName = (name) => Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === name);
  const back = byName('tab-back');
  const staticSvg = container.querySelector('[data-ppt-layer="static"] svg');
  const history = session.editor.history.undoCount;
  view.element.focus();
  const accepted = view.element.dispatchEvent(key());
  check('无选区时 Tab 从当前页绘制顺序首项开始且只更新选区',
    !accepted && document.activeElement === view.element
      && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids.join(',') === back.id
      && session.editor.selection.enteredGroup === null
      && session.editor.history.undoCount === history
      && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg);

  const middle = byName('tab-middle');
  const front = byName('tab-front');
  const forwardAccepted = view.element.dispatchEvent(key());
  const selectedMiddle = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === middle.id;
  const reverseAccepted = view.element.dispatchEvent(key({ shiftKey: true }));
  const selectedBack = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === back.id;
  const wrapAccepted = view.element.dispatchEvent(key({ shiftKey: true }));
  check('Tab 与 Shift+Tab 按绘制顺序双向遍历并首尾循环',
    !forwardAccepted && selectedMiddle && !reverseAccepted && selectedBack && !wrapAccepted
      && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids.join(',') === front.id
      && session.editor.history.undoCount === history
      && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg);

  const outer = byName('tab-outer-group');
  const childA = byName('tab-child-a');
  const inner = byName('tab-inner-group');
  const innerLeaf = byName('tab-inner-leaf');
  const childB = byName('tab-child-b');
  session.editor.select({ kind: 'elements', ids: [childA.id], enteredGroup: outer.id });
  view.element.dispatchEvent(key());
  const selectedInner = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === inner.id
    && session.editor.selection.enteredGroup === outer.id;
  view.element.dispatchEvent(key());
  const selectedChildB = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === childB.id
    && session.editor.selection.enteredGroup === outer.id;
  view.element.dispatchEvent(key());
  const wrappedChildA = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === childA.id
    && session.editor.selection.enteredGroup === outer.id;
  session.editor.select({ kind: 'elements', ids: [innerLeaf.id], enteredGroup: inner.id });
  const singleChildAccepted = view.element.dispatchEvent(key());
  check('Tab 只遍历已进入组的直属子项，嵌套组不被扁平展开',
    selectedInner && selectedChildB && wrappedChildA && !singleChildAccepted
      && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids.join(',') === innerLeaf.id
      && session.editor.selection.enteredGroup === inner.id
      && session.editor.history.undoCount === history
      && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg);

  session.editor.select({ kind: 'elements', ids: [back.id, outer.id], enteredGroup: null });
  view.element.dispatchEvent(key());
  const afterForwardEdge = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === front.id;
  session.editor.select({ kind: 'elements', ids: [middle.id, front.id], enteredGroup: null });
  view.element.dispatchEvent(key({ shiftKey: true }));
  const beforeReverseEdge = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === back.id;
  session.editor.select({ kind: 'elements', ids: [back.id, front.id], enteredGroup: null });
  view.element.dispatchEvent(key());
  const forwardWrapped = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === back.id;
  session.editor.select({ kind: 'elements', ids: [back.id, front.id], enteredGroup: null });
  view.element.dispatchEvent(key({ shiftKey: true }));
  check('多选正向从最大序号之后、反向从最小序号之前继续并循环',
    afterForwardEdge && beforeReverseEdge && forwardWrapped
      && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids.join(',') === front.id
      && session.editor.history.undoCount === history
      && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg);

  childA.meta.locked = true;
  inner.meta.hiddenByUser = true;
  session.editor.select({ kind: 'elements', ids: [childA.id], enteredGroup: outer.id });
  view.element.dispatchEvent(key());
  const skippedToChildB = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === childB.id;
  outer.meta.locked = true;
  const noCandidateAccepted = view.element.dispatchEvent(key());
  check('Tab 跳过锁定、隐藏和被不可选祖先阻断的候选，无候选时让位浏览器',
    skippedToChildB && noCandidateAccepted
      && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids.join(',') === childB.id
      && session.editor.selection.enteredGroup === outer.id);
  outer.meta.locked = false;
  childA.meta.locked = false;
  inner.meta.hiddenByUser = false;

  session.editor.select({ kind: 'elements', ids: [back.id], enteredGroup: null });
  const input = document.createElement('input');
  const button = document.createElement('button');
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  const shadowHost = document.createElement('div');
  const shadowInput = document.createElement('input');
  const shadowButton = document.createElement('button');
  shadowHost.attachShadow({ mode: 'open' }).append(shadowInput, shadowButton);
  view.element.append(input, button, editable, shadowHost);
  const ownedByText = [
    input.dispatchEvent(key()),
    button.dispatchEvent(key()),
    editable.dispatchEvent(key({ shiftKey: true })),
    shadowInput.dispatchEvent(key()),
    shadowButton.dispatchEvent(key({ shiftKey: true })),
  ].every(Boolean);
  const modifiedAccepted = [
    view.element.dispatchEvent(key({ ctrlKey: true })),
    view.element.dispatchEvent(key({ metaKey: true })),
    view.element.dispatchEvent(key({ altKey: true })),
  ].every(Boolean);
  view.setMode('view');
  const viewAccepted = view.element.dispatchEvent(key());
  view.setMode('edit');
  check('view、浏览器修饰键与普通/Shadow DOM 表单和文本控件保留 Tab 所有权',
    ownedByText && modifiedAccepted && viewAccepted
      && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids.join(',') === back.id
      && session.editor.history.undoCount === history
      && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg);

  const dragTarget = container.querySelector(`[data-edit-id="${back.id}"]`);
  dragTarget.dispatchEvent(pointer('pointerdown', 100, 100));
  view.element.dispatchEvent(pointer('pointermove', 120, 116));
  const dragStarted = !!container.querySelector('[data-edit-drag-ghost]');
  const gestureAccepted = view.element.dispatchEvent(key());
  const gesturePreserved = !!container.querySelector('[data-edit-drag-ghost]')
    && session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === back.id
    && session.editor.history.undoCount === history;
  view.element.dispatchEvent(pointer('pointercancel', 120, 116));
  check('活动 pointer 手势期间 Tab 只阻止焦点跳出，不切选区或打断预览',
    dragStarted && !gestureAccepted && gesturePreserved
      && !container.querySelector('[data-edit-drag-ghost]'));

  const secondPage = byName('tab-second-page');
  const secondContainer = document.createElement('div');
  document.body.append(secondContainer);
  const secondView = session.mount(secondContainer, {
    mode: 'edit', textMode: 'svg', slideId: secondPage.parent,
  });
  session.editor.select({ kind: 'elements', ids: [innerLeaf.id], enteredGroup: inner.id });
  secondView.element.focus();
  const secondAccepted = secondView.element.dispatchEvent(key());
  const secondSelected = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === secondPage.id
    && session.editor.selection.enteredGroup === null;
  view.element.focus();
  const firstAccepted = view.element.dispatchEvent(key({ shiftKey: true }));
  check('共享会话中由收到事件的视图决定页与组范围，不沿用其他页面选区',
    !secondAccepted && secondSelected && !firstAccepted
      && document.activeElement === view.element
      && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids.join(',') === front.id
      && session.editor.selection.enteredGroup === null
      && session.editor.history.undoCount === history);
  session.dispose();
  container.remove();
  secondContainer.remove();
}
