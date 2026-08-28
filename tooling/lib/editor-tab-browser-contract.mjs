/** Tab 的焦点默认行为与帧预算必须由真实 Chrome 验收。 */
import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const tab = (shiftKey = false) => new KeyboardEvent('keydown', {
  key: 'Tab', bubbles: true, composed: true, cancelable: true, shiftKey,
});

export async function runEditorTabBrowserContract({ openEditor, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const session = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-tab-perf-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const ids = session.editor.doc.slides[view.slideId].children;
    const staticSvg = mount.querySelector('[data-ppt-layer="static"] svg');
    view.element.focus({ preventScroll: true });
    const samples = [];
    let consumed = true;
    for (let index = 0; index < 120; index++) {
      const started = performance.now();
      consumed &&= !view.element.dispatchEvent(tab());
      mount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const selection = session.editor.selection;
    if (ids.length !== 60 || !consumed
      || document.activeElement !== view.element
      || selection.kind !== 'elements' || selection.ids.join(',') !== ids[59]
      || selection.enteredGroup !== null || session.editor.history.undoCount !== 0
      || mount.querySelector('[data-ppt-layer="static"] svg') !== staticSvg) {
      throw new Error('60 元素 Tab 遍历的焦点、选区或静态层不一致');
    }
    recordPerformanceBudget('60 元素 Tab 遍历 p95', p95, 8);
    return p95;
  } finally {
    session.dispose();
    mount.remove();
  }
}

export async function runTrustedTabContract({ evaluate, dispatchKey }) {
  await evaluate(`(() => {
    const { perfSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const view = perfSession.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const id = perfSession.editor.doc.slides[view.slideId].children[0];
    perfSession.editor.select({ kind: 'none' });
    const events = [];
    view.element.addEventListener('keydown', (event) => events.push([event.type, event.key, event.isTrusted]));
    view.element.addEventListener('keyup', (event) => events.push([event.type, event.key, event.isTrusted]));
    view.element.focus({ preventScroll: true });
    globalThis.trustedTabContract = {
      view, id, events, history: perfSession.editor.history.undoCount,
      svg: mount.querySelector('[data-ppt-layer="static"] svg'),
    };
  })()`);
  await dispatchKey('Tab', 'Tab', 9);
  const result = await evaluate(`(() => {
    const state = globalThis.trustedTabContract;
    const { perfSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const selection = perfSession.editor.selection;
    const result = {
      trustedEvents: state.events.length === 2
        && state.events.every((entry) => entry[1] === 'Tab' && entry[2] === true),
      focused: document.activeElement === state.view.element,
      selectedFirst: selection.kind === 'elements' && selection.ids.join(',') === state.id
        && selection.enteredGroup === null,
      noHistory: perfSession.editor.history.undoCount === state.history,
      staticStable: mount.querySelector('[data-ppt-layer="static"] svg') === state.svg,
    };
    state.view.destroy();
    delete globalThis.trustedTabContract;
    return result;
  })()`);
  if (!Object.values(result).every(Boolean)) {
    throw new Error(`真实 Tab 焦点与遍历失败：${JSON.stringify(result)}`);
  }
}
