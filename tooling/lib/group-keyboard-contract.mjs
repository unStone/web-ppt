/** 组合快捷键只经过公开选区、DOM 事件和共享视图验收。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyboardEvent } from './keyboard-event.mjs';

const countIdentity = (container, id) =>
  container.querySelectorAll(`[data-edit-root="${id}"]`).length;

function groupedDom(container, groupId, childIds) {
  const group = container.querySelector(`[data-edit-root="${groupId}"]`);
  return !!group && childIds.every((id) => countIdentity(container, id) === 1
    && group.contains(container.querySelector(`[data-edit-root="${id}"]`)));
}

function ungroupedDom(container, groupId, childIds) {
  return countIdentity(container, groupId) === 0
    && childIds.every((id) => countIdentity(container, id) === 1
      && !container.querySelector(`[data-edit-root="${id}"]`)
        .closest(`[data-edit-root="${groupId}"]`));
}

export async function runGroupKeyboardContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ Ctrl/Cmd+G 组合与解组\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-space.pptx')));
  const errors = [];
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-group-key-' });
  const eventContainer = document.createElement('div');
  const sharedContainer = document.createElement('div');
  const eventView = session.mount(eventContainer, {
    mode: 'edit', textMode: 'svg', onError: (error) => errors.push(String(error)),
  });
  session.mount(sharedContainer, { mode: 'edit', textMode: 'svg' });
  const byName = (name) => Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === name);
  const selected = [byName('space-plain'), byName('space-rotated-flipped')];
  const childIds = selected.map((record) => record.id);
  const untouched = byName('space-outer-group');
  const eventSibling = eventContainer.querySelector(`[data-edit-root="${untouched.id}"]`);
  const sharedSibling = sharedContainer.querySelector(`[data-edit-root="${untouched.id}"]`);
  const eventSvg = eventContainer.querySelector('[data-ppt-layer="static"] svg');
  const sharedSvg = sharedContainer.querySelector('[data-ppt-layer="static"] svg');

  session.editor.select({ kind: 'elements', ids: childIds, enteredGroup: null });
  const groupedAccepted = eventView.element.dispatchEvent(keyboardEvent('keydown', 'g', { ctrlKey: true }));
  const groupSelection = session.editor.selection;
  const groupId = groupSelection.kind === 'elements' ? groupSelection.ids[0] : null;
  check('Ctrl+G 单事务组合并在两个视图增量嵌套孩子', !groupedAccepted && !!groupId
    && groupSelection.ids.length === 1 && session.editor.doc.elements[groupId]?.src.kind === 'group'
    && groupedDom(eventContainer, groupId, childIds)
    && groupedDom(sharedContainer, groupId, childIds)
    && eventContainer.querySelector(`[data-edit-root="${untouched.id}"]`) === eventSibling
    && sharedContainer.querySelector(`[data-edit-root="${untouched.id}"]`) === sharedSibling
    && eventContainer.querySelector('[data-ppt-layer="static"] svg') === eventSvg
    && sharedContainer.querySelector('[data-ppt-layer="static"] svg') === sharedSvg
    && session.editor.history.undoCount === 1 && errors.length === 0);

  const ungroupedAccepted = eventView.element.dispatchEvent(keyboardEvent('keydown', 'G', {
    metaKey: true, shiftKey: true,
  }));
  const childSelection = session.editor.selection;
  check('Meta+Shift+G 单事务解组并在两个视图恢复直属孩子', !ungroupedAccepted
    && !session.editor.doc.elements[groupId]
    && childSelection.kind === 'elements' && childSelection.ids.join(',') === childIds.join(',')
    && ungroupedDom(eventContainer, groupId, childIds)
    && ungroupedDom(sharedContainer, groupId, childIds)
    && eventContainer.querySelector(`[data-edit-root="${untouched.id}"]`) === eventSibling
    && sharedContainer.querySelector(`[data-edit-root="${untouched.id}"]`) === sharedSibling
    && eventContainer.querySelector('[data-ppt-layer="static"] svg') === eventSvg
    && sharedContainer.querySelector('[data-ppt-layer="static"] svg') === sharedSvg
    && session.editor.history.undoCount === 2 && errors.length === 0);

  session.editor.undo();
  const undoSelection = session.editor.selection;
  const undoCorrect = undoSelection.kind === 'elements' && undoSelection.ids[0] === groupId
    && groupedDom(eventContainer, groupId, childIds)
    && groupedDom(sharedContainer, groupId, childIds);
  session.editor.redo();
  const redoSelection = session.editor.selection;
  check('解组撤销/重做恢复结构与选区且不重建未触碰 DOM', undoCorrect
    && redoSelection.kind === 'elements' && redoSelection.ids.join(',') === childIds.join(',')
    && ungroupedDom(eventContainer, groupId, childIds)
    && ungroupedDom(sharedContainer, groupId, childIds)
    && eventContainer.querySelector(`[data-edit-root="${untouched.id}"]`) === eventSibling
    && sharedContainer.querySelector(`[data-edit-root="${untouched.id}"]`) === sharedSibling
    && eventContainer.querySelector('[data-ppt-layer="static"] svg') === eventSvg
    && sharedContainer.querySelector('[data-ppt-layer="static"] svg') === sharedSvg);

  const historyBeforeBoundary = session.editor.history.undoCount;
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
    control.dispatchEvent(keyboardEvent('keydown', 'g', { ctrlKey: true })));
  const invalidYield = [
    keyboardEvent('keydown', 'g', {}),
    keyboardEvent('keydown', 'g', { ctrlKey: true, metaKey: true }),
    keyboardEvent('keydown', 'g', { ctrlKey: true, altKey: true }),
  ].every((event) => eventView.element.dispatchEvent(event));
  eventView.setMode('view');
  const viewYields = eventView.element.dispatchEvent(keyboardEvent('keydown', 'g', { ctrlKey: true }));
  eventView.setMode('edit');
  session.editor.select({ kind: 'none' });
  const emptyConsumed = eventView.element.dispatchEvent(keyboardEvent('keydown', 'g', { ctrlKey: true }));
  check('view、控件与非法修饰保留键盘所有权，空选区只消费不建历史', controlsYield
    && invalidYield && viewYields && !emptyConsumed
    && session.editor.history.undoCount === historyBeforeBoundary && errors.length === 0);
  session.dispose();

  const source = await lib.openEditor(bytes, { idPrefix: 'editor-source-ungroup-' });
  const sourceEventContainer = document.createElement('div');
  const sourceSharedContainer = document.createElement('div');
  const sourceView = source.mount(sourceEventContainer, { mode: 'edit', textMode: 'svg' });
  source.mount(sourceSharedContainer, { mode: 'edit', textMode: 'svg' });
  const sourceByName = (name) => Object.values(source.editor.doc.elements)
    .find((record) => record.src.name === name);
  const sourceGroup = sourceByName('space-outer-group');
  const sourceChildIds = [...sourceGroup.children];
  const sourceEventChildren = new Map(sourceChildIds.map((id) => [id,
    sourceEventContainer.querySelector(`[data-edit-root="${id}"]`)]));
  const sourceSharedChildren = new Map(sourceChildIds.map((id) => [id,
    sourceSharedContainer.querySelector(`[data-edit-root="${id}"]`)]));
  const sourceUntouched = sourceByName('space-plain');
  const sourceEventUntouched = sourceEventContainer.querySelector(
    `[data-edit-root="${sourceUntouched.id}"]`,
  );
  const sourceSharedUntouched = sourceSharedContainer.querySelector(
    `[data-edit-root="${sourceUntouched.id}"]`,
  );
  const sourceEventSvg = sourceEventContainer.querySelector('[data-ppt-layer="static"] svg');
  const sourceSharedSvg = sourceSharedContainer.querySelector('[data-ppt-layer="static"] svg');
  source.editor.select({ kind: 'elements', ids: [sourceGroup.id], enteredGroup: null });
  const sourceAccepted = sourceView.element.dispatchEvent(keyboardEvent('keydown', 'G', {
    ctrlKey: true, shiftKey: true,
  }));
  check('来源 grpSp 解组在两个视图拆壳并只重绘直属孩子', !sourceAccepted
    && ungroupedDom(sourceEventContainer, sourceGroup.id, sourceChildIds)
    && ungroupedDom(sourceSharedContainer, sourceGroup.id, sourceChildIds)
    && sourceChildIds.every((id) => sourceEventContainer.querySelector(
      `[data-edit-root="${id}"]`,
    ) !== sourceEventChildren.get(id))
    && sourceChildIds.every((id) => sourceSharedContainer.querySelector(
      `[data-edit-root="${id}"]`,
    ) !== sourceSharedChildren.get(id))
    && sourceEventContainer.querySelector(`[data-edit-root="${sourceUntouched.id}"]`)
      === sourceEventUntouched
    && sourceSharedContainer.querySelector(`[data-edit-root="${sourceUntouched.id}"]`)
      === sourceSharedUntouched
    && sourceEventContainer.querySelector('[data-ppt-layer="static"] svg') === sourceEventSvg
    && sourceSharedContainer.querySelector('[data-ppt-layer="static"] svg') === sourceSharedSvg);
  source.editor.undo();
  check('来源 grpSp 解组撤销增量恢复组合且不重建未触碰 DOM',
    groupedDom(sourceEventContainer, sourceGroup.id, sourceChildIds)
    && groupedDom(sourceSharedContainer, sourceGroup.id, sourceChildIds)
    && sourceEventContainer.querySelector(`[data-edit-root="${sourceUntouched.id}"]`)
      === sourceEventUntouched
    && sourceSharedContainer.querySelector(`[data-edit-root="${sourceUntouched.id}"]`)
      === sourceSharedUntouched
    && sourceEventContainer.querySelector('[data-ppt-layer="static"] svg') === sourceEventSvg
    && sourceSharedContainer.querySelector('[data-ppt-layer="static"] svg') === sourceSharedSvg);
  source.dispose();

  const rejectionErrors = [];
  const rejection = await lib.openEditor(bytes, { idPrefix: 'editor-group-reject-' });
  const rejectionView = rejection.mount(document.createElement('div'), {
    mode: 'edit', textMode: 'svg', onError: (error) => rejectionErrors.push(String(error)),
  });
  const risky = Object.values(rejection.editor.doc.elements)
    .find((record) => record.src.name === 'space-outer-group');
  rejection.editor.exec({ type: 'SetXfrm', id: risky.id, w: risky.src.w * 1.2 });
  rejection.editor.history.clear();
  rejection.editor.markSaved();
  rejection.editor.select({ kind: 'elements', ids: [risky.id], enteredGroup: null });
  const rejectedAccepted = rejectionView.element.dispatchEvent(keyboardEvent('keydown', 'g', {
    ctrlKey: true, shiftKey: true,
  }));
  check('不可逆解组消费快捷键、向宿主报告原因且不污染历史', !rejectedAccepted
    && rejectionErrors.length === 1 && /旋转与非等比缩放/.test(rejectionErrors[0])
    && rejection.editor.history.undoCount === 0 && !rejection.editor.isDirty());
  rejection.dispose();
}
