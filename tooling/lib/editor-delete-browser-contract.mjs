/** 批量结构删除的完整 DOM 反馈与可信按键默认行为都必须纳入预算。 */
import { keyboardEvent } from './keyboard-event.mjs';
import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const p95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

export async function runEditorDeleteBrowserContract({ openEditor, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const session = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-delete-perf-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const ids = [...session.editor.doc.slides[view.slideId].children];
    const deletion = [];
    const undo = [];
    const redo = [];
    let consumed = true;
    for (let index = 0; index < 60; index++) {
      session.editor.select({ kind: 'elements', ids, enteredGroup: null });
      let started = performance.now();
      consumed &&= !view.element.dispatchEvent(keyboardEvent('keydown', 'Delete'));
      mount.querySelector('[data-ppt-layer="static"] svg')?.getBoundingClientRect();
      deletion.push(performance.now() - started);
      started = performance.now();
      consumed &&= !view.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true }));
      mount.querySelector('[data-ppt-layer="static"] svg')?.getBoundingClientRect();
      undo.push(performance.now() - started);
      started = performance.now();
      consumed &&= !view.element.dispatchEvent(keyboardEvent('keydown', 'y', { ctrlKey: true }));
      mount.querySelector('[data-ppt-layer="static"] svg')?.getBoundingClientRect();
      redo.push(performance.now() - started);
      view.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true }));
    }
    const result = { deleteP95: p95(deletion), undoP95: p95(undo), redoP95: p95(redo) };
    const selection = session.editor.selection;
    if (ids.length !== 60 || !consumed
      || !ids.every((id) => !!session.editor.doc.elements[id])
      || mount.querySelectorAll('[data-edit-id]').length !== 60
      || selection.kind !== 'elements' || selection.ids.join(',') !== ids.join(',')
      || session.editor.history.undoCount !== 0 || session.editor.history.redoCount !== 1
      || session.editor.isDirty()) {
      throw new Error('60 元素删除/撤销/重做最终状态不一致：'
        + JSON.stringify({ consumed, existing: ids.filter((id) => !!session.editor.doc.elements[id]).length,
          nodes: mount.querySelectorAll('[data-edit-id]').length, selection: selection.kind,
          selected: selection.kind === 'elements' ? selection.ids.length : 0,
          undo: session.editor.history.undoCount, redo: session.editor.history.redoCount,
          dirty: session.editor.isDirty() }));
    }
    recordPerformanceBudget('60 元素删除 p95', result.deleteP95, 8);
    recordPerformanceBudget('60 元素删除撤销 p95', result.undoP95, 8);
    recordPerformanceBudget('60 元素删除重做 p95', result.redoP95, 8);
    return result;
  } finally {
    session.dispose();
    mount.remove();
  }
}

export async function runTrustedDeleteContract({ evaluate, dispatchKey }) {
  await evaluate(`(() => {
    const { perfSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    perfSession.editor.history.clear();
    perfSession.editor.markSaved();
    const view = perfSession.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const id = perfSession.editor.doc.slides[view.slideId].children[0];
    perfSession.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
    const events = [];
    view.element.addEventListener('keydown', (event) => events.push({
      key: event.key, trusted: event.isTrusted, prevented: event.defaultPrevented,
      ctrl: event.ctrlKey, shift: event.shiftKey,
    }));
    view.element.focus({ preventScroll: true });
    globalThis.trustedDeleteContract = { view, id, events };
  })()`);
  const snapshot = () => evaluate(`(() => {
    const state = globalThis.trustedDeleteContract;
    const { perfSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    return {
      exists: !!perfSession.editor.doc.elements[state.id],
      node: !!mount.querySelector('[data-edit-id="' + state.id + '"]'),
      selection: perfSession.editor.selection.kind,
      undo: perfSession.editor.history.undoCount,
      redo: perfSession.editor.history.redoCount,
      dirty: perfSession.editor.isDirty(),
      focused: document.activeElement === state.view.element,
    };
  })()`);
  await dispatchKey('Delete', 'Delete', 46, 0);
  const deleted = await snapshot();
  await dispatchKey('z', 'KeyZ', 90, 2);
  const restored = await snapshot();
  await dispatchKey('Backspace', 'Backspace', 8, 8);
  const backspaced = await snapshot();
  await dispatchKey('z', 'KeyZ', 90, 2);
  const restoredAgain = await snapshot();
  const result = await evaluate(`(() => {
    const state = globalThis.trustedDeleteContract;
    const { perfSession } = globalThis.editorContract;
    const result = { events: state.events, focused: document.activeElement === state.view.element };
    perfSession.editor.history.clear();
    perfSession.editor.markSaved();
    state.view.destroy();
    delete globalThis.trustedDeleteContract;
    return result;
  })()`);
  const removed = (state) => !state.exists && !state.node && state.selection === 'none'
    && state.undo === 1 && state.redo === 0 && state.dirty && state.focused;
  const present = (state) => state.exists && state.node && state.selection === 'elements'
    && state.undo === 0 && state.redo === 1 && !state.dirty && state.focused;
  const deleteEvents = result.events.filter((event) => event.key === 'Delete' || event.key === 'Backspace');
  const eventsCorrect = deleteEvents.length === 2
    && deleteEvents.every((event) => event.trusted && event.prevented && !event.ctrl)
    && !deleteEvents[0].shift && deleteEvents[1].shift;
  if (!removed(deleted) || !present(restored) || !removed(backspaced)
    || !present(restoredAgain) || !eventsCorrect || !result.focused) {
    throw new Error(`真实 Delete/Backspace 失败：${JSON.stringify({
      deleted, restored, backspaced, restoredAgain, result, eventsCorrect,
    })}`);
  }
}
