import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const p95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

const namedId = (session, name) => Object.values(session.editor.doc.elements)
  .find((record) => record.src.name === name)?.id;

const partition = (mount, id) => mount.querySelector(`[data-edit-root="${id}"]`);

function pointerClick(node) {
  const base = {
    bubbles: true, composed: true, cancelable: true, pointerType: 'mouse',
    isPrimary: true, pointerId: 71, button: 0, clientX: 1, clientY: 1,
  };
  node.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }));
  node.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
  return node.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
}

/** edit/view 路由、事件所有权、文字键盘入口与危险来源必须在真实 DOM 中一起验证。 */
export async function runEditorHyperlinkBrowserContract({ openEditor, load }) {
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  const defaultMount = document.createElement('div');
  editMount.className = viewMount.className = defaultMount.className = 'contract-offscreen';
  document.body.append(editMount, viewMount, defaultMount);
  const session = await openEditor(await load('sample-editor-hyperlinks.pptx'), {
    idPrefix: 'browser-hyperlink-',
  });
  const events = [];
  const eventPrototype = EventTarget.prototype;
  const originalAdd = eventPrototype.addEventListener;
  const originalRemove = eventPrototype.removeEventListener;
  eventPrototype.addEventListener = function add(type, handler, options) {
    if (this instanceof HTMLElement && this.hasAttribute('data-web-ppt-editor')) {
      events.push({ action: 'add', element: this, type });
    }
    return originalAdd.call(this, type, handler, options);
  };
  eventPrototype.removeEventListener = function remove(type, handler, options) {
    if (this instanceof HTMLElement && this.hasAttribute('data-web-ppt-editor')) {
      events.push({ action: 'remove', element: this, type });
    }
    return originalRemove.call(this, type, handler, options);
  };

  let routeP95;
  try {
    const followed = [];
    const onLinkFollow = (view) => (target, context) => {
      followed.push({ view, target, source: context.source });
      return target.kind === 'external';
    };
    const viewView = session.mount(viewMount, {
      mode: 'view', textMode: 'html', onLinkFollow: onLinkFollow('view'),
    });
    const editView = session.mount(editMount, {
      mode: 'edit', textMode: 'html', onLinkFollow: onLinkFollow('edit'),
    });
    const defaultView = session.mount(defaultMount, { mode: 'view', textMode: 'html' });
    const editEventTypes = new Set([
      'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture',
      'dblclick', 'keydown', 'keyup', 'blur', 'copy', 'cut', 'paste',
    ]);
    const added = (element) => events
      .filter((entry) => entry.action === 'add' && entry.element === element).map((entry) => entry.type);
    if (JSON.stringify(added(viewView.element)) !== JSON.stringify(['click', 'keydown'])
      || ![...editEventTypes].every((type) => added(editView.element).includes(type))) {
      throw new Error(`view 安装了编辑事件或 edit 事件不完整：${added(viewView.element)}/${added(editView.element)}`);
    }

    const externalId = namedId(session, 'link-shared-a');
    const internalId = namedId(session, 'link-picture');
    const relativeId = namedId(session, 'link-relative-next');
    const unsafeId = namedId(session, 'link-unsafe-source');
    const textId = namedId(session, 'link-text-runs');
    if ([externalId, internalId, relativeId, unsafeId, textId].some((id) => !id)) {
      throw new Error('超链接浏览器固件身份不完整');
    }

    const editExternal = editMount.querySelector(`[data-edit-id="${externalId}"]`);
    const callbacksBeforeEditClick = followed.length;
    const editAccepted = pointerClick(editExternal);
    const selected = session.editor.selection.kind === 'elements'
      && session.editor.selection.ids[0] === externalId;
    if (editAccepted || !selected || followed.length !== callbacksBeforeEditClick) {
      throw new Error(`edit 单击链接没有保持“只选择、不跟随”语义：${JSON.stringify({
        editAccepted, selected, followed: followed.length, callbacksBeforeEditClick,
        selection: session.editor.selection,
      })}`);
    }
    if (!editView.followLink()
      || followed.at(-1)?.source !== 'api' || followed.at(-1)?.target.kind !== 'external') {
      throw new Error('公开 followLink 没有跟随当前元素的稳定目标');
    }
    const keyboardAccepted = editView.element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    if (keyboardAccepted || followed.at(-1)?.source !== 'edit') {
      throw new Error('Ctrl/Cmd+Enter 没有通过公开跟随语义路由');
    }
    const originalOpen = window.open;
    const openedWindow = { opener: { unsafe: true } };
    let openArgs = null;
    window.open = (...args) => { openArgs = args; return openedWindow; };
    try {
      const safeOpened = defaultView.followLink({ kind: 'external', href: 'https://example.com/default' });
      const unsafeOpened = defaultView.followLink({ kind: 'external', href: 'javascript:alert(1)' });
      if (!safeOpened || unsafeOpened || openArgs?.[1] !== '_blank'
        || openArgs?.[2] !== 'noopener,noreferrer' || openedWindow.opener !== null) {
        throw new Error(`默认外链窗口缺少安全隔离：${JSON.stringify({ safeOpened, unsafeOpened, openArgs })}`);
      }
    } finally { window.open = originalOpen; }
    defaultView.destroy();

    const firstSlide = viewView.slideId;
    const routeSamples = [];
    const viewExternal = partition(viewMount, externalId);
    for (let index = 0; index < 32; index++) {
      const started = performance.now();
      viewExternal.dispatchEvent(new MouseEvent('click', {
        bubbles: true, composed: true, cancelable: true,
      }));
      routeSamples.push(performance.now() - started);
    }
    routeP95 = p95(routeSamples);
    if (followed.at(-1)?.source !== 'view') throw new Error('查看模式点击没有进入链接路由');
    recordPerformanceBudget('查看模式点击路由 p95', routeP95, 8);

    const internal = partition(viewMount, internalId);
    const internalAnchor = internal.closest('[data-slide]') ?? internal.querySelector('[data-slide]');
    if (!internalAnchor || internalAnchor.getAttribute('tabindex') !== '0'
      || internalAnchor.getAttribute('role') !== 'link') {
      throw new Error('内部链接没有提供原生 Tab 焦点语义');
    }
    const viewKeyboardAccepted = internalAnchor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
    }));
    const thirdSlide = session.editor.doc.slideOrder[2];
    if (viewKeyboardAccepted || viewView.slideId !== thirdSlide || editView.slideId !== firstSlide
      || followed.at(-1)?.source !== 'view') {
      throw new Error('内部链接 Enter 没有使用 view 本地稳定页状态');
    }
    viewView.setSlide(firstSlide);
    partition(viewMount, relativeId).dispatchEvent(new MouseEvent('click', {
      bubbles: true, composed: true, cancelable: true,
    }));
    if (viewView.slideId !== session.editor.doc.slideOrder[1]) {
      throw new Error('相对 next 动作没有在点击时解析当前页序');
    }

    viewView.setSlide(firstSlide);
    const unsafe = partition(viewMount, unsafeId);
    const unsafeText = partition(viewMount, textId)?.querySelector('[data-r="0.2"]')?.closest('a');
    if (unsafe.matches('a[href],[data-slide]') || unsafe.querySelector('a[href],[data-slide]')
      || unsafeText?.hasAttribute('href') || unsafeText?.hasAttribute('data-slide')) {
      throw new Error('危险 scheme 成为了可点击 DOM');
    }

    const textPartition = partition(editMount, textId);
    textPartition.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, composed: true, cancelable: true,
    }));
    const editable = editMount.querySelector(`[data-ppt-text-editor="${textId}"]`);
    const internalRun = editable?.querySelector('[data-r="0.1"]');
    if (!editable || !internalRun) throw new Error('文字链接未进入可编辑 DOM');
    const range = document.createRange();
    range.selectNodeContents(internalRun);
    const domSelection = getSelection();
    domSelection.removeAllRanges();
    domSelection.addRange(range);
    const textKeyboardAccepted = editable.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', metaKey: true, bubbles: true, cancelable: true,
    }));
    if (textKeyboardAccepted || editView.slideId !== thirdSlide
      || followed.at(-1)?.target.kind !== 'slide'
      || followed.at(-1)?.target.slideId !== thirdSlide) {
      throw new Error('文字选区 Cmd+Enter 没有跟随稳定内部页身份');
    }
    editView.setSlide(firstSlide);
    session.editor.select({
      kind: 'text', id: textId,
      anchor: { p: 0, r: 1, off: 0 }, focus: { p: 0, r: 1, off: 2 },
    });
    if (!editView.followLink() || editView.slideId !== thirdSlide) {
      throw new Error('无活动 contenteditable 的 headless 文字选区不能使用公开 followLink');
    }

    viewView.setMode('edit');
    viewView.setMode('view');
    const viewRemoved = events
      .filter((entry) => entry.action === 'remove' && entry.element === viewView.element)
      .map((entry) => entry.type);
    if (![...editEventTypes].every((type) => viewRemoved.includes(type))) {
      throw new Error('edit→view 没有释放全部编辑事件');
    }
    const viewElement = viewView.element;
    viewView.destroy();
    if (!events.some((entry) => entry.action === 'remove'
      && entry.element === viewElement && entry.type === 'click')
      || !events.some((entry) => entry.action === 'remove'
        && entry.element === viewElement && entry.type === 'keydown')) {
      throw new Error('destroy 后仍残留链接路由监听器');
    }
  } finally {
    eventPrototype.addEventListener = originalAdd;
    eventPrototype.removeEventListener = originalRemove;
    session.dispose();
    editMount.remove();
    viewMount.remove();
    defaultMount.remove();
  }

  const perfMount = document.createElement('div');
  perfMount.className = 'contract-offscreen';
  document.body.append(perfMount);
  const perfSession = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-hyperlink-perf-',
  });
  let commitP95;
  try {
    const perfView = perfSession.mount(perfMount, { mode: 'edit', textMode: 'svg', snapping: false });
    const ids = perfSession.editor.doc.slides[perfView.slideId].children
      .filter((id) => perfSession.editor.doc.elements[id].src.kind === 'shape'
        && perfSession.editor.doc.elements[id].meta.editable === 'full');
    if (ids.length !== 60) throw new Error(`链接性能固件元素数错误：${ids.length}`);
    const samples = [];
    for (let index = 0; index < 24; index++) {
      const started = performance.now();
      perfSession.editor.transaction((transaction) => {
        for (const id of ids) transaction.exec({
          type: 'SetLink', id,
          target: { kind: 'external', href: `https://example.com/perf-${index % 2}` },
        });
      }, '批量设置链接');
      perfMount.querySelector('[data-ppt-layer="static"] svg')?.getBoundingClientRect();
      samples.push(performance.now() - started);
      perfSession.editor.undo();
    }
    commitP95 = p95(samples);
    recordPerformanceBudget('60 元素链接提交 p95', commitP95, 16);
  } finally {
    perfSession.dispose();
    perfMount.remove();
  }
  return { commitP95, routeP95 };
}
