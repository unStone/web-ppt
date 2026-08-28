/** 真实浏览器同时验证 60 元素层级反馈预算与可信括号键语义。 */
import { keyboardEvent } from './keyboard-event.mjs';
import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const p95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

export async function runEditorLayerBrowserContract({ openEditor, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const session = await openEditor(await load('sample-editor-layer.pptx'), {
    idPrefix: 'browser-layer-perf-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const roots = [...session.editor.doc.slides[view.slideId].children];
    const ids = roots.filter((id) => session.editor.doc.elements[id].meta.editable !== 'none');
    const selected = ids.slice(0, -1);
    const identities = new Map(ids.map((id) => [id, mount.querySelector(`[data-edit-root="${id}"]`)]));
    const layer = [];
    const undo = [];
    const redo = [];
    let consumed = true;
    for (let index = 0; index < 40; index++) {
      session.editor.select({ kind: 'elements', ids: selected, enteredGroup: null });
      let started = performance.now();
      consumed &&= !view.element.dispatchEvent(keyboardEvent('keydown', '}', {
        code: 'BracketRight', ctrlKey: true, shiftKey: true,
      }));
      mount.querySelector('[data-ppt-layer="static"] svg')?.getBoundingClientRect();
      layer.push(performance.now() - started);
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
    const result = { layerP95: p95(layer), undoP95: p95(undo), redoP95: p95(redo) };
    const stable = ids.every((id) => mount.querySelector(`[data-edit-root="${id}"]`) === identities.get(id));
    const orderedNodes = roots.map((id) => mount.querySelector(`[data-edit-root="${id}"]`));
    const domOrder = orderedNodes.every((node, index) => index === 0
      || !!(orderedNodes[index - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
    const selection = session.editor.selection;
    if (ids.length !== 60 || selected.length !== 59
      || !consumed || !stable || !domOrder
      || session.editor.doc.slides[view.slideId].children.join(',') !== roots.join(',')
      || selection.kind !== 'elements' || selection.ids.join(',') !== selected.join(',')
      || session.editor.history.undoCount !== 0 || session.editor.history.redoCount !== 1
      || session.editor.isDirty()) {
      throw new Error('60 元素层级/撤销/重做最终状态不一致：'
        + JSON.stringify({ ids: ids.length, selected: selected.length, consumed, stable, domOrder,
          selection: selection.kind, undo: session.editor.history.undoCount,
          redo: session.editor.history.redoCount, dirty: session.editor.isDirty() }));
    }
    recordPerformanceBudget('60 元素层级 p95', result.layerP95, 8);
    recordPerformanceBudget('60 元素层级撤销 p95', result.undoP95, 8);
    recordPerformanceBudget('60 元素层级重做 p95', result.redoP95, 8);
    return result;
  } finally {
    session.dispose();
    mount.remove();
  }
}

export async function runTrustedLayerContract({ evaluate, dispatchKey }) {
  await evaluate(`(() => {
    const { trustedLayerSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    trustedLayerSession.editor.history.clear();
    trustedLayerSession.editor.markSaved();
    const view = trustedLayerSession.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const slideId = view.slideId;
    const id = trustedLayerSession.editor.doc.slides[slideId].children
      .find((candidate) => trustedLayerSession.editor.doc.elements[candidate].src.name === 'layer-back');
    const peer = trustedLayerSession.editor.doc.slides[slideId].children
      .find((candidate) => trustedLayerSession.editor.doc.elements[candidate].src.name === 'layer-item-01');
    trustedLayerSession.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
    const target = mount.querySelector('[data-edit-root="' + id + '"]');
    const peerNode = mount.querySelector('[data-edit-root="' + peer + '"]');
    const events = [];
    view.element.addEventListener('keydown', (event) => {
      if (event.code === 'BracketRight' || event.code === 'BracketLeft') events.push({
        key: event.key, code: event.code, trusted: event.isTrusted,
        prevented: event.defaultPrevented, ctrl: event.ctrlKey, shift: event.shiftKey,
      });
    });
    view.element.focus({ preventScroll: true });
    globalThis.trustedLayerContract = { view, id, peer, target, peerNode, events };
  })()`);
  await dispatchKey(']', 'BracketRight', 221, 2);
  const moved = await evaluate(`(() => {
    const state = globalThis.trustedLayerContract;
    const { trustedLayerSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const ids = trustedLayerSession.editor.doc.slides[state.view.slideId].children;
    return {
      adjacent: ids.indexOf(state.id) === ids.indexOf(state.peer) + 1,
      targetStable: mount.querySelector('[data-edit-root="' + state.id + '"]') === state.target,
      peerStable: mount.querySelector('[data-edit-root="' + state.peer + '"]') === state.peerNode,
      oneHistory: trustedLayerSession.editor.history.undoCount === 1,
      focused: document.activeElement === state.view.element,
    };
  })()`);
  await dispatchKey('z', 'KeyZ', 90, 2);
  await dispatchKey('}', 'BracketRight', 221, 10);
  const result = await evaluate(`(() => {
    const state = globalThis.trustedLayerContract;
    const { trustedLayerSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const ids = trustedLayerSession.editor.doc.slides[state.view.slideId].children;
    const writable = ids.filter((id) => trustedLayerSession.editor.doc.elements[id].meta.editable !== 'none');
    const result = {
      front: writable.at(-1) === state.id,
      targetStable: mount.querySelector('[data-edit-root="' + state.id + '"]') === state.target,
      oneHistory: trustedLayerSession.editor.history.undoCount === 1,
      events: state.events,
      focused: document.activeElement === state.view.element,
    };
    trustedLayerSession.editor.undo();
    trustedLayerSession.editor.history.clear();
    trustedLayerSession.editor.markSaved();
    state.view.destroy();
    delete globalThis.trustedLayerContract;
    return result;
  })()`);
  const eventsCorrect = result.events.length === 2
    && result.events.every((event) => event.trusted && event.prevented && event.ctrl)
    && result.events[0].key === ']' && !result.events[0].shift
    && result.events[1].key === '}' && result.events[1].code === 'BracketRight' && result.events[1].shift;
  if (!Object.values(moved).every(Boolean) || !result.front || !result.targetStable
    || !result.oneHistory || !result.focused || !eventsCorrect) {
    throw new Error(`真实 Ctrl+] / Ctrl+Shift+] 失败：${JSON.stringify({ moved, result, eventsCorrect })}`);
  }
}
