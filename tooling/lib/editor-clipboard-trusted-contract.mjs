/** Ctrl/Cmd+C/V 必须由浏览器产生可信 ClipboardEvent，编辑器自身不碰 navigator.clipboard。 */
export async function runTrustedClipboardContract({ evaluate, dispatchKey }) {
  const modifier = await evaluate("navigator.platform.includes('Mac') ? 4 : 2");
  await evaluate(`(() => {
    const { trustedLayerSession: session } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    session.editor.history.clear();
    session.editor.markSaved();
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const id = session.editor.doc.slides[view.slideId].children.find((candidate) =>
      session.editor.doc.elements[candidate].meta.editable === 'full');
    session.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
    const events = [];
    view.element.addEventListener('copy', (event) => events.push({
      type: event.type, trusted: event.isTrusted, prevented: event.defaultPrevented,
    }));
    view.element.addEventListener('paste', (event) => events.push({
      type: event.type, trusted: event.isTrusted, prevented: event.defaultPrevented,
    }));
    view.element.focus({ preventScroll: true });
    globalThis.trustedClipboardContract = {
      view, id, events,
      count: Object.keys(session.editor.doc.elements).length,
      node: mount.querySelector('[data-edit-id="' + id + '"]'),
    };
  })()`);
  await dispatchKey('c', 'KeyC', 67, modifier, ['copy']);
  await dispatchKey('v', 'KeyV', 86, modifier, ['paste']);
  const result = await evaluate(`(() => {
    const state = globalThis.trustedClipboardContract;
    const { trustedLayerSession: session } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const selection = session.editor.selection;
    const result = {
      events: state.events,
      count: Object.keys(session.editor.doc.elements).length,
      sourceCount: state.count,
      undo: session.editor.history.undoCount,
      selected: selection.kind === 'elements' ? selection.ids.length : 0,
      originalStable: mount.querySelector('[data-edit-id="' + state.id + '"]') === state.node,
      focused: document.activeElement === state.view.element,
    };
    session.editor.undo();
    session.editor.history.clear();
    session.editor.markSaved();
    state.view.destroy();
    delete globalThis.trustedClipboardContract;
    return result;
  })()`);
  const eventsCorrect = result.events.length === 2
    && result.events[0].type === 'copy' && result.events[1].type === 'paste'
    && result.events.every((event) => event.trusted && event.prevented);
  if (!eventsCorrect || result.count !== result.sourceCount + 1 || result.undo !== 1
    || result.selected !== 1 || !result.originalStable || !result.focused) {
    throw new Error(`真实复制粘贴快捷键失败：${JSON.stringify(result)}`);
  }
}
