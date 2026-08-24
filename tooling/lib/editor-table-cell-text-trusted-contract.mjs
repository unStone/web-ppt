/** CDP 真实键盘与输入法必须留在单元格编辑面并提交到导航后的目标格。 */
export async function runTrustedTableCellTextContract({ evaluate, request }) {
  await evaluate(`(() => {
    const state = globalThis.editorContract.tableCellTextResult;
    let editable = state.mount.querySelector('[data-ppt-text-editor]');
    if (!editable) {
      state.mount.querySelector('[data-table-cell="5:10"]').dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true, composed: true, cancelable: true,
      }));
      editable = state.mount.querySelector('[data-ppt-text-editor]');
    }
    state.events = [];
    state.mount.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') state.tabEvent = event;
      state.events.push({ type: 'keydown', key: event.key, trusted: event.isTrusted });
    }, true);
    for (const type of ['beforeinput', 'compositionstart', 'compositionupdate', 'compositionend']) {
      state.mount.addEventListener(type, (event) => state.events.push({
        type, trusted: event.isTrusted, data: event.data,
      }), true);
    }
    editable.focus({ preventScroll: true });
  })()`);
  await request('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9,
  });
  await request('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9,
  });
  await request('Input.insertText', { text: '真' });
  await request('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
  const stable = await evaluate(`(() => {
    const state = globalThis.editorContract.tableCellTextResult;
    state.compositionNode = state.mount.querySelector('[data-ppt-text-editor]');
    return state.compositionNode?.dataset.pptTextCell === '5:11';
  })()`);
  await request('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
  const stableUpdate = await evaluate(`globalThis.editorContract.tableCellTextResult.mount
    .querySelector('[data-ppt-text-editor]') === globalThis.editorContract.tableCellTextResult.compositionNode`);
  await request('Input.insertText', { text: '中文' });
  const result = await evaluate(`(() => {
    const state = globalThis.editorContract.tableCellTextResult;
    const table = state.session.editor.effectiveElement(state.id);
    const text = table.rows[5].cells[11].text.paragraphs
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('');
    const tab = state.tabEvent;
    const trustedInput = state.events.some((event) => event.type === 'beforeinput' && event.trusted);
    const composition = state.events.some((event) => event.type === 'compositionstart' && event.trusted)
      && state.events.some((event) => event.type === 'compositionupdate' && event.trusted)
      && state.events.some((event) => event.type === 'compositionend');
    const output = {
      tab: !!tab && tab.isTrusted && tab.defaultPrevented,
      inserted: text.endsWith('真中文'), trustedInput, composition, events: state.events,
    };
    return output;
  })()`);
  if (!stable || !stableUpdate || !result.tab || !result.inserted
    || !result.trustedInput || !result.composition) {
    throw new Error(`真实单元格 Tab/IME 失败：${JSON.stringify({ stable, stableUpdate, ...result })}`);
  }
  await evaluate(`(() => {
    const state = globalThis.editorContract.tableCellTextResult;
    state.mount.querySelector('[data-ppt-text-editor]').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, composed: true, cancelable: true,
    }));
    state.mount.querySelector('[data-table-cell="9:19"]').dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, composed: true, cancelable: true,
    }));
    state.tabEvent = null;
    state.mount.querySelector('[data-ppt-text-editor]').focus({ preventScroll: true });
  })()`);
  await request('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9,
  });
  await request('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9,
  });
  const appended = await evaluate(`(() => {
    const state = globalThis.editorContract.tableCellTextResult;
    const table = state.session.editor.effectiveElement(state.id);
    const tab = state.tabEvent;
    const output = table.rows.length === 11
      && state.mount.querySelector('[data-ppt-text-editor]')?.dataset.pptTextCell === '10:0'
      && !!tab && tab.isTrusted && tab.defaultPrevented;
    state.view.destroy(); state.session.dispose(); state.mount.remove();
    return output;
  })()`);
  if (!appended) throw new Error('真实末格 Tab 没有追加新行并保持焦点所有权');
}
