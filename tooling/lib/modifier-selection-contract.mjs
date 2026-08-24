/** 修饰键多选只经过发布会话、稳定 DOM 身份与公开 headless selection 验收。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const click = (target, init = {}) => {
  const options = { bubbles: true, composed: true, cancelable: true, button: 0, ...init };
  const accepted = target.dispatchEvent(new MouseEvent('pointerdown', options));
  target.dispatchEvent(new MouseEvent('pointerup', options));
  return accepted;
};
const pointer = (type, x, y, init = {}) => new MouseEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y, ...init,
});

export async function runModifierSelectionContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 修饰键点选与框选增减选\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-multiselect.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-multiselect-' });
  const container = document.createElement('div');
  const view = session.mount(container, { mode: 'edit', textMode: 'svg' });
  const byName = (name) => Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === name);
  const node = (record) => container.querySelector(`[data-edit-id="${record.id}"]`);
  const back = byName('multi-back');
  const middle = byName('multi-middle');
  const front = byName('multi-front');
  const staticSvg = container.querySelector('[data-ppt-layer="static"] svg');
  const history = session.editor.history.undoCount;

  click(node(middle));
  const shiftAccepted = click(node(back), { shiftKey: true });
  const shiftAddedInPaintOrder = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [back.id, middle.id].join(',');
  const ctrlAccepted = click(node(front), { ctrlKey: true });
  const ctrlAdded = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [back.id, middle.id, front.id].join(',');
  const metaAccepted = click(node(middle), { metaKey: true });
  const metaRemoved = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [back.id, front.id].join(',');
  click(node(back), { shiftKey: true });
  click(node(front), { ctrlKey: true });
  check('Shift/Ctrl/Meta 点选按绘制顺序加入或移除，最后一项移除后回到空选区',
    !shiftAccepted && shiftAddedInPaintOrder && !ctrlAccepted && ctrlAdded
      && !metaAccepted && metaRemoved && session.editor.selection.kind === 'none'
      && session.editor.history.undoCount === history
      && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg);

  const outer = byName('multi-outer-group');
  const childA = byName('multi-child-a');
  const inner = byName('multi-inner-group');
  const innerLeaf = byName('multi-inner-leaf');
  const childB = byName('multi-child-b');
  session.editor.select({ kind: 'elements', ids: [childA.id], enteredGroup: outer.id });
  click(node(childB), { ctrlKey: true });
  const groupSiblings = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [childA.id, childB.id].join(',')
    && session.editor.selection.enteredGroup === outer.id;
  click(node(innerLeaf), { shiftKey: true });
  const nestedStayedAtDirectGroup = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [childA.id, inner.id, childB.id].join(',')
    && !session.editor.selection.ids.includes(innerLeaf.id);
  click(node(innerLeaf), { metaKey: true });
  const nestedRemovedAsGroup = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [childA.id, childB.id].join(',');

  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true, value: () => [node(front), node(middle), node(back)],
  });
  session.editor.select({ kind: 'elements', ids: [middle.id], enteredGroup: null });
  click(node(middle), { altKey: true, shiftKey: true, clientX: 100, clientY: 100 });
  const alternatePreservedSingleCycle = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [back.id, middle.id].join(',');
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true, value: () => [node(front), node(back)],
  });
  session.editor.select({ kind: 'elements', ids: [middle.id, front.id], enteredGroup: null });
  click(node(front), { altKey: true, shiftKey: true, clientX: 100, clientY: 100 });
  const alternateReachedUnselected = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [back.id, middle.id, front.id].join(',');
  session.editor.select({ kind: 'elements', ids: [back.id], enteredGroup: null });
  click(node(back), { altKey: true, shiftKey: true, clientX: 100, clientY: 100 });
  const alternateAdded = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [back.id, front.id].join(',');
  click(node(back), { altKey: true, ctrlKey: true, clientX: 100, clientY: 100 });
  const alternateRemoved = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === back.id;
  delete document.elementsFromPoint;

  const secondContainer = document.createElement('div');
  const secondPage = byName('multi-second-page');
  const secondView = session.mount(secondContainer, {
    mode: 'edit', textMode: 'svg', slideId: secondPage.parent,
  });
  session.editor.select({ kind: 'elements', ids: [childA.id, childB.id], enteredGroup: outer.id });
  click(secondContainer.querySelector(`[data-edit-id="${secondPage.id}"]`), { shiftKey: true });
  const secondPageScoped = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === secondPage.id
    && session.editor.selection.enteredGroup === null;
  check('组内只切换直属候选，Alt 穿透可组合，事件视图丢弃其它页或组的共享选区',
    groupSiblings && nestedStayedAtDirectGroup && nestedRemovedAsGroup
      && alternatePreservedSingleCycle && alternateReachedUnselected
      && alternateAdded && alternateRemoved && secondPageScoped
      && session.editor.history.undoCount === history
      && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg);

  const backSource = session.editor.effectiveElement(back.id);
  const middleSource = session.editor.effectiveElement(middle.id);
  session.editor.select({ kind: 'elements', ids: [back.id, middle.id], enteredGroup: null });
  node(back).dispatchEvent(pointer('pointerdown', 100, 100, { ctrlKey: true }));
  view.element.dispatchEvent(pointer('pointermove', 120, 115, { ctrlKey: true }));
  view.element.dispatchEvent(pointer('pointerup', 120, 115, { ctrlKey: true }));
  const removedMemberDidNotDrag = !container.querySelector('[data-edit-drag-ghost]')
    && session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === middle.id
    && session.editor.effectiveElement(middle.id).x === middleSource.x;
  session.editor.select({ kind: 'elements', ids: [back.id], enteredGroup: null });
  node(middle).dispatchEvent(pointer('pointerdown', 100, 100, { shiftKey: true }));
  view.element.dispatchEvent(pointer('pointermove', 120, 115, { shiftKey: true }));
  const addedMemberStartedWholeDrag = !!container.querySelector('[data-edit-drag-ghost]')
    && session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [back.id, middle.id].join(',');
  view.element.dispatchEvent(pointer('pointercancel', 120, 115, { shiftKey: true }));
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true, value: () => [node(middle), node(back)],
  });
  session.editor.select({ kind: 'elements', ids: [back.id], enteredGroup: null });
  node(back).dispatchEvent(pointer('pointerdown', 100, 100, { altKey: true, shiftKey: true }));
  view.element.dispatchEvent(pointer('pointermove', 120, 115, { altKey: true, shiftKey: true }));
  const alternateAddedMemberStartedWholeDrag = !!container.querySelector('[data-edit-drag-ghost]')
    && session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [back.id, middle.id].join(',');
  view.element.dispatchEvent(pointer('pointercancel', 120, 115, { altKey: true, shiftKey: true }));
  delete document.elementsFromPoint;
  check('移除命中成员不拖动剩余选区，加入成员越过阈值可拖动完整新选区',
    removedMemberDidNotDrag && addedMemberStartedWholeDrag && alternateAddedMemberStartedWholeDrag
      && !container.querySelector('[data-edit-drag-ghost]')
      && session.editor.effectiveElement(back.id).x === backSource.x
      && session.editor.effectiveElement(middle.id).x === middleSource.x
      && session.editor.history.undoCount === history);

  const selectionIsBackMiddle = () => session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [back.id, middle.id].join(',');
  const blankClick = (init = {}) => {
    view.element.dispatchEvent(pointer('pointerdown', 950, 550, init));
    view.element.dispatchEvent(pointer('pointerup', 950, 550, init));
  };
  session.editor.select({ kind: 'elements', ids: [back.id, middle.id], enteredGroup: null });
  blankClick({ shiftKey: true });
  const shiftBlankPreserved = selectionIsBackMiddle();
  blankClick({ ctrlKey: true });
  const ctrlBlankPreserved = selectionIsBackMiddle();
  blankClick({ metaKey: true });
  const metaBlankPreserved = selectionIsBackMiddle();
  blankClick();
  check('带选择修饰键的空白点击保留选区，无修饰键空白点击仍清空',
    shiftBlankPreserved && ctrlBlankPreserved && metaBlankPreserved
      && session.editor.selection.kind === 'none'
      && session.editor.history.undoCount === history);

  session.editor.select({ kind: 'elements', ids: [back.id, front.id], enteredGroup: null });
  view.element.dispatchEvent(pointer('pointerdown', 50, 50, { shiftKey: true }));
  view.element.dispatchEvent(pointer('pointermove', 340, 170, { shiftKey: true }));
  const previewVisible = (record) => container
    .querySelector(`[data-edit-marquee-candidate="${record.id}"]`)?.getAttribute('display') !== 'none';
  const xorPreview = !previewVisible(back) && previewVisible(middle) && previewVisible(front)
    && session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [back.id, front.id].join(',')
    && container.querySelector('[data-edit-selection-ids]')?.getAttribute('display') === 'none';
  view.element.dispatchEvent(pointer('pointerup', 340, 170, { shiftKey: true }));
  check('修饰键框选预览并提交手势前选区与完全包含候选的对称差',
    xorPreview && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids.join(',') === [middle.id, front.id].join(',')
      && !container.querySelector('[data-edit-marquee-layer]')
      && session.editor.history.undoCount === history
      && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg);

  session.editor.select({ kind: 'elements', ids: [back.id, front.id], enteredGroup: null });
  view.element.dispatchEvent(pointer('pointerdown', 50, 50));
  view.element.dispatchEvent(pointer('pointermove', 340, 170));
  const replacementPreview = previewVisible(back) && previewVisible(middle) && !previewVisible(front);
  const shiftDownAccepted = view.element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Shift', shiftKey: true, bubbles: true, cancelable: true,
  }));
  const shiftedPreview = !previewVisible(back) && previewVisible(middle) && previewVisible(front);
  const shiftUpAccepted = view.element.dispatchEvent(new KeyboardEvent('keyup', {
    key: 'Shift', bubbles: true, cancelable: true,
  }));
  const releasedPreview = previewVisible(back) && previewVisible(middle) && !previewVisible(front);
  const metaDownAccepted = view.element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Meta', metaKey: true, bubbles: true, cancelable: true,
  }));
  const metaPreview = !previewVisible(back) && previewVisible(middle) && previewVisible(front);
  view.element.dispatchEvent(pointer('pointerup', 340, 170, { metaKey: true }));
  check('框选中按下或释放 Shift/Meta 立即切换组合预览，松手只提交最终状态',
    replacementPreview && !shiftDownAccepted && shiftedPreview
      && !shiftUpAccepted && releasedPreview && !metaDownAccepted && metaPreview
      && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids.join(',') === [middle.id, front.id].join(',')
      && session.editor.history.undoCount === history);

  session.editor.select({ kind: 'elements', ids: [childA.id, childB.id], enteredGroup: outer.id });
  view.element.dispatchEvent(pointer('pointerdown', -1000, -1000, { ctrlKey: true }));
  view.element.dispatchEvent(pointer('pointermove', 2000, 2000, { ctrlKey: true }));
  const groupXorPreview = !previewVisible(childA) && previewVisible(inner) && !previewVisible(childB);
  view.element.dispatchEvent(pointer('pointerup', 2000, 2000, { ctrlKey: true }));
  const groupXorCommitted = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === inner.id
    && session.editor.selection.enteredGroup === outer.id;

  back.meta.locked = true;
  session.editor.select({ kind: 'elements', ids: [back.id, front.id], enteredGroup: null });
  view.element.dispatchEvent(pointer('pointerdown', 0, 0, { shiftKey: true }));
  view.element.dispatchEvent(pointer('pointermove', 350, 200, { shiftKey: true }));
  view.element.dispatchEvent(pointer('pointerup', 350, 200, { shiftKey: true }));
  const invalidPriorDropped = session.editor.selection.kind === 'elements'
    && session.editor.selection.ids.join(',') === [middle.id, front.id].join(',');
  back.meta.locked = false;

  session.editor.select({ kind: 'elements', ids: [back.id, front.id], enteredGroup: null });
  view.element.dispatchEvent(pointer('pointerdown', 50, 50, { metaKey: true }));
  view.element.dispatchEvent(pointer('pointermove', 340, 170, { metaKey: true }));
  const cancelPreview = !!container.querySelector('[data-edit-marquee-layer]');
  view.element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  }));
  check('框选切换限制在直属可选作用域，丢弃失效旧成员，取消时恢复手势前选区',
    groupXorPreview && groupXorCommitted && invalidPriorDropped && cancelPreview
      && !container.querySelector('[data-edit-marquee-layer]')
      && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids.join(',') === [back.id, front.id].join(',')
      && session.editor.history.undoCount === history
      && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg);

  session.editor.select({ kind: 'elements', ids: [childA.id, childB.id], enteredGroup: outer.id });
  secondView.element.dispatchEvent(pointer('pointerdown', 0, 0, { shiftKey: true }));
  secondView.element.dispatchEvent(pointer('pointermove', 500, 400, { shiftKey: true }));
  secondView.element.dispatchEvent(pointer('pointerup', 500, 400, { shiftKey: true }));
  check('共享会话的修饰框选只组合收到事件视图的当前页候选',
    session.editor.selection.kind === 'elements'
      && session.editor.selection.ids.join(',') === secondPage.id
      && session.editor.selection.enteredGroup === null
      && session.editor.history.undoCount === history);

  session.dispose();
  secondContainer.remove();
}
