/** Chrome 的 getScreenCTM 是框选世界 OBB 与橡皮筋的独立屏幕坐标 oracle。 */
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const pointer = (type, point, pointerId) => new PointerEvent(type, {
  bubbles: true, composed: true, cancelable: true, pointerType: 'mouse', pointerId, isPrimary: true,
  button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
  clientX: point.x, clientY: point.y,
});

function contractMount() {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  return mount;
}

function byName(session, name) {
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === name);
  if (!record) throw new Error(`框选固件缺少 ${name}`);
  return record;
}

function transformPoints(points, matrix) {
  return points.map((point) => new DOMPoint(point.x, point.y).matrixTransform(matrix));
}

function targetScreenCorners(mount, session, record) {
  const target = mount.querySelector(`[data-edit-id="${record.id}"]`);
  const base = target?.querySelector(':scope > g[transform]');
  const matrix = base?.getScreenCTM();
  if (!target || !matrix) throw new Error(`无法取得 ${record.src.name} 的屏幕矩阵`);
  const frame = session.editor.effectiveElement(record.id);
  return {
    target,
    corners: transformPoints([
      { x: 0, y: 0 }, { x: frame.w, y: 0 },
      { x: frame.w, y: frame.h }, { x: 0, y: frame.h },
    ], matrix),
  };
}

function bounds(corners) {
  return {
    left: Math.min(...corners.map((point) => point.x)),
    top: Math.min(...corners.map((point) => point.y)),
    right: Math.max(...corners.map((point) => point.x)),
    bottom: Math.max(...corners.map((point) => point.y)),
  };
}

function polygonScreenCorners(polygon) {
  const matrix = polygon?.getScreenCTM();
  if (!matrix) throw new Error('框选候选缺少屏幕矩阵');
  const points = polygon.getAttribute('points').trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
  return transformPoints(points, matrix);
}

function pointError(actual, expected) {
  return Math.max(...actual.map((point, index) =>
    Math.hypot(point.x - expected[index].x, point.y - expected[index].y)));
}

function frameError(frame, expected) {
  const matrix = frame?.getScreenCTM();
  if (!matrix) throw new Error('框选矩形缺少屏幕矩阵');
  const x = Number(frame.getAttribute('x'));
  const y = Number(frame.getAttribute('y'));
  const width = Number(frame.getAttribute('width'));
  const height = Number(frame.getAttribute('height'));
  const actual = transformPoints([{ x, y }, { x: x + width, y: y + height }], matrix);
  return Math.max(
    Math.hypot(actual[0].x - expected.left, actual[0].y - expected.top),
    Math.hypot(actual[1].x - expected.right, actual[1].y - expected.bottom),
  );
}

async function drag(view, start, end, pointerId) {
  view.element.dispatchEvent(pointer('pointerdown', start, pointerId));
  view.element.dispatchEvent(pointer('pointermove', end, pointerId));
  await nextFrame();
}

async function accuracyContract(openEditor, load) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-marquee.pptx'), {
    idPrefix: 'browser-marquee-accuracy-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const rotated = byName(session, 'marquee-rotated-flipped');
    const leaf = byName(session, 'marquee-nested-leaf');
    const plain = byName(session, 'marquee-plain');
    const cases = [
      { record: rotated, enteredGroup: null },
      { record: leaf, enteredGroup: leaf.parent },
    ];
    let error = 0;
    let serial = 220;
    for (const zoom of [0.5, 1, 2]) {
      view.setZoom(zoom);
      for (const testCase of cases) {
        session.editor.select(testCase.enteredGroup
          ? { kind: 'elements', ids: [testCase.record.id], enteredGroup: testCase.enteredGroup }
          : { kind: 'elements', ids: [plain.id], enteredGroup: null });
        const { target, corners } = targetScreenCorners(mount, session, testCase.record);
        const expected = bounds(corners);
        const staticSvg = mount.querySelector('[data-ppt-layer="static"] svg');
        const defs = staticSvg.querySelector('defs');
        const history = session.editor.history.undoCount;
        const prior = session.editor.selection;
        await drag(view, { x: expected.left, y: expected.top }, {
          x: expected.right, y: expected.bottom,
        }, serial++);
        const frame = mount.querySelector('[data-edit-marquee-frame]');
        const preview = mount.querySelector(
          `[data-edit-marquee-candidate="${testCase.record.id}"]`,
        );
        const rubberError = frameError(frame, expected);
        const candidateError = pointError(polygonScreenCorners(preview), corners);
        error = Math.max(error, rubberError, candidateError);
        const liveSelection = session.editor.selection;
        const selectionStable = liveSelection.kind === prior.kind && (prior.kind === 'none'
          || liveSelection.kind === 'elements'
            && liveSelection.enteredGroup === prior.enteredGroup
            && liveSelection.ids.join(',') === prior.ids.join(','));
        const modelStable = selectionStable
          && session.editor.history.undoCount === history
          && mount.querySelector(`[data-edit-id="${testCase.record.id}"]`) === target
          && mount.querySelector('[data-ppt-layer="static"] svg') === staticSvg
          && staticSvg.querySelector('defs') === defs;
        const included = preview?.getAttribute('display') !== 'none';
        view.element.dispatchEvent(pointer('pointerup', {
          x: expected.right, y: expected.bottom,
        }, serial - 1));
        const selected = session.editor.selection.kind === 'elements'
          && session.editor.selection.ids.length === 1
          && session.editor.selection.ids[0] === testCase.record.id
          && session.editor.selection.enteredGroup === testCase.enteredGroup;
        if (!modelStable || !included || !selected
          || session.editor.history.undoCount !== history
          || mount.querySelector('[data-edit-marquee-layer]')) {
          throw new Error(`zoom ${zoom} 的 ${testCase.record.src.name} 完全包含边界失败：`
            + `stable=${modelStable} included=${included} selected=${selected} `
            + `rubber=${rubberError.toFixed(3)} candidate=${candidateError.toFixed(3)}`);
        }

        await drag(view, { x: expected.left, y: expected.top }, {
          x: expected.right - 0.75, y: expected.bottom,
        }, serial++);
        const partial = mount.querySelector(
          `[data-edit-marquee-candidate="${testCase.record.id}"]`,
        );
        if (partial?.getAttribute('display') !== 'none') {
          throw new Error(`zoom ${zoom} 的 ${testCase.record.src.name} 相交被误选`);
        }
        view.element.dispatchEvent(pointer('pointercancel', {
          x: expected.right - 0.75, y: expected.bottom,
        }, serial - 1));
      }
    }
    if (error > 0.5) throw new Error(`三档缩放框选屏幕偏差 ${error.toFixed(3)}px`);
    return error;
  } finally {
    session.dispose();
    mount.remove();
  }
}

function flushFrame(pending, mount, started = performance.now()) {
  const next = pending.entries().next().value;
  if (!next || pending.size !== 1) throw new Error(`框选帧队列失控：${pending.size}`);
  pending.delete(next[0]);
  next[1](started);
  for (const node of mount.querySelectorAll(
    '[data-edit-marquee-frame], [data-edit-marquee-candidate]',
  )) node.getBoundingClientRect();
  return performance.now() - started;
}

async function performanceContract(openEditor, load) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-marquee-perf-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const ids = session.editor.doc.slides[view.slideId].children;
    const staticSvg = mount.querySelector('[data-ppt-layer="static"] svg');
    const history = session.editor.history.undoCount;
    const matrix = mount.querySelector('svg[data-ppt-layer="interaction"]')?.getScreenCTM();
    if (!matrix) throw new Error('无法取得 60 元素框选交互层矩阵');
    const start = new DOMPoint(0, 0).matrixTransform(matrix);
    const pending = new Map();
    let frameSerial = 0;
    const originalRequest = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    const samples = [];
    window.requestAnimationFrame = (callback) => {
      const frame = ++frameSerial;
      pending.set(frame, callback);
      return frame;
    };
    window.cancelAnimationFrame = (frame) => pending.delete(frame);
    try {
      view.element.dispatchEvent(pointer('pointerdown', start, 300));
      for (let index = 0; index < 80; index++) {
        const slideEnd = { x: 1100 + index % 3, y: 650 + index % 2 };
        const end = new DOMPoint(slideEnd.x, slideEnd.y).matrixTransform(matrix);
        const started = performance.now();
        view.element.dispatchEvent(pointer('pointermove', end, 300));
        samples.push(flushFrame(pending, mount, started));
      }
      view.element.dispatchEvent(pointer('pointercancel', start, 300));
    } finally {
      window.requestAnimationFrame = originalRequest;
      window.cancelAnimationFrame = originalCancel;
    }
    const firstFrame = samples[0];
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    if (ids.length !== 60 || firstFrame > 8 || p95 > 8
      || session.editor.history.undoCount !== history
      || session.editor.selection.kind !== 'none'
      || mount.querySelector('[data-edit-marquee-layer]')
      || mount.querySelector('[data-ppt-layer="static"] svg') !== staticSvg) {
      throw new Error(`60 元素框选首帧/p95 ${firstFrame.toFixed(3)}/${p95.toFixed(3)}ms `
        + '或取消恢复失败');
    }
    return { firstFrame, p95 };
  } finally {
    session.dispose();
    mount.remove();
  }
}

export async function runEditorMarqueeBrowserContract({ openEditor, load }) {
  const performance = await performanceContract(openEditor, load);
  return {
    geometryError: await accuracyContract(openEditor, load),
    firstFrame: performance.firstFrame,
    p95: performance.p95,
  };
}
