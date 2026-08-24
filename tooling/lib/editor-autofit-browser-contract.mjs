const textOf = (text) => text.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');

function caretAtEnd(root) {
  const marker = [...root.querySelectorAll('[data-r]')].at(-1);
  const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let last = node;
  while (node) { last = node; node = walker.nextNode(); }
  const range = document.createRange();
  range.setStart(last ?? marker, last?.textContent.length ?? marker.childNodes.length);
  range.collapse(true);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
}

const scaleOf = (root) => Number(root.querySelector('[data-font-scale]').dataset.fontScale);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const nearScale = (actual, expected) => Math.abs(actual - expected) <= 0.005;

async function measureTarget({
  openEditor, layoutText, bytes, textMode, idPrefix, recordName, selector, inserted, resolveLayout,
}) {
  const session = await openEditor(bytes, { idPrefix });
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === recordName);
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const view = session.mount(mount, { mode: 'edit', textMode });
  const targetSelector = typeof selector === 'function' ? selector(record) : selector;
  const activate = () => mount.querySelector(targetSelector).dispatchEvent(
    new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }),
  );
  activate();

  let editable = mount.querySelector('[data-ppt-text-editor]');
  const initialScale = scaleOf(editable);
  const initialLayout = resolveLayout(session.editor.effectiveElement(record.id));
  const initialExpected = layoutText(
    initialLayout.text, initialLayout.width, initialLayout.height,
    { ...initialLayout.options, includeCarets: false },
  ).scale;
  const beforeLength = textOf(initialLayout.text).length;
  const samples = [];
  const burstStarted = performance.now();
  let firstWindowStable = true;
  let settledDuringBurst = false;
  for (let index = 0; index < 80; index++) {
    editable = mount.querySelector('[data-ppt-text-editor]');
    caretAtEnd(editable);
    const started = performance.now();
    const event = new InputEvent('beforeinput', {
      inputType: 'insertText', data: inserted, bubbles: true, composed: true, cancelable: true,
    });
    editable.dispatchEvent(event);
    editable = mount.querySelector('[data-ppt-text-editor]');
    editable.getBoundingClientRect();
    samples.push(performance.now() - started);
    const elapsed = performance.now() - burstStarted;
    if (elapsed < 90) firstWindowStable &&= event.defaultPrevented && scaleOf(editable) === initialScale;
    if (elapsed >= 110 && scaleOf(editable) !== initialScale) settledDuringBurst = true;
    // 输入跨过多个 100ms 窗口，才能区分 throttle 与等停键后才执行的 debounce。
    await wait(6);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const effective = resolveLayout(session.editor.effectiveElement(record.id));
  const synchronous = textOf(effective.text).length === beforeLength + 80 * inserted.length;
  await wait(130);
  editable = mount.querySelector('[data-ppt-text-editor]');
  const settledScale = scaleOf(editable);
  const settledLayout = resolveLayout(session.editor.effectiveElement(record.id));
  const expectedScale = layoutText(
    settledLayout.text, settledLayout.width, settledLayout.height,
    { ...settledLayout.options, includeCarets: false },
  ).scale;
  editable.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, composed: true, cancelable: true,
  }));
  activate();
  const reopenedScale = scaleOf(mount.querySelector('[data-ppt-text-editor]'));
  view.destroy();
  session.dispose();
  mount.remove();
  return {
    p95, firstWindowStable, settledDuringBurst, synchronous,
    initialScale, initialExpected, settledScale, expectedScale, reopenedScale,
  };
}

const shapeLayout = (element) => ({
  text: element.text,
  width: element.w,
  height: element.h,
  options: {},
});

const tableCellLayout = (element) => {
  const cell = element.rows[1].cells[3];
  return {
    text: cell.text,
    width: element.colWidths.slice(3, 3 + cell.colSpan).reduce((sum, width) => sum + width, 0),
    height: element.rows.slice(1, 1 + cell.rowSpan).reduce((sum, row) => sum + row.height, 0),
    options: { insets: cell.margins, vert: cell.vert },
  };
};

/** browser/engine 共用一个节流决策，真实引擎只差在行盒生产者。 */
export async function runEditorAutofitBrowserContract({ openEditor, load, layoutText }) {
  const shapeBytes = await load('sample-editor-engine-text.pptx');
  const common = {
    openEditor, layoutText, recordName: 'Engine 裸自动缩放',
    selector: (record) => `[data-edit-id="${record.id}"]`,
    inserted: '自动缩放', resolveLayout: shapeLayout,
  };
  const browser = await measureTarget({
    ...common, bytes: shapeBytes.slice(0), textMode: 'html', idPrefix: 'browser-autofit-html-',
  });
  const engine = await measureTarget({
    ...common, bytes: shapeBytes.slice(0), textMode: 'svg', idPrefix: 'browser-autofit-svg-',
  });
  const cell = await measureTarget({
    openEditor, layoutText, bytes: await load('sample-editor-table-text.pptx'),
    textMode: 'html', idPrefix: 'browser-autofit-cell-', recordName: '表格文字综合',
    selector: '[data-table-cell="1:3"]', inserted: '单元格', resolveLayout: tableCellLayout,
  });

  for (const [mode, result] of Object.entries({ browser, engine, cell })) {
    if (!result.firstWindowStable || !result.settledDuringBurst || !result.synchronous
      || result.p95 > 30 || !nearScale(result.initialScale, result.initialExpected)
      || !nearScale(result.settledScale, result.expectedScale)
      || result.reopenedScale !== result.settledScale) {
      throw new Error(`${mode} autofit 失败：p95=${result.p95.toFixed(3)}ms `
        + `initial=${result.initialScale}/${result.initialExpected} `
        + `settled=${result.settledScale}/${result.expectedScale}/${result.reopenedScale} `
        + `window=${result.firstWindowStable}/${result.settledDuringBurst}`);
    }
  }
  return { browserP95: browser.p95, engineP95: engine.p95, cellP95: cell.p95 };
}
