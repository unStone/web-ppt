const MIME = 'application/x-web-ppt-elements+json';

const clipboardEvent = (type, data) => {
  const event = new ClipboardEvent(type, { bubbles: true, composed: true, cancelable: true });
  // Chromium 不接受构造参数里的 synthetic clipboardData；契约仍使用真实 DataTransfer 行为。
  Object.defineProperty(event, 'clipboardData', { value: data });
  return event;
};

export async function runEditorClipboardBrowserContract({ openEditor, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const session = await openEditor(await load('sample-editor-layer.pptx'), {
    idPrefix: 'browser-clipboard-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const roots = session.editor.doc.slides[view.slideId].children;
    const selected = roots.filter((id) => session.editor.doc.elements[id].meta.editable === 'full').slice(0, 2);
    session.editor.select({ kind: 'elements', ids: selected, enteredGroup: null });
    const originalNodes = new Map(selected.map((id) => [id, mount.querySelector(`[data-edit-id="${id}"]`)]));
    const copyData = new DataTransfer();
    let reportedError = null;
    const previousReporter = globalThis.reportError;
    globalThis.reportError = (error) => { reportedError = error; };
    const copyAccepted = view.element.dispatchEvent(clipboardEvent('copy', copyData));
    globalThis.reportError = previousReporter;
    if (reportedError) throw reportedError;
    const custom = copyData.getData(MIME);
    if (!custom) throw new Error(`ClipboardEvent copy 未写入载荷：accepted=${copyAccepted}, types=${[...copyData.types]}`);
    const payload = JSON.parse(custom);
    if (copyAccepted || copyData.getData('text/plain') !== copyData.getData(MIME)
      || payload.format !== 'web-ppt-elements' || payload.roots.length !== 2) {
      throw new Error('ClipboardEvent copy 未双写版本化载荷');
    }

    const historyBefore = session.editor.history.undoCount;
    const pasteStarted = performance.now();
    const pasteAccepted = view.element.dispatchEvent(clipboardEvent('paste', copyData));
    mount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
    const pasteTime = performance.now() - pasteStarted;
    const pastedSelection = session.editor.selection;
    const pasted = pastedSelection.kind === 'elements' ? [...pastedSelection.ids] : [];
    if (pasteAccepted || pasted.length !== 2 || session.editor.history.undoCount !== historyBefore + 1
      || pasted.some((id) => !mount.querySelector(`[data-edit-id="${id}"]`))
      || [...originalNodes].some(([id, node]) => mount.querySelector(`[data-edit-id="${id}"]`) !== node)) {
      throw new Error('ClipboardEvent paste 未形成单历史或破坏未触碰 DOM 身份');
    }
    session.editor.undo();

    session.editor.select({ kind: 'elements', ids: selected, enteredGroup: null });
    const cutData = new DataTransfer();
    const cutHistory = session.editor.history.undoCount;
    const cutAccepted = view.element.dispatchEvent(clipboardEvent('cut', cutData));
    if (cutAccepted || !cutData.getData(MIME)
      || selected.some((id) => session.editor.doc.elements[id])
      || session.editor.history.undoCount !== cutHistory + 1) {
      throw new Error('ClipboardEvent cut 未在成功写载荷后原子删除');
    }
    session.editor.undo();

    session.editor.select({ kind: 'elements', ids: selected, enteredGroup: null });
    const duplicateHistory = session.editor.history.undoCount;
    const duplicateAccepted = view.element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'd', code: 'KeyD', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    const duplicated = session.editor.selection.kind === 'elements' ? session.editor.selection.ids : [];
    if (duplicateAccepted || duplicated.length !== 2
      || session.editor.history.undoCount !== duplicateHistory + 1) {
      throw new Error('Ctrl/Cmd+D 未形成不触碰系统剪贴板的单历史再制');
    }
    session.editor.undo();

    const textId = roots.find((id) => session.editor.doc.elements[id].src.kind === 'shape'
      && session.editor.doc.elements[id].src.text);
    const countBeforeTextPaste = Object.keys(session.editor.doc.elements).length;
    session.editor.select({
      kind: 'text', id: textId,
      anchor: { p: 0, r: 0, off: 0 }, focus: { p: 0, r: 0, off: 0 },
    });
    const textPasteYielded = view.element.dispatchEvent(clipboardEvent('paste', copyData));
    if (!textPasteYielded || Object.keys(session.editor.doc.elements).length !== countBeforeTextPaste) {
      throw new Error('文本选区错误夺取元素粘贴所有权');
    }

    const input = document.createElement('input');
    view.element.append(input);
    const yieldedData = new DataTransfer();
    const yielded = input.dispatchEvent(clipboardEvent('copy', yieldedData));
    input.remove();
    view.setMode('view');
    const viewData = new DataTransfer();
    const viewYielded = view.element.dispatchEvent(clipboardEvent('copy', viewData));
    if (!yielded || yieldedData.types.length || !viewYielded || viewData.types.length) {
      throw new Error('表单后代或 view 模式错误夺取剪贴板所有权');
    }

    const performanceMount = document.createElement('div');
    performanceMount.className = 'contract-offscreen';
    document.body.append(performanceMount);
    const performanceSession = await openEditor(await load('sample-editor-60.pptx'), {
      idPrefix: 'browser-clipboard-perf-',
    });
    let pasteP95;
    try {
      const performanceView = performanceSession.mount(performanceMount, {
        mode: 'edit', textMode: 'svg', snapping: false,
      });
      const performanceRoots = performanceSession.editor.doc.slides[performanceView.slideId].children
        .filter((id) => performanceSession.editor.doc.elements[id].meta.editable === 'full');
      const sourceElementCount = Object.keys(performanceSession.editor.doc.elements).length;
      if (performanceRoots.length !== 60) throw new Error(`性能固件可复制元素数错误：${performanceRoots.length}`);
      const payloadSizes = [10, 20, 40].map((count) => {
        performanceSession.editor.select({
          kind: 'elements', ids: performanceRoots.slice(0, count), enteredGroup: null,
        });
        const data = new DataTransfer();
        performanceView.element.dispatchEvent(clipboardEvent('copy', data));
        return data.getData(MIME).length;
      });
      if (payloadSizes[1] > payloadSizes[0] * 2.5 || payloadSizes[2] > payloadSizes[1] * 2.5) {
        throw new Error(`剪贴板载荷超线性增长：${payloadSizes.join('/')}`);
      }
      performanceSession.editor.select({ kind: 'elements', ids: performanceRoots, enteredGroup: null });
      const data = new DataTransfer();
      performanceView.element.dispatchEvent(clipboardEvent('copy', data));
      const samples = [];
      for (let index = 0; index < 24; index++) {
        const started = performance.now();
        performanceView.element.dispatchEvent(clipboardEvent('paste', data));
        performanceMount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
        samples.push(performance.now() - started);
        performanceSession.editor.undo();
      }
      samples.sort((left, right) => left - right);
      pasteP95 = samples[Math.floor(samples.length * 0.95)];
      if (pasteP95 > 16 || Object.keys(performanceSession.editor.doc.elements).length !== sourceElementCount) {
        throw new Error(`60 元素剪贴板粘贴 p95 ${pasteP95.toFixed(3)}ms`);
      }
    } finally {
      performanceSession.dispose();
      performanceMount.remove();
    }
    return { pasteTime, pasteP95 };
  } finally {
    session.dispose();
    mount.remove();
  }
}
