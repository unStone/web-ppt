/** 撤销重做的默认行为、可信修饰键与 60 元素反馈预算必须由真实浏览器取证。 */
import { keyboardEvent } from './keyboard-event.mjs';

export async function runEditorHistoryBrowserContract({ openEditor, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const session = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-history-perf-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const ids = session.editor.doc.slides[view.slideId].children;
    const sources = ids.map((id) => session.editor.effectiveElement(id));
    session.editor.select({ kind: 'elements', ids, enteredGroup: null });
    view.element.dispatchEvent(keyboardEvent('keydown', 'ArrowRight'));
    view.element.dispatchEvent(keyboardEvent('keyup', 'ArrowRight'));
    const undoSamples = [];
    const redoSamples = [];
    let consumed = true;
    for (let index = 0; index < 80; index++) {
      let started = performance.now();
      consumed &&= !view.element.dispatchEvent(keyboardEvent('keydown', 'z', { ctrlKey: true }));
      mount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
      undoSamples.push(performance.now() - started);
      started = performance.now();
      consumed &&= !view.element.dispatchEvent(keyboardEvent('keydown', 'y', { metaKey: true }));
      mount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
      redoSamples.push(performance.now() - started);
    }
    undoSamples.sort((left, right) => left - right);
    redoSamples.sort((left, right) => left - right);
    const undoP95 = undoSamples[Math.floor(undoSamples.length * 0.95)];
    const redoP95 = redoSamples[Math.floor(redoSamples.length * 0.95)];
    const moved = ids.every((id, index) => {
      const current = session.editor.effectiveElement(id);
      return current.x === sources[index].x + 1 && current.y === sources[index].y;
    });
    const selection = session.editor.selection;
    if (ids.length !== 60 || undoP95 > 8 || redoP95 > 8 || !consumed || !moved
      || selection.kind !== 'elements' || selection.ids.join(',') !== ids.join(',')
      || session.editor.history.undoCount !== 1 || session.editor.history.redoCount !== 0
      || !session.editor.isDirty() || mount.querySelectorAll('[data-edit-id]').length !== 60) {
      throw new Error(`60 元素撤销/重做 p95 ${undoP95.toFixed(3)}/${redoP95.toFixed(3)}ms `
        + '或模型、历史、选区不一致');
    }
    return { undoP95, redoP95 };
  } finally {
    session.dispose();
    mount.remove();
  }
}

export async function runTrustedHistoryContract({ evaluate, dispatchKey }) {
  await evaluate(`(() => {
    const { perfSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    perfSession.editor.history.clear();
    perfSession.editor.markSaved();
    const view = perfSession.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const id = perfSession.editor.doc.slides[view.slideId].children[0];
    const source = perfSession.editor.effectiveElement(id);
    perfSession.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
    perfSession.editor.exec({ type: 'SetXfrm', id, x: source.x + 9 });
    const events = [];
    view.element.addEventListener('keydown', (event) => events.push({
      key: event.key.toLowerCase(), trusted: event.isTrusted, prevented: event.defaultPrevented,
      ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey,
    }));
    view.element.focus({ preventScroll: true });
    globalThis.trustedHistoryContract = { view, id, source, events };
  })()`);
  const snapshot = () => evaluate(`(() => {
    const state = globalThis.trustedHistoryContract;
    const { perfSession } = globalThis.editorContract;
    return {
      x: perfSession.editor.effectiveElement(state.id).x,
      undo: perfSession.editor.history.undoCount,
      redo: perfSession.editor.history.redoCount,
      dirty: perfSession.editor.isDirty(),
      focused: document.activeElement === state.view.element,
    };
  })()`);
  await dispatchKey('z', 'KeyZ', 90, 2);
  const ctrlUndo = await snapshot();
  await dispatchKey('y', 'KeyY', 89, 4);
  const metaRedo = await snapshot();
  await dispatchKey('z', 'KeyZ', 90, 4);
  const metaUndo = await snapshot();
  await dispatchKey('z', 'KeyZ', 90, 12);
  const shiftRedo = await snapshot();
  const result = await evaluate(`(() => {
    const state = globalThis.trustedHistoryContract;
    const { perfSession } = globalThis.editorContract;
    const result = {
      events: state.events,
      sourceX: state.source.x,
      focused: document.activeElement === state.view.element,
    };
    perfSession.editor.undo();
    perfSession.editor.history.clear();
    perfSession.editor.markSaved();
    state.view.destroy();
    delete globalThis.trustedHistoryContract;
    return result;
  })()`);
  const statesCorrect = ctrlUndo.x === result.sourceX && ctrlUndo.undo === 0 && ctrlUndo.redo === 1
    && !ctrlUndo.dirty && metaRedo.x === result.sourceX + 9 && metaRedo.undo === 1 && metaRedo.redo === 0
    && metaRedo.dirty && metaUndo.x === result.sourceX && metaUndo.undo === 0 && metaUndo.redo === 1
    && !metaUndo.dirty && shiftRedo.x === result.sourceX + 9
    && shiftRedo.undo === 1 && shiftRedo.redo === 0 && shiftRedo.dirty;
  const expectedModifiers = [
    { key: 'z', ctrl: true, meta: false, shift: false },
    { key: 'y', ctrl: false, meta: true, shift: false },
    { key: 'z', ctrl: false, meta: true, shift: false },
    { key: 'z', ctrl: false, meta: true, shift: true },
  ];
  const eventsCorrect = result.events.length === expectedModifiers.length
    && result.events.every((event, index) => event.trusted && event.prevented
      && event.key === expectedModifiers[index].key
      && event.ctrl === expectedModifiers[index].ctrl
      && event.meta === expectedModifiers[index].meta
      && event.shift === expectedModifiers[index].shift);
  if (!statesCorrect || !eventsCorrect || !result.focused
    || !ctrlUndo.focused || !metaRedo.focused || !metaUndo.focused || !shiftRedo.focused) {
    throw new Error(`真实撤销重做快捷键失败：${JSON.stringify({
      ctrlUndo, metaRedo, metaUndo, shiftRedo, result, statesCorrect, eventsCorrect,
    })}`);
  }
}
