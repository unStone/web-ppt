import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const textOf = (element) => element.text.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');

function caretAtEnd(window, root) {
  const marker = [...root.querySelectorAll('[data-r]')].at(-1);
  const walker = window.document.createTreeWalker(marker, window.NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let last = node;
  while (node) { last = node; node = walker.nextNode(); }
  const range = window.document.createRange();
  range.setStart(last ?? marker, last?.textContent.length ?? marker.childNodes.length);
  range.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
}

const displayedScale = (root) => Number(root?.querySelector('[data-font-scale]')?.dataset.fontScale);
const wait = (window, milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function installAutofitClock(window) {
  const nativeSetTimeout = window.setTimeout;
  const nativeClearTimeout = window.clearTimeout;
  const tasks = new Map();
  let serial = 0;
  let scheduled = 0;
  let canceled = 0;
  let fired = 0;
  window.setTimeout = (callback, delay, ...args) => {
    if (delay !== 100) return nativeSetTimeout.call(window, callback, delay, ...args);
    const id = -(++serial);
    scheduled++;
    tasks.set(id, () => callback(...args));
    return id;
  };
  window.clearTimeout = (id) => {
    if (tasks.delete(id)) canceled++;
    else nativeClearTimeout.call(window, id);
  };
  return {
    get scheduled() { return scheduled; },
    get canceled() { return canceled; },
    get fired() { return fired; },
    get pending() { return tasks.size; },
    flush() {
      const active = [...tasks.values()];
      tasks.clear();
      for (const callback of active) { fired++; callback(); }
    },
    restore() {
      window.setTimeout = nativeSetTimeout;
      window.clearTimeout = nativeClearTimeout;
    },
  };
}

async function checkLifecycleCancellation({ check, lib, root, window }) {
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-table-text.pptx')));
  const scenarios = [
    ['切格', ({ editable }) => editable().dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'Tab', bubbles: true, composed: true, cancelable: true,
    }))],
    ['退出文字', ({ editable }) => editable().dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, composed: true, cancelable: true,
    }))],
    ['切页', ({ session, view }) => view.setSlide(session.editor.doc.slideOrder[1])],
    ['切到查看模式', ({ view }) => view.setMode('view')],
    ['销毁视图', ({ view }) => view.destroy()],
    ['切换共享会话视图', ({ session, record, extra }) => {
      const other = document.createElement('div');
      document.body.append(other);
      const otherView = session.mount(other, { mode: 'edit', textMode: 'html' });
      extra.push(() => { otherView.destroy(); other.remove(); });
      other.querySelector('[data-table-cell="1:3"]').dispatchEvent(
        new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
      );
      return record;
    }],
  ];

  for (const [name, action] of scenarios) {
    const session = await lib.openEditor(bytes.slice(0), { idPrefix: `autofit-life-${name}-` });
    const record = Object.values(session.editor.doc.elements)
      .find((candidate) => candidate.src.name === '表格文字综合');
    const container = document.createElement('div');
    document.body.append(container);
    const clock = installAutofitClock(window);
    const extra = [];
    try {
      const view = session.mount(container, { mode: 'edit', textMode: 'html' });
      container.querySelector('[data-table-cell="1:3"]').dispatchEvent(
        new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
      );
      const editable = () => container.querySelector('[data-ppt-text-editor]');
      caretAtEnd(window, editable());
      editable().dispatchEvent(new window.InputEvent('beforeinput', {
        inputType: 'insertText', data: '待取消', bubbles: true, composed: true, cancelable: true,
      }));
      const pendingBefore = clock.pending;
      action({ editable, session, view, record, extra });
      const pendingAfter = clock.pending;
      clock.flush();
      check(`${name}取消当前视图尚未到点的 autofit 回调`,
        pendingBefore === 1 && pendingAfter === 0
          && clock.scheduled === 1 && clock.canceled === 1 && clock.fired === 0,
      `pending=${pendingBefore}/${pendingAfter} scheduled=${clock.scheduled} canceled=${clock.canceled} fired=${clock.fired}`);
    } finally {
      for (const cleanup of extra.reverse()) cleanup();
      clock.restore();
      session.dispose();
      container.remove();
    }
  }
}

/** 节流是文字编辑面的可观察行为；模型仍必须在 beforeinput 内同步提交。 */
export async function runAutofitTextEditorContract({ check, core, lib, root, window }) {
  console.log('\n\x1b[36m▸ DOM normAutofit 输入节流\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-engine-text.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-autofit-' });
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === 'Engine 裸自动缩放');
  const container = document.createElement('div');
  document.body.append(container);
  const view = session.mount(container, { mode: 'edit', textMode: 'svg' });
  container.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  let editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const initialScale = displayedScale(editable);
  const before = textOf(session.editor.effectiveElement(record.id));
  caretAtEnd(window, editable);
  const inserted = '自动缩放'.repeat(120);
  const input = new window.InputEvent('beforeinput', {
    inputType: 'insertText', data: inserted, bubbles: true, composed: true, cancelable: true,
  });
  editable.dispatchEvent(input);
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  check('beforeinput 同步提交模型，100ms 窗口内继续沿用上一有效比例',
    input.defaultPrevented
      && textOf(session.editor.effectiveElement(record.id)) === before + inserted
      && displayedScale(editable) === initialScale,
  `initial=${initialScale} immediate=${displayedScale(editable)}`);

  await wait(window, 130);
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const settledScale = displayedScale(editable);
  const settledElement = session.editor.effectiveElement(record.id);
  const expectedScale = core.layoutText(
    settledElement.text, settledElement.w, settledElement.h, { includeCarets: false },
  ).scale;
  check('节流窗口到点后重排一次并恢复文字末尾光标',
    settledScale < initialScale
      && Math.abs(settledScale - expectedScale) <= 0.005
      && window.getSelection().isCollapsed
      && window.getSelection().anchorNode
      && editable.contains(window.getSelection().anchorNode),
  `initial=${initialScale} settled=${settledScale}`);

  editable.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, composed: true, cancelable: true,
  }));
  container.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  const reopenedScale = displayedScale(container.querySelector('[data-ppt-text-editor]'));
  check('退出后静态预览与再次进入使用已收敛的同一比例',
    reopenedScale === settledScale, `settled=${settledScale} reopened=${reopenedScale}`);

  editable = container.querySelector('[data-ppt-text-editor]');
  caretAtEnd(window, editable);
  editable.dispatchEvent(new window.CompositionEvent('compositionstart', {
    bubbles: true, composed: true,
  }));
  const remoteText = session.editor.effectiveElement(record.id).text;
  const remoteParagraph = remoteText.paragraphs.length - 1;
  const remoteRun = remoteText.paragraphs[remoteParagraph].runs.length - 1;
  const remoteOffset = remoteText.paragraphs[remoteParagraph].runs[remoteRun].text.length;
  session.editor.exec({
    type: 'EditText', id: record.id,
    ops: [{
      type: 'replace',
      from: { p: remoteParagraph, r: remoteRun, off: remoteOffset },
      to: { p: remoteParagraph, r: remoteRun, off: remoteOffset },
      text: '远程模型'.repeat(500),
    }],
  });
  editable.dispatchEvent(new window.CompositionEvent('compositionend', {
    bubbles: true, composed: true, data: '',
  }));
  await wait(window, 130);
  editable = container.querySelector('[data-ppt-text-editor]');
  check('IME 期间的远程模型更新在组词结束后进入同一节流重排',
    displayedScale(editable) < reopenedScale,
  `before=${reopenedScale} after=${displayedScale(editable)}`);
  const remoteScale = displayedScale(editable);

  session.editor.undo();
  const undoImmediate = displayedScale(container.querySelector('[data-ppt-text-editor]'));
  await wait(window, 130);
  const undoScale = displayedScale(container.querySelector('[data-ppt-text-editor]'));
  session.editor.redo();
  const redoImmediate = displayedScale(container.querySelector('[data-ppt-text-editor]'));
  await wait(window, 130);
  const redoScale = displayedScale(container.querySelector('[data-ppt-text-editor]'));
  check('撤销/重做同步更新模型且分别在节流窗口后收敛比例',
    undoImmediate === remoteScale && undoScale > remoteScale
      && redoImmediate === undoScale && redoScale === remoteScale,
  `undo=${undoImmediate}/${undoScale} redo=${redoImmediate}/${redoScale}`);

  session.editor.undo();
  await wait(window, 130);
  const formatBody = session.editor.effectiveElement(record.id).text;
  const lastParagraph = formatBody.paragraphs.length - 1;
  const lastRun = formatBody.paragraphs[lastParagraph].runs.length - 1;
  const wholeRange = {
    from: { p: 0, r: 0, off: 0 },
    to: {
      p: lastParagraph, r: lastRun,
      off: formatBody.paragraphs[lastParagraph].runs[lastRun].text.length,
    },
  };
  session.editor.exec({ type: 'SetRunProps', id: record.id, range: wholeRange, props: { size: 8 } });
  const runImmediate = displayedScale(container.querySelector('[data-ppt-text-editor]'));
  await wait(window, 130);
  const runScale = displayedScale(container.querySelector('[data-ppt-text-editor]'));
  session.editor.exec({ type: 'SetParaProps', id: record.id, range: wholeRange, props: { lineHeight: 6 } });
  const paraImmediate = displayedScale(container.querySelector('[data-ppt-text-editor]'));
  await wait(window, 130);
  const paraScale = displayedScale(container.querySelector('[data-ppt-text-editor]'));
  check('字符与段落格式变化也复用同一 autofit 节流路径',
    runImmediate === undoScale && runScale > runImmediate
      && paraImmediate === runScale && paraScale < paraImmediate,
  `run=${runImmediate}/${runScale} para=${paraImmediate}/${paraScale}`);

  editable = container.querySelector('[data-ppt-text-editor]');
  caretAtEnd(window, editable);
  editable.dispatchEvent(new window.InputEvent('beforeinput', {
    inputType: 'insertText', data: '销毁', bubbles: true, composed: true, cancelable: true,
  }));
  view.destroy();
  await wait(window, 130);
  check('销毁视图会取消尚未到点的 autofit DOM 重排', container.childElementCount === 0);
  session.dispose();
  container.remove();
  await checkLifecycleCancellation({ check, lib, root, window });
}
