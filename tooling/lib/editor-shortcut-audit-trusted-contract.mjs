/** 附录 B 新增键位必须来自 DevTools 真实输入域，不能只靠合成 KeyboardEvent。 */
export async function runTrustedShortcutAuditContract({ evaluate, dispatchKey, request }) {
  const primary = await evaluate("navigator.platform.includes('Mac') ? 4 : 2");
  await evaluate(`(() => {
    const { perfSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    perfSession.editor.history.clear();
    perfSession.editor.markSaved();
    const view = perfSession.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const firstSlide = view.slideId;
    const events = [];
    view.element.addEventListener('keydown', (event) => events.push({
      key: event.key, code: event.code, trusted: event.isTrusted, prevented: event.defaultPrevented,
    }));
    view.element.focus({ preventScroll: true });
    globalThis.trustedShortcutAudit = {
      view, firstSlide, events, pageCount: perfSession.editor.doc.slideOrder.length,
    };
  })()`);
  await dispatchKey('a', 'KeyA', 65, primary);
  const selectedAll = await evaluate(`(() => {
    const { perfSession } = globalThis.editorContract;
    const state = globalThis.trustedShortcutAudit;
    const selection = perfSession.editor.selection;
    return selection.kind === 'elements' && selection.enteredGroup === null
      && selection.ids.length === perfSession.editor.doc.slides[state.firstSlide].children
        .filter((id) => {
          const record = perfSession.editor.doc.elements[id];
          return !record.meta.locked && !record.meta.hiddenByUser && record.meta.editable !== 'none';
        }).length;
  })()`);
  await dispatchKey('m', 'KeyM', 77, primary);
  const added = await evaluate(`(() => {
    const { perfSession } = globalThis.editorContract;
    const state = globalThis.trustedShortcutAudit;
    state.addedSlide = state.view.slideId;
    return perfSession.editor.doc.slideOrder.length === state.pageCount + 1
      && state.addedSlide !== state.firstSlide && perfSession.editor.history.undoCount === 1;
  })()`);
  await dispatchKey('PageUp', 'PageUp', 33);
  const movedUp = await evaluate('globalThis.trustedShortcutAudit.view.slideId === globalThis.trustedShortcutAudit.firstSlide');
  await dispatchKey('PageDown', 'PageDown', 34);
  const pageResult = await evaluate(`(() => {
    const { perfSession } = globalThis.editorContract;
    const state = globalThis.trustedShortcutAudit;
    const result = {
      selectedAll: ${selectedAll}, added: ${added}, movedUp: ${movedUp},
      movedDown: state.view.slideId === state.addedSlide,
      focused: document.activeElement === state.view.element,
      events: state.events,
    };
    state.view.setSlide(state.firstSlide);
    perfSession.editor.undo();
    perfSession.editor.history.clear();
    perfSession.editor.markSaved();
    state.view.destroy();
    delete globalThis.trustedShortcutAudit;
    return result;
  })()`);
  const pageEvents = pageResult.events.length === 4
    && pageResult.events.map((event) => event.code).join(',') === 'KeyA,KeyM,PageUp,PageDown'
    && pageResult.events.every((event) => event.trusted && event.prevented);

  await evaluate(`(async () => {
    const { openEditor, load } = globalThis.editorContract;
    const session = await openEditor(await load('sample-editor-text.pptx'), {
      idPrefix: 'trusted-shortcut-text-',
    });
    const mount = document.createElement('div'); document.body.append(mount);
    const view = session.mount(mount, { mode: 'edit' });
    const record = Object.values(session.editor.doc.elements)
      .find((candidate) => candidate.src.name === '重复格式');
    globalThis.trustedShortcutText = { session, mount, view, id: record.id };
  })()`, true);
  await evaluate(`(() => {
    const state = globalThis.trustedShortcutText;
    state.shortcutSourceSlide = state.view.slideId;
    state.shortcutDuplicateSlide = [...state.session.editor.exec({
      type: 'DuplicateSlide', id: state.shortcutSourceSlide,
    }).createdSlides][0];
    state.session.editor.history.clear();
    state.session.editor.markSaved();
    let editable = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    if (!editable) {
      state.mount.querySelector('[data-edit-id="' + state.id + '"]').dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
      editable = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    }
    const marker = [...editable.querySelectorAll('[data-r]')]
      .find((candidate) => candidate.textContent.length > 0);
    const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    const range = document.createRange();
    range.setStart(node || marker, 0);
    range.setEnd(node || marker, node ? Math.min(1, node.textContent.length) : marker.childNodes.length);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    editable.focus({ preventScroll: true });
    state.shortcutAudit = {
      history: state.session.editor.history.undoCount,
      size: state.view.queryRunProps().size.value,
      events: [],
    };
    state.bindShortcutAudit = () => {
      const current = state.mount.querySelector('[data-ppt-text-editor]');
      if (current.dataset.shortcutAuditBound) return;
      current.dataset.shortcutAuditBound = 'true';
      current.addEventListener('keydown', (event) => state.shortcutAudit.events.push({
        key: event.key, code: event.code, trusted: event.isTrusted, prevented: event.defaultPrevented,
      }));
    };
  })()`);
  const textKey = async (key, code, virtualKeyCode, modifiers = primary) => {
    await evaluate('globalThis.trustedShortcutText.bindShortcutAudit()');
    await dispatchKey(key, code, virtualKeyCode, modifiers);
  };
  await textKey('PageDown', 'PageDown', 34, 0);
  const textPageDown = await evaluate(`(() => {
    const state = globalThis.trustedShortcutText;
    const record = state.session.editor.doc.slides[state.shortcutDuplicateSlide].children
      .map((id) => state.session.editor.doc.elements[id])
      .find((candidate) => candidate.src.name === state.session.editor.doc.elements[state.id].src.name);
    state.shortcutDuplicateText = record.id;
    state.mount.querySelector('[data-edit-id="' + record.id + '"]').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
    state.mount.querySelector('[data-ppt-text-editor="' + record.id + '"]').focus({ preventScroll: true });
    return state.view.slideId === state.shortcutDuplicateSlide;
  })()`);
  await textKey('PageUp', 'PageUp', 33, 0);
  const textPageUp = await evaluate(`(() => {
    const state = globalThis.trustedShortcutText;
    const moved = state.view.slideId === state.shortcutSourceSlide;
    state.mount.querySelector('[data-edit-id="' + state.id + '"]').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
    const editable = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    const marker = [...editable.querySelectorAll('[data-r]')]
      .find((candidate) => candidate.textContent.length > 0);
    const node = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange(); range.setStart(node || marker, 0);
    range.setEnd(node || marker, node ? Math.min(1, node.textContent.length) : marker.childNodes.length);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    editable.focus({ preventScroll: true });
    return moved;
  })()`);
  await textKey('>', 'Period', 190, primary | 8);
  const grew = await evaluate(`(() => {
    const state = globalThis.trustedShortcutText;
    return state.view.queryRunProps().size.value > state.shortcutAudit.size;
  })()`);
  await textKey('<', 'Comma', 188, primary | 8);
  const restored = await evaluate(`(() => {
    const state = globalThis.trustedShortcutText;
    return Math.abs(state.view.queryRunProps().size.value - state.shortcutAudit.size) < 1e-6;
  })()`);
  const alignments = [['e', 'KeyE', 69, 'center'], ['l', 'KeyL', 76, 'left'],
    ['r', 'KeyR', 82, 'right'], ['j', 'KeyJ', 74, 'justify']];
  const aligned = [];
  for (const [key, code, virtualKeyCode, expected] of alignments) {
    await textKey(key, code, virtualKeyCode);
    aligned.push(await evaluate(`globalThis.trustedShortcutText.session.editor.effectiveElement(
      globalThis.trustedShortcutText.id).text.paragraphs[0].align === '${expected}'`));
  }
  await textKey('m', 'KeyM', 77);
  const textAdd = await evaluate(`(() => {
    const state = globalThis.trustedShortcutText;
    state.shortcutAddedSlide = state.view.slideId;
    const added = state.shortcutAddedSlide !== state.shortcutSourceSlide
      && state.shortcutAddedSlide !== state.shortcutDuplicateSlide
      && !state.mount.querySelector('[data-ppt-text-editor]');
    state.view.element.focus({ preventScroll: true });
    return added;
  })()`);
  await dispatchKey('z', 'KeyZ', 90, primary);
  const textAddUndo = await evaluate(`(() => {
    const state = globalThis.trustedShortcutText;
    const result = state.view.slideId === state.shortcutSourceSlide
      && !state.session.editor.doc.slides[state.shortcutAddedSlide];
    state.view.element.focus({ preventScroll: true });
    return result;
  })()`);
  await dispatchKey('y', 'KeyY', 89, primary);
  const textAddRedo = await evaluate(`(() => {
    const state = globalThis.trustedShortcutText;
    const result = state.view.slideId === state.shortcutAddedSlide
      && !!state.session.editor.doc.slides[state.shortcutAddedSlide];
    state.view.element.focus({ preventScroll: true });
    return result;
  })()`);
  await dispatchKey('z', 'KeyZ', 90, primary);
  await evaluate(`(() => {
    const state = globalThis.trustedShortcutText;
    state.mount.querySelector('[data-edit-id="' + state.id + '"]').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
    const editable = state.mount.querySelector('[data-ppt-text-editor="' + state.id + '"]');
    const marker = [...editable.querySelectorAll('[data-r]')]
      .find((candidate) => candidate.textContent.length > 0);
    const node = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange(); range.setStart(node || marker, 0); range.collapse(true);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    editable.focus({ preventScroll: true });
  })()`);
  await textKey('a', 'KeyA', 65);
  const selectedText = await evaluate(`(() => {
    const state = globalThis.trustedShortcutText;
    const text = state.session.editor.effectiveElement(state.id).text;
    const selection = state.session.editor.selection;
    const index = (position) => {
      let result = 0;
      for (let p = 0; p < position.p; p++) {
        result += text.paragraphs[p].runs.reduce((sum, run) => sum + run.text.length, 0) + 1;
      }
      for (let r = 0; r < position.r; r++) result += text.paragraphs[position.p].runs[r].text.length;
      return result + position.off;
    };
    const length = text.paragraphs.reduce((sum, paragraph, p) => sum
      + paragraph.runs.reduce((total, run) => total + run.text.length, 0)
      + (p ? 1 : 0), 0);
    return selection.kind === 'text' && index(selection.anchor) === 0 && index(selection.focus) === length;
  })()`);
  await textKey('a', 'KeyA', 65);
  const textResult = await evaluate(`(() => {
    const state = globalThis.trustedShortcutText;
    const selection = state.session.editor.selection;
    const result = {
      textPageDown: ${textPageDown}, textPageUp: ${textPageUp}, textAdd: ${textAdd},
      textAddUndo: ${textAddUndo}, textAddRedo: ${textAddRedo},
      grew: ${grew}, restored: ${restored}, aligned: ${JSON.stringify(aligned)}, selectedText: ${selectedText},
      selectedPage: selection.kind === 'elements' && selection.enteredGroup === null
        && selection.ids.length > 0 && selection.ids.every(
          (id) => state.session.editor.doc.elements[id].parent === state.view.slideId),
      closedText: !state.mount.querySelector('[data-ppt-text-editor]'),
      events: state.shortcutAudit.events,
    };
    while (state.session.editor.history.undoCount > state.shortcutAudit.history) {
      state.session.editor.undo();
    }
    state.session.editor.exec({ type: 'RemoveSlide', id: state.shortcutDuplicateSlide });
    state.session.editor.history.clear();
    state.session.editor.markSaved();
    delete state.shortcutAudit;
    delete state.bindShortcutAudit;
    delete state.shortcutSourceSlide;
    delete state.shortcutDuplicateSlide;
    delete state.shortcutDuplicateText;
    delete state.shortcutAddedSlide;
    state.view.destroy(); state.session.dispose(); state.mount.remove();
    delete globalThis.trustedShortcutText;
    return result;
  })()`);
  const expectedTextCodes = [
    'PageDown', 'PageUp', 'Period', 'Comma', 'KeyE', 'KeyL', 'KeyR', 'KeyJ', 'KeyM', 'KeyA', 'KeyA',
  ];
  const auditedTextEvents = textResult.events.filter((event) => expectedTextCodes.includes(event.code));
  const textEvents = auditedTextEvents.length === expectedTextCodes.length
    && auditedTextEvents.map((event) => event.code).join(',')
      === 'PageDown,PageUp,Period,Comma,KeyE,KeyL,KeyR,KeyJ,KeyM,KeyA,KeyA'
    && auditedTextEvents.every((event) => event.trusted && event.prevented);
  await evaluate(`(async () => {
    const { openEditor, load } = globalThis.editorContract;
    const session = await openEditor(await load('sample-editor-text.pptx'), {
      idPrefix: 'trusted-shortcut-ime-',
    });
    const sourceSlide = session.editor.doc.slideOrder[0];
    session.editor.exec({ type: 'DuplicateSlide', id: sourceSlide });
    session.editor.history.clear(); session.editor.markSaved();
    const mount = document.createElement('div'); document.body.append(mount);
    const view = session.mount(mount, { mode: 'edit' });
    const record = Object.values(session.editor.doc.elements)
      .find((candidate) => candidate.parent === sourceSlide && candidate.src.name === '重复格式');
    mount.querySelector('[data-edit-id="' + record.id + '"]').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
    const editable = mount.querySelector('[data-ppt-text-editor="' + record.id + '"]');
    const marker = editable.querySelector('[data-r="0.0"]');
    const node = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange(); range.setStart(node || marker, 0); range.collapse(true);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    editable.focus({ preventScroll: true });
    globalThis.trustedShortcutIme = {
      session, mount, view, record, editable, sourceSlide,
      pages: session.editor.doc.slideOrder.length, history: session.editor.history.undoCount,
      model: session.editor.effectiveElement(record.id).text.paragraphs
        .flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join(''),
    };
  })()`, true);
  await request('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
  await dispatchKey('PageDown', 'PageDown', 34, 0);
  await dispatchKey('m', 'KeyM', 77, primary);
  const imeBlocked = await evaluate(`(() => {
    const state = globalThis.trustedShortcutIme;
    const current = state.mount.querySelector('[data-ppt-text-editor]');
    const model = state.session.editor.effectiveElement(state.record.id).text.paragraphs
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('');
    return current === state.editable && current.textContent.includes('中')
      && state.view.slideId === state.sourceSlide
      && state.session.editor.doc.slideOrder.length === state.pages
      && state.session.editor.history.undoCount === state.history && model === state.model;
  })()`);
  await request('Input.insertText', { text: '中' });
  const imeCommitted = await evaluate(`(() => {
    const state = globalThis.trustedShortcutIme;
    const model = state.session.editor.effectiveElement(state.record.id).text.paragraphs
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('');
    const result = model !== state.model && !!state.mount.querySelector('[data-ppt-text-editor]');
    state.view.destroy(); state.session.dispose(); state.mount.remove();
    delete globalThis.trustedShortcutIme;
    return result;
  })()`);
  if (!Object.entries(pageResult).filter(([key]) => key !== 'events').every(([, value]) => value)
    || !pageEvents || !textResult.textPageDown || !textResult.textPageUp || !textResult.textAdd
    || !textResult.textAddUndo || !textResult.textAddRedo
    || !imeBlocked || !imeCommitted
    || !textResult.grew || !textResult.restored || !textResult.aligned.every(Boolean)
    || !textResult.selectedText || !textResult.selectedPage || !textResult.closedText || !textEvents) {
    throw new Error(`真实附录 B 快捷键失败：${JSON.stringify({ pageResult, pageEvents, textResult, textEvents, imeBlocked, imeCommitted })}`);
  }
}
