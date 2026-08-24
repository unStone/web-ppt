/** 系统剪贴板与可信快捷键必须贯通文字模型，纯文本快捷键不得读入 HTML 格式。 */
export async function runTrustedRichTextClipboardContract({ evaluate, dispatchKey }) {
  const modifier = await evaluate("navigator.platform.includes('Mac') ? 4 : 2");
  const shift = 8;
  await evaluate(`(() => {
    const state = globalThis.editorContract.richTextResult;
    let editable = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    if (!editable) {
      state.mount.querySelector('[data-edit-id="' + state.id + '"]').dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
      editable = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    }
    const marker = editable.querySelector('[data-r]');
    const range = document.createRange();
    range.setStart(marker.firstChild, 0); range.setEnd(marker.firstChild, 1);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    editable.focus({ preventScroll: true });
    state.events = [];
    for (const type of ['copy', 'cut', 'paste']) state.mount.addEventListener(type, (event) => {
      state.events.push({ type, trusted: event.isTrusted, prevented: event.defaultPrevented });
    });
  })()`);
  await evaluate(`navigator.clipboard.write([new ClipboardItem({
    'text/plain': new Blob(['可信带格式'], { type: 'text/plain' }),
    'text/html': new Blob(['<b style="font-family:Arial;font-size:20px">可信</b><i>带格式</i>'],
      { type: 'text/html' }),
  })])`, true);
  await dispatchKey('v', 'KeyV', 86, modifier, ['paste']);
  const rich = await evaluate(`(() => {
    const state = globalThis.editorContract.richTextResult;
    const runs = state.session.editor.effectiveElement(state.id).text.paragraphs[0].runs;
    return {
      text: runs.map((run) => run.text).join(''),
      bold: runs.some((run) => run.text === '可信' && run.b && run.fonts[0] === 'Arial' && run.size === 20),
      italic: runs.some((run) => run.text === '带格式' && run.i),
      undo: state.session.editor.history.undoCount,
    };
  })()`);
  await evaluate(`(() => {
    const state = globalThis.editorContract.richTextResult;
    state.session.editor.undo();
    const editable = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    const marker = editable.querySelector('[data-r]');
    const range = document.createRange(); range.setStart(marker.firstChild, 0); range.setEnd(marker.firstChild, 1);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    editable.focus({ preventScroll: true });
  })()`);
  await dispatchKey('v', 'KeyV', 86, modifier | shift, ['paste']);
  const plain = await evaluate(`(() => {
    const state = globalThis.editorContract.richTextResult;
    const runs = state.session.editor.effectiveElement(state.id).text.paragraphs[0].runs;
    const inserted = runs.find((run) => run.text.startsWith('可信带格式'));
    const editable = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    const marker = [...editable.querySelectorAll('[data-r]')]
      .find((candidate) => candidate.textContent.startsWith('可信带格式'));
    const range = document.createRange(); range.setStart(marker.firstChild, 0); range.setEnd(marker.firstChild, 5);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    editable.focus({ preventScroll: true });
    return { normal: !!inserted && !inserted.b && !inserted.i, undo: state.session.editor.history.undoCount };
  })()`);
  await dispatchKey('c', 'KeyC', 67, modifier, ['copy']);
  const copied = await evaluate('navigator.clipboard.readText()', true);
  await dispatchKey('x', 'KeyX', 88, modifier, ['cut']);
  const result = await evaluate(`(async () => {
    const state = globalThis.editorContract.richTextResult;
    const text = state.session.editor.effectiveElement(state.id).text.paragraphs[0].runs
      .map((run) => run.text).join('');
    const clipboard = await navigator.clipboard.readText();
    const result = {
      events: state.events, text, clipboard,
      undo: state.session.editor.history.undoCount,
      active: !!state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]'),
    };
    state.session.editor.undo(); state.session.editor.undo();
    state.view.destroy(); state.session.dispose(); state.mount.remove();
    return result;
  })()`, true);
  const eventsCorrect = result.events.length === 4
    && result.events.map((event) => event.type).join('/') === 'paste/paste/copy/cut'
    && result.events.every((event) => event.trusted && event.prevented);
  if (!eventsCorrect || rich.text !== '可信带格式同同' || !rich.bold || !rich.italic || rich.undo !== 1
    || !plain.normal || plain.undo !== 1 || copied !== '可信带格式'
    || result.clipboard !== '可信带格式' || result.text !== '同同'
    || result.undo !== 2 || !result.active) {
    throw new Error(`真实文字剪贴板失败：${JSON.stringify({ rich, plain, copied, result })}`);
  }
}
