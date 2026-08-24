/** 真实输入域必须能在重复 engine 分段中提交文字，并守住 IME 节点身份。 */
export async function runTrustedEngineTextContract({ evaluate, request }) {
  await evaluate(`(() => {
    const state = globalThis.editorContract.engineTextResult;
    let editable = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    if (!editable) {
      state.mount.querySelector('[data-edit-id="' + state.id + '"]').dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
      editable = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    }
    const markers = [...editable.querySelectorAll('[data-r="0.0"][data-from]')]
      .filter((marker) => Number(marker.dataset.to) > Number(marker.dataset.from));
    const marker = markers[1];
    const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode();
    const range = document.createRange();
    range.setStart(text, 1); range.collapse(true);
    const selection = getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    editable.focus({ preventScroll: true });
    state.insertion = Number(marker.dataset.from) + 1;
    state.before = state.session.editor.effectiveElement(state.id).text.paragraphs[0].runs
      .map((run) => run.text).join('');
    state.events = [];
    for (const type of ['beforeinput', 'compositionstart', 'compositionupdate', 'compositionend']) {
      state.mount.addEventListener(type, (event) => state.events.push({
        type, trusted: event.isTrusted, composing: event.isComposing, data: event.data,
      }), true);
    }
  })()`);
  await request('Input.insertText', { text: '真' });
  const inserted = await evaluate(`(() => {
    const state = globalThis.editorContract.engineTextResult;
    const current = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    const value = state.session.editor.effectiveElement(state.id).text.paragraphs[0].runs
      .map((run) => run.text).join('');
    return !!current?.querySelector('[data-layout="engine"]')
      && value === state.before.slice(0, state.insertion) + '真' + state.before.slice(state.insertion);
  })()`);
  await request('Input.imeSetComposition', {
    text: '中', selectionStart: 1, selectionEnd: 1,
  });
  await evaluate(`(() => {
    const state = globalThis.editorContract.engineTextResult;
    state.compositionNode = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
  })()`);
  await request('Input.imeSetComposition', {
    text: '中文', selectionStart: 2, selectionEnd: 2,
  });
  const stable = await evaluate(`(() => {
    const state = globalThis.editorContract.engineTextResult;
    return state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]') === state.compositionNode;
  })()`);
  await request('Input.insertText', { text: '中文' });
  const result = await evaluate(`(() => {
    const state = globalThis.editorContract.engineTextResult;
    const current = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    const value = state.session.editor.effectiveElement(state.id).text.paragraphs[0].runs
      .map((run) => run.text).join('');
    const expected = state.before.slice(0, state.insertion) + '真中文' + state.before.slice(state.insertion);
    const result = {
      value: value === expected,
      engine: !!current?.querySelector('[data-layout="engine"]'),
      trustedBeforeInput: state.events.some((event) => event.type === 'beforeinput' && event.trusted),
      trustedComposition: state.events.some((event) => event.type === 'compositionstart' && event.trusted)
        && state.events.some((event) => event.type === 'compositionupdate' && event.trusted)
        && state.events.some((event) => event.type === 'compositionend'),
      events: state.events,
    };
    state.view.destroy(); state.session.dispose(); state.mount.remove();
    return result;
  })()`);
  if (!inserted || !stable || !result.value || !result.engine
    || !result.trustedBeforeInput || !result.trustedComposition) {
    throw new Error(`真实 engine 文字/IME 输入失败：${JSON.stringify({ inserted, stable, ...result })}`);
  }
}
