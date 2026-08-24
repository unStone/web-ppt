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

const percentile95 = (samples) => [...samples]
  .sort((left, right) => left - right)[Math.floor(samples.length * 0.95)];

function frameError(mount, session, record) {
  const element = session.editor.effectiveElement(record.id);
  const partition = mount.querySelector(`[data-edit-id="${record.id}"]`);
  const base = partition?.querySelector(':scope > g[transform]');
  const outline = mount.querySelector('[data-edit-selection-frame]');
  const targetMatrix = base?.getScreenCTM();
  const overlayMatrix = outline?.getScreenCTM();
  if (!targetMatrix || !overlayMatrix) throw new Error('spAutoFit 无法取得静态形状或选框矩阵');
  const expected = [[0, 0], [element.w, 0], [element.w, element.h], [0, element.h]]
    .map(([x, y]) => new DOMPoint(x, y).matrixTransform(targetMatrix));
  const actual = outline.getAttribute('points').trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return new DOMPoint(x, y).matrixTransform(overlayMatrix);
  });
  return Math.max(...actual.map((point, index) =>
    Math.hypot(point.x - expected[index].x, point.y - expected[index].y)));
}

async function measure({ openEditor, bytes, textMode }) {
  const session = await openEditor(bytes, { idPrefix: `browser-shape-autofit-${textMode}-` });
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === 'sp-autofit-rotated');
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const view = session.mount(mount, { mode: 'edit', textMode });
  mount.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(
    new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }),
  );
  const samples = [];
  const state = {
    prevented: true, height: true, partition: true, caret: true, selection: true,
    monotonic: true, grew: false, heightError: 0, heightSample: '', frameError: 0,
  };
  const sourceHeight = session.editor.effectiveElement(record.id).h;
  let previousHeight = session.editor.effectiveElement(record.id).h;
  for (let index = 0; index < 80; index++) {
    let editable = mount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
    caretAtEnd(editable);
    const partition = mount.querySelector(`[data-edit-id="${record.id}"]`);
    const started = performance.now();
    const event = new InputEvent('beforeinput', {
      inputType: 'insertText', data: '增', bubbles: true, composed: true, cancelable: true,
    });
    editable.dispatchEvent(event);
    editable = mount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
    const nextPartition = mount.querySelector(`[data-edit-id="${record.id}"]`);
    nextPartition.getBoundingClientRect();
    const synchronousFrameError = frameError(mount, session, record);
    samples.push(performance.now() - started);
    const effective = session.editor.effectiveElement(record.id);
    state.prevented &&= event.defaultPrevented;
    const heightError = Math.abs(Number.parseFloat(editable.style.height) - effective.h);
    if (heightError > state.heightError) {
      state.heightError = heightError;
      state.heightSample = `${editable.style.height}/${effective.h}`;
    }
    state.height &&= heightError <= 1 / 9525 + 1e-9;
    state.partition &&= nextPartition !== partition;
    state.caret &&= getSelection().isCollapsed && editable.contains(getSelection().anchorNode);
    state.selection &&= synchronousFrameError <= 0.5;
    state.frameError = Math.max(state.frameError, synchronousFrameError);
    if (index > 0) state.monotonic &&= effective.h + 1e-4 >= previousHeight;
    previousHeight = effective.h;
  }
  state.grew = previousHeight > sourceHeight;
  const editable = mount.querySelector('[data-ppt-text-editor]');
  editable.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, composed: true, cancelable: true,
  }));
  const error = frameError(mount, session, record);
  const result = {
    p95: percentile95(samples),
    synchronous: state.prevented && state.height && state.partition && state.caret && state.selection
      && state.monotonic && state.grew,
    error, state,
  };
  view.destroy();
  session.dispose();
  mount.remove();
  return result;
}

/** browser/engine 两条文字路径必须在同一次 input 内收敛到相同的模型与 frame。 */
export async function runEditorShapeAutofitBrowserContract({ openEditor, load }) {
  const bytes = await load('sample-editor-sp-autofit.pptx');
  const browser = await measure({ openEditor, bytes: bytes.slice(0), textMode: 'html' });
  const engine = await measure({ openEditor, bytes: bytes.slice(0), textMode: 'svg' });
  for (const [mode, result] of Object.entries({ browser, engine })) {
    if (!result.synchronous || result.p95 > 30 || result.error > 0.5) {
      throw new Error(`${mode} spAutoFit 失败：p95=${result.p95.toFixed(3)}ms `
        + `同步=${result.synchronous}/${JSON.stringify(result.state)} frame=${result.error.toFixed(3)}px`);
    }
  }
  return { browserP95: browser.p95, engineP95: engine.p95, frameError: Math.max(browser.error, engine.error) };
}
