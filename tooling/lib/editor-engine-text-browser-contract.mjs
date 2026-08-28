import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const textOf = (element) => element.text.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');

function selectFirstCharacter(root) {
  const marker = [...root.querySelectorAll('[data-r][data-from]')]
    .find((candidate) => Number(candidate.dataset.to) > Number(candidate.dataset.from));
  const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
  const text = walker.nextNode();
  if (!text?.textContent.length) throw new Error('engine 固件缺少可选文字');
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 1);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  root.focus({ preventScroll: true });
}

function linePositionError(root) {
  const box = root.getBoundingClientRect();
  let error = 0;
  for (const line of root.querySelectorAll('[data-engine-line]')) {
    const lineBox = line.getBoundingClientRect();
    error = Math.max(error,
      Math.abs(lineBox.left - box.left - Number(line.dataset.x)),
      Math.abs(lineBox.top - box.top - Number(line.dataset.y)));
  }
  return error;
}

/** 独立浏览上下文避免污染主页面的能力探测缓存。 */
export async function runEditorEngineAutoProbeBrowserContract() {
  const token = `engine-auto-${Date.now()}`;
  const frame = document.createElement('iframe');
  frame.className = 'contract-offscreen';
  frame.title = 'engine auto probe contract';
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('engine auto 探测契约超时')), 5000);
    const receive = (event) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token) return;
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      if (event.data.ok) resolve(true);
      else reject(new Error(event.data.error ?? 'engine auto 探测契约失败'));
    };
    window.addEventListener('message', receive);
  });
  frame.srcdoc = `<!doctype html><body><div id="mount"></div><script type="module">
    import { openEditor } from '/out/editor/editor.mjs';
    const token = ${JSON.stringify(token)};
    try {
      const original = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        if (this.namespaceURI === 'http://www.w3.org/1999/xhtml'
          && this.parentElement?.localName === 'foreignObject') return new DOMRect(0, 0, 100, 100);
        return original.call(this);
      };
      const response = await fetch('/fixtures/sample-editor-engine-text.pptx');
      const session = await openEditor(await response.arrayBuffer(), { idPrefix: 'auto-probe-' });
      const mount = document.querySelector('#mount');
      const view = session.mount(mount, { mode: 'edit', textMode: 'auto' });
      Element.prototype.getBoundingClientRect = original;
      const record = Object.values(session.editor.doc.elements)
        .find((candidate) => candidate.src.name === 'Engine 跨行基准');
      mount.querySelector('[data-edit-id="' + record.id + '"]').dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
      const ok = !mount.querySelector('[data-ppt-layer="static"] foreignObject')
        && !!mount.querySelector('[data-ppt-layer="static"] text')
        && !!mount.querySelector('[data-layout="engine"]');
      view.destroy(); session.dispose();
      parent.postMessage({ token, ok, error: ok ? '' : 'auto 降级没有同时驱动预览与编辑行盒' }, '*');
    } catch (error) {
      parent.postMessage({ token, ok: false, error: error?.stack || String(error) }, '*');
    }
  <\/script>`;
  document.body.append(frame);
  try { return await result; } finally { frame.remove(); }
}

/** Safari 安全编辑面在真实 Chrome 中也必须以 engine 行盒完整上屏。 */
export async function runEditorEngineTextBrowserContract({ openEditor, load }) {
  const session = await openEditor(await load('sample-editor-engine-text.pptx'), {
    idPrefix: 'browser-engine-text-',
  });
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const view = session.mount(mount, { mode: 'edit', textMode: 'svg', zoom: 1 });
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === 'Engine 跨行基准');
  const partition = mount.querySelector(`[data-edit-id="${record.id}"]`);
  partition.dispatchEvent(new MouseEvent('dblclick', {
    bubbles: true, composed: true, cancelable: true,
  }));
  let editable = mount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  let engine = editable?.querySelector('[data-layout="engine"]');
  const initialLines = engine?.querySelectorAll('[data-engine-line]').length ?? 0;
  const positionError = engine ? linePositionError(engine) : Number.POSITIVE_INFINITY;
  if (!engine || initialLines < 4 || engine.style.whiteSpace !== 'pre'
    || positionError > 0.25 || mount.querySelector('[data-ppt-layer="static"] foreignObject')
    || !mount.querySelector('[data-ppt-layer="static"] text')) {
    throw new Error(`真实 engine 行盒偏差 ${positionError.toFixed(3)}px，行数=${initialLines}`);
  }

  const originalLength = textOf(session.editor.effectiveElement(record.id)).length;
  const inserted = '中'.repeat(2000);
  const samples = [];
  for (let index = 0; index < 20; index++) {
    editable = mount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
    selectFirstCharacter(editable);
    const started = performance.now();
    const event = new InputEvent('beforeinput', {
      bubbles: true, composed: true, cancelable: true, inputType: 'insertText', data: inserted,
    });
    const accepted = editable.dispatchEvent(event);
    engine = mount.querySelector(`[data-ppt-text-editor="${record.id}"] [data-layout="engine"]`);
    engine?.getBoundingClientRect();
    samples.push(performance.now() - started);
    const currentLength = textOf(session.editor.effectiveElement(record.id)).length;
    if (accepted || currentLength !== originalLength - 1 + inserted.length
      || (engine?.querySelectorAll('[data-engine-line]').length ?? 0) <= initialLines) {
      throw new Error('2,000 字符没有进入 engine 模型并完成行盒重算');
    }
    session.editor.undo();
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  if (session.editor.history.undoCount !== 0
    || textOf(session.editor.effectiveElement(record.id)).length !== originalLength) {
    throw new Error('engine 2,000 字符输入撤销后的模型或历史不一致');
  }
  recordPerformanceBudget('engine 2,000 字符完整上屏 p95', p95, 30);
  return { session, view, mount, id: record.id, p95, positionError, initialLines };
}
