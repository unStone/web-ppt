/** 选择语义必须只经过发布入口和真实 DOM 事件，否则无法约束框架适配层。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pointerClick = (target, init = {}) => {
  const options = { bubbles: true, composed: true, ...init };
  const accepted = target.dispatchEvent(new MouseEvent('pointerdown', options));
  target.dispatchEvent(new MouseEvent('pointerup', options));
  return accepted;
};

export async function runNativeHitContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 原生 SVG 点选与选择反馈\x1b[0m');
  {
    const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-basic.pptx')));
    const session = await lib.openEditor(bytes, { idPrefix: 'editor-hit-' });
    const container = document.createElement('div');
    const view = session.mount(container, { mode: 'edit' });
    const targetId = session.editor.doc.slides[view.slideId].children[0];
    const staticLayer = container.querySelector('[data-ppt-layer="static"]');
    const interactionLayer = container.querySelector('[data-ppt-layer="interaction"]');
    const target = staticLayer.querySelector(`[data-edit-id="${targetId}"]`);
    const svgBefore = staticLayer.querySelector('svg');
    const historyBefore = session.editor.history.undoCount;
    pointerClick(target);
    check('编辑模式点选通过稳定身份提交 headless 选区并只更新交互层',
      session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === targetId
      && session.editor.selection.enteredGroup === null
      && interactionLayer.querySelector(`[data-edit-selection-id="${targetId}"]`)
      && staticLayer.querySelector('svg') === svgBefore
      && session.editor.history.undoCount === historyBefore);

    const groupId = session.editor.doc.slides[view.slideId].children
      .find((id) => session.editor.doc.elements[id].src.kind === 'group');
    const childId = session.editor.doc.elements[groupId].children[0];
    const group = staticLayer.querySelector(`[data-edit-id="${groupId}"]`);
    const child = staticLayer.querySelector(`[data-edit-id="${childId}"]`);
    pointerClick(child);
    const selectedOuterGroup = session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === groupId && session.editor.selection.enteredGroup === null;
    child.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
    const enteredGroup = session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === childId && session.editor.selection.enteredGroup === groupId
      && interactionLayer.querySelector(`[data-edit-selection-id="${childId}"]`);
    view.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const exitedGroup = session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === groupId && session.editor.selection.enteredGroup === null;
    view.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('默认选外层组，双击进组，Escape 每次只退出一层', selectedOuterGroup && enteredGroup
      && exitedGroup && session.editor.selection.kind === 'none'
      && staticLayer.querySelector(`[data-edit-id="${groupId}"]`) === group
      && staticLayer.querySelector('svg') === svgBefore);

    const groupRecord = session.editor.doc.elements[groupId];
    const childRecord = session.editor.doc.elements[childId];
    groupRecord.meta.locked = true;
    pointerClick(child);
    const lockedGroupSkipped = session.editor.selection.kind === 'none';
    groupRecord.meta.locked = false;
    groupRecord.meta.hiddenByUser = true;
    pointerClick(child);
    const hiddenGroupSkipped = session.editor.selection.kind === 'none';
    groupRecord.meta.hiddenByUser = false;
    childRecord.meta.editable = 'none';
    pointerClick(child);
    const uneditableLeafFallsBack = session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === groupId;
    groupRecord.meta.editable = 'none';
    childRecord.meta.editable = 'full';
    pointerClick(child);
    check('锁定、用户隐藏或不可编辑的组阻断后代，不可编辑叶子回退到可编辑父组', lockedGroupSkipped
      && hiddenGroupSkipped && uneditableLeafFallsBack && session.editor.selection.kind === 'none');

    const [lowerId, , upperId] = session.editor.doc.slides[view.slideId].children;
    const lower = staticLayer.querySelector(`[data-edit-id="${lowerId}"]`);
    const upper = staticLayer.querySelector(`[data-edit-id="${upperId}"]`);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true, value: () => [upper, lower],
    });
    const altClick = () => pointerClick(lower, { altKey: true, clientX: 120, clientY: 140 });
    altClick();
    const topSelected = session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === upperId;
    altClick();
    const lowerSelected = session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === lowerId;
    altClick();
    check('Alt+点选按 elementsFromPoint 的 z 序在重叠元素间循环', topSelected && lowerSelected
      && session.editor.selection.kind === 'elements' && session.editor.selection.ids[0] === upperId);
    delete document.elementsFromPoint;
    session.dispose();
  }

  console.log('\n\x1b[36m▸ 查看模式与多视图选择所有权\x1b[0m');
  {
    const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-basic.pptx')));
    const session = await lib.openEditor(bytes, { idPrefix: 'editor-owned-hit-' });
    const firstContainer = document.createElement('div');
    const secondContainer = document.createElement('div');
    const first = session.mount(firstContainer, { mode: 'view' });
    const second = session.mount(secondContainer, { mode: 'edit' });
    const [firstId, secondId] = session.editor.doc.slides[first.slideId].children;
    const firstTarget = firstContainer.querySelector(`[data-edit-id="${firstId}"]`);
    const secondTarget = secondContainer.querySelector(`[data-edit-id="${secondId}"]`);
    session.editor.select({ kind: 'elements', ids: [secondId], enteredGroup: null });
    const viewDispatchAccepted = firstTarget.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, composed: true, cancelable: true,
    }));
    const viewModeUnchanged = session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === secondId
      && firstContainer.querySelector('[data-ppt-layer="interaction"]').style.display === 'none';

    session.editor.select({ kind: 'none' });
    let selectionEvents = 0;
    const unsubscribe = session.editor.subscribe((change) => {
      if (change.source === 'selection') selectionEvents++;
    });
    pointerClick(secondTarget);
    const sharedSelectionRendered = firstContainer.querySelector(`[data-edit-selection-id="${secondId}"]`)
      && secondContainer.querySelector(`[data-edit-selection-id="${secondId}"]`)
      && selectionEvents === 1;
    session.editor.select({ kind: 'none' });
    const detachedTarget = secondTarget;
    second.destroy();
    document.body.append(second.element);
    pointerClick(detachedTarget);
    const destroyedViewSilent = session.editor.selection.kind === 'none';
    first.setMode('edit');
    pointerClick(firstTarget);
    check('查看模式不拦截也不改选区，多视图同步反馈但各自拥有事件生命周期', viewDispatchAccepted
      && viewModeUnchanged && sharedSelectionRendered && destroyedViewSilent
      && session.editor.selection.kind === 'elements' && session.editor.selection.ids[0] === firstId
      && selectionEvents === 3,
    `accepted=${viewDispatchAccepted} unchanged=${viewModeUnchanged} shared=${!!sharedSelectionRendered}`
      + ` firstMarker=${!!firstContainer.querySelector(`[data-edit-selection-id="${secondId}"]`)}`
      + ` secondMarker=${!!secondContainer.querySelector(`[data-edit-selection-id="${secondId}"]`)}`
      + ` destroyed=${destroyedViewSilent} events=${selectionEvents}`);
    unsubscribe();
    second.element.remove();
    session.dispose();
  }

  console.log('\n\x1b[36m▸ 嵌套组逐层进入与退出\x1b[0m');
  {
    const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-hit.pptx')));
    const session = await lib.openEditor(bytes, { idPrefix: 'editor-nested-hit-' });
    const container = document.createElement('div');
    const view = session.mount(container, { mode: 'edit', textMode: 'svg' });
    const byName = (name) => Object.values(session.editor.doc.elements)
      .find((record) => record.src.name === name)?.id;
    const outerId = byName('hit-outer-group');
    const innerId = byName('hit-inner-group');
    const leafId = byName('hit-nested-leaf');
    const leaf = container.querySelector(`[data-edit-id="${leafId}"]`);
    pointerClick(leaf);
    const selectedOuter = session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === outerId && session.editor.selection.enteredGroup === null;
    leaf.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
    const enteredOuter = session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === innerId && session.editor.selection.enteredGroup === outerId;
    leaf.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
    const enteredInner = session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === leafId && session.editor.selection.enteredGroup === innerId;
    view.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const exitedInner = session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === innerId && session.editor.selection.enteredGroup === outerId;
    view.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('嵌套组每次双击只进一层，Escape 按父链对称退出', selectedOuter && enteredOuter
      && enteredInner && exitedInner && session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === outerId && session.editor.selection.enteredGroup === null);
    session.dispose();
  }
}
