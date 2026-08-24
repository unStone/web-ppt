/** 修饰键状态、SVG 布局反馈与帧预算必须由真实 Chrome 验收。 */
const pointer = (type, point, pointerId, init = {}) => new PointerEvent(type, {
  bubbles: true, composed: true, cancelable: true, pointerType: 'mouse', pointerId,
  isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
  clientX: point.x, clientY: point.y, ...init,
});

function p95(samples) {
  return [...samples].sort((left, right) => left - right)[Math.floor(samples.length * 0.95)];
}

function flushFrame(pending, mount, started) {
  const next = pending.entries().next().value;
  if (!next || pending.size !== 1) throw new Error(`增减框选帧队列失控：${pending.size}`);
  pending.delete(next[0]);
  next[1](performance.now());
  for (const node of mount.querySelectorAll(
    '[data-edit-marquee-frame], [data-edit-marquee-candidate]',
  )) node.getBoundingClientRect();
  return performance.now() - started;
}

export async function runEditorMultiselectBrowserContract({ openEditor, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const session = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-multiselect-perf-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const ids = session.editor.doc.slides[view.slideId].children;
    const targets = ids.map((id) => mount.querySelector(`[data-edit-id="${id}"]`));
    const staticSvg = mount.querySelector('[data-ppt-layer="static"] svg');
    const history = session.editor.history.undoCount;
    const clickSamples = [];
    let consumed = true;
    for (let index = 0; index < 120; index++) {
      const init = index % 3 === 0 ? { shiftKey: true }
        : index % 3 === 1 ? { ctrlKey: true } : { metaKey: true };
      const point = { x: 10, y: 10 };
      const started = performance.now();
      consumed &&= !targets[index % 60].dispatchEvent(pointer('pointerdown', point, 400 + index, init));
      view.element.dispatchEvent(pointer('pointerup', point, 400 + index, init));
      mount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
      clickSamples.push(performance.now() - started);
    }
    const clickP95 = p95(clickSamples);
    if (ids.length !== 60 || clickP95 > 8 || !consumed
      || session.editor.selection.kind !== 'none' || session.editor.history.undoCount !== history
      || mount.querySelector('[data-ppt-layer="static"] svg') !== staticSvg) {
      throw new Error(`60 元素修饰点选 p95 ${clickP95.toFixed(3)}ms 或选区/历史/静态层不一致`);
    }

    const initial = ids.filter((_, index) => index % 2 === 0);
    session.editor.select({ kind: 'elements', ids: initial, enteredGroup: null });
    const matrix = mount.querySelector('svg[data-ppt-layer="interaction"]')?.getScreenCTM();
    if (!matrix) throw new Error('无法取得 60 元素增减框选交互层矩阵');
    const start = new DOMPoint(0, 0).matrixTransform(matrix);
    const end = new DOMPoint(1280, 720).matrixTransform(matrix);
    const pending = new Map();
    let frameSerial = 0;
    const originalRequest = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    const marqueeSamples = [];
    let firstPreview = false;
    window.requestAnimationFrame = (callback) => {
      const frame = ++frameSerial;
      pending.set(frame, callback);
      return frame;
    };
    window.cancelAnimationFrame = (frame) => pending.delete(frame);
    try {
      for (let index = 0; index < 80; index++) {
        const pointerId = 700 + index;
        view.element.dispatchEvent(pointer('pointerdown', start, pointerId, { shiftKey: true }));
        const previewStarted = performance.now();
        view.element.dispatchEvent(pointer('pointermove', end, pointerId, { shiftKey: true }));
        marqueeSamples.push(flushFrame(pending, mount, previewStarted));
        if (index === 0) {
          firstPreview = mount.querySelector(
            `[data-edit-marquee-candidate="${ids[0]}"]`,
          )?.getAttribute('display') === 'none'
            && mount.querySelector(
              `[data-edit-marquee-candidate="${ids[1]}"]`,
            )?.getAttribute('display') !== 'none';
        }
        const commitStarted = performance.now();
        view.element.dispatchEvent(pointer('pointerup', end, pointerId, { shiftKey: true }));
        mount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
        marqueeSamples.push(performance.now() - commitStarted);
      }
    } finally {
      window.requestAnimationFrame = originalRequest;
      window.cancelAnimationFrame = originalCancel;
    }
    const marqueeP95 = p95(marqueeSamples);
    const selection = session.editor.selection;
    if (marqueeP95 > 8 || !firstPreview || selection.kind !== 'elements'
      || selection.ids.join(',') !== initial.join(',') || session.editor.history.undoCount !== history
      || mount.querySelector('[data-edit-marquee-layer]')
      || mount.querySelector('[data-ppt-layer="static"] svg') !== staticSvg) {
      throw new Error(`60 元素增减框选 p95 ${marqueeP95.toFixed(3)}ms 或预览/提交不一致`);
    }
    return { clickP95, marqueeP95 };
  } finally {
    session.dispose();
    mount.remove();
  }
}

export async function runTrustedModifierSelectionContract({ evaluate, trustedClick }) {
  const points = await evaluate(`(() => {
    const { perfSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const view = perfSession.mount(mount, { mode: 'edit', textMode: 'svg', zoom: 0.75 });
    const ids = perfSession.editor.doc.slides[view.slideId].children.slice(0, 3);
    perfSession.editor.select({ kind: 'none' });
    const events = [];
    view.element.addEventListener('pointerdown', (event) => {
      events.push([event.isTrusted, event.shiftKey, event.ctrlKey, event.metaKey]);
    });
    view.element.focus({ preventScroll: true });
    const points = ids.map((id) => {
      const rect = mount.querySelector('[data-edit-id="' + id + '"]').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    globalThis.trustedModifierSelection = {
      view, ids, events, history: perfSession.editor.history.undoCount,
      svg: mount.querySelector('[data-ppt-layer="static"] svg'),
    };
    return points;
  })()`);
  await trustedClick(points[0]);
  await trustedClick(points[1], 8);
  await trustedClick(points[2], 2);
  await trustedClick(points[1], 4);
  const result = await evaluate(`(() => {
    const state = globalThis.trustedModifierSelection;
    const { perfSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const selection = perfSession.editor.selection;
    const result = {
      trusted: state.events.length === 4 && state.events.every((entry) => entry[0]),
      modifiers: state.events[1]?.[1] === true && state.events[2]?.[2] === true
        && state.events[3]?.[3] === true,
      selection: selection.kind === 'elements'
        && selection.ids.join(',') === [state.ids[0], state.ids[2]].join(','),
      focused: document.activeElement === state.view.element,
      noHistory: perfSession.editor.history.undoCount === state.history,
      staticStable: mount.querySelector('[data-ppt-layer="static"] svg') === state.svg,
    };
    state.view.destroy();
    delete globalThis.trustedModifierSelection;
    return result;
  })()`);
  if (!Object.values(result).every(Boolean)) {
    throw new Error(`真实修饰点选失败：${JSON.stringify(result)}`);
  }
}
