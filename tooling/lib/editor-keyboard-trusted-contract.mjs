/** DevTools 输入域产生 isTrusted 键盘事件，防止契约只在合成事件下成立。 */
export async function runTrustedKeyboardContract({ evaluate, dispatchKey }) {
  await evaluate(`(() => {
    const { perfSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const view = perfSession.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const id = perfSession.editor.doc.slides[view.slideId].children[0];
    perfSession.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
    const trust = [];
    view.element.addEventListener('keydown', (event) => trust.push([event.type, event.key, event.isTrusted]));
    view.element.addEventListener('keyup', (event) => trust.push([event.type, event.key, event.isTrusted]));
    view.element.focus({ preventScroll: true });
    globalThis.trustedKeyboardContract = {
      view, id, trust, source: perfSession.editor.effectiveElement(id),
      historyBefore: perfSession.editor.history.undoCount,
    };
  })()`);
  await dispatchKey('ArrowRight', 'ArrowRight', 39);
  const result = await evaluate(`(() => {
    const state = globalThis.trustedKeyboardContract;
    const { perfSession } = globalThis.editorContract;
    const moved = perfSession.editor.effectiveElement(state.id);
    const selection = perfSession.editor.selection;
    const result = {
      trustedEvents: state.trust.length === 2
        && state.trust.every((entry) => entry[1] === 'ArrowRight' && entry[2] === true),
      focused: document.activeElement === state.view.element,
      moved: Math.abs(moved.x - state.source.x - 1) < 1e-6
        && Math.abs(moved.y - state.source.y) < 1e-6,
      oneHistory: perfSession.editor.history.undoCount === state.historyBefore + 1,
      selectionStable: selection.kind === 'elements' && selection.ids.length === 1
        && selection.ids[0] === state.id,
    };
    perfSession.editor.undo();
    result.undoRestored = Math.abs(perfSession.editor.effectiveElement(state.id).x - state.source.x) < 1e-6;
    state.view.destroy();
    delete globalThis.trustedKeyboardContract;
    return result;
  })()`);
  if (!Object.values(result).every(Boolean)) {
    throw new Error(`真实键盘微移失败：${JSON.stringify(result)}`);
  }
}
