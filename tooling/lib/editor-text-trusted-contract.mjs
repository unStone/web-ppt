/** DevTools IME 输入域产生 isTrusted beforeinput/composition 事件。 */
export async function runTrustedTextContract({ evaluate, request }) {
  await evaluate(`(() => {
    const state = globalThis.editorContract.textResult;
    let editable = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    if (!editable) {
      state.mount.querySelector('[data-edit-id="' + state.id + '"]').dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
      editable = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    }
    const marker = [...editable.querySelectorAll('[data-r]')].at(-1);
    const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode(), last = node;
    while (node) { last = node; node = walker.nextNode(); }
    const range = document.createRange();
    range.setStart(last || marker, last ? last.textContent.length : marker.childNodes.length);
    range.collapse(true);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    editable.focus({ preventScroll: true });
    state.events = [];
    state.trustedTextSamples = [];
    state.trustedTextStarted = 0;
    state.mount.addEventListener('beforeinput', (event) => {
      if (event.isTrusted && event.inputType === 'insertText') state.trustedTextStarted = performance.now();
    }, true);
    state.mount.addEventListener('beforeinput', (event) => {
      if (event.isTrusted && event.inputType === 'insertText' && state.trustedTextStarted) {
        state.trustedTextSamples.push(performance.now() - state.trustedTextStarted);
        state.trustedTextStarted = 0;
      }
    });
    for (const type of ['beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend']) {
      state.mount.addEventListener(type, (event) => state.events.push({
        type, trusted: event.isTrusted, composing: event.isComposing, data: event.data,
      }), true);
    }
    state.beforeText = state.session.editor.effectiveElement(state.id).text.paragraphs
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('');
  })()`);
  for (let index = 0; index < 80; index++) await request('Input.insertText', { text: '真' });
  await request('Input.imeSetComposition', {
    text: '中', selectionStart: 1, selectionEnd: 1,
  });
  const stable = await evaluate(`(() => {
    const state = globalThis.editorContract.textResult;
    const current = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    state.compositionNode = current;
    return !!current && state.session.editor.history.undoCount > 0;
  })()`);
  await request('Input.imeSetComposition', {
    text: '中文', selectionStart: 2, selectionEnd: 2,
  });
  await evaluate(`(() => {
    const state = globalThis.editorContract.textResult;
    state.stableDuringComposition = state.mount.querySelector(
      '[data-ppt-text-editor="' + state.id + '"]') === state.compositionNode;
  })()`);
  await request('Input.insertText', { text: '中文' });
  const result = await evaluate(`(() => {
    const state = globalThis.editorContract.textResult;
    const current = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    const text = state.session.editor.effectiveElement(state.id).text.paragraphs
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('');
    const trusted = state.events.filter((event) =>
      ['beforeinput', 'compositionstart', 'compositionupdate', 'compositionend'].includes(event.type));
    state.trustedTextSamples.sort((left, right) => left - right);
    const p95 = state.trustedTextSamples[Math.floor(state.trustedTextSamples.length * 0.95)];
    const result = {
      stable: state.stableDuringComposition,
      inserted: text.endsWith('真'.repeat(80) + '中文') && text !== state.beforeText,
      p95,
      trustedBeforeInput: trusted.some((event) => event.type === 'beforeinput' && event.trusted),
      // CDP 以 Input.insertText 提交 IME 时，Chrome 会把最后的 compositionend 标成 untrusted；
      // 开始、更新与组词 beforeinput 仍来自真实输入域，结束事件则单独验证确实到达。
      trustedComposition: trusted.some((event) => event.type === 'compositionstart' && event.trusted)
        && trusted.some((event) => event.type === 'compositionupdate' && event.trusted)
        && state.events.some((event) => event.type === 'compositionend'),
      events: state.events,
    };
    state.view.destroy(); state.session.dispose(); state.mount.remove();
    return result;
  })()`);
  const passed = stable && result.stable && result.inserted
    && result.trustedBeforeInput && result.trustedComposition
    && result.p95 <= 30;
  if (!passed) {
    throw new Error(`真实文字/IME 输入失败：${JSON.stringify({ stable, ...result })}`);
  }
  return result.p95;
}
