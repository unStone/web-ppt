const waitFrames = (evaluate, count = 2) => evaluate(`new Promise((resolve) => {
  let remaining = ${count};
  const next = () => requestAnimationFrame(() => --remaining ? next() : resolve());
  next();
})`, true);

const touchPoint = (id, point) => ({
  id, x: point.x, y: point.y, radiusX: 8, radiusY: 8, force: 1,
});

/** 由 CDP 投递真实触点，覆盖浏览器 PointerEvent、capture 与 rAF 合帧路径。 */
export async function runTrustedTouchContract({ evaluate, request, delay }) {
  await request('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
  const dispatch = (type, points) => request('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(({ id, ...point }) => touchPoint(id, point)),
  });
  const dispatchMouse = (type, point, pointerType) => request('Input.dispatchMouseEvent', {
    type, x: point.x, y: point.y, pointerType,
    button: type === 'mousePressed' || type === 'mouseReleased' ? 'left' : 'none',
    buttons: type === 'mousePressed' ? 1 : 0,
    clickCount: 1,
  });
  const hitSetup = await evaluate(`(async () => {
    const { openEditor, load } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const session = await openEditor(await load('sample-editor-touch.pptx'), {
      idPrefix: 'trusted-touch-hit-',
    });
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg', zoom: 0.75 });
    mount.scrollIntoView({ block: 'start', inline: 'start' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const outline = Object.values(session.editor.doc.elements)
      .find((record) => record.src.name === 'touch-thin-outline');
    const node = mount.querySelector('[data-edit-id="' + outline.id + '"]');
    const rect = node.getBoundingClientRect();
    const inputs = [];
    view.element.addEventListener('pointerdown', (event) => {
      inputs.push({ trusted: event.isTrusted, type: event.pointerType });
    }, true);
    globalThis.trustedTouchHit = {
      session, view, outlineId: outline.id, inputs,
      history: session.editor.history.undoCount,
    };
    return { x: rect.left + rect.width / 2, y: rect.top + 6 };
  })()`, true);
  await dispatch('touchStart', [{ id: 21, ...hitSetup }]);
  await dispatch('touchEnd', []);
  const touchSelected = await evaluate(`(() => {
    const state = globalThis.trustedTouchHit;
    const selected = state.session.editor.selection;
    const result = selected.kind === 'elements' && selected.ids[0] === state.outlineId;
    state.session.editor.select({ kind: 'none' });
    return result;
  })()`);
  await dispatchMouse('mousePressed', hitSetup, 'mouse');
  await dispatchMouse('mouseReleased', hitSetup, 'mouse');
  const mouseExact = await evaluate(`(() => {
    const state = globalThis.trustedTouchHit;
    const result = state.session.editor.selection.kind === 'none';
    state.session.editor.select({ kind: 'none' });
    return result;
  })()`);
  await dispatchMouse('mousePressed', hitSetup, 'pen');
  await dispatchMouse('mouseReleased', hitSetup, 'pen');
  const hitResult = await evaluate(`(() => {
    const state = globalThis.trustedTouchHit;
    const result = {
      penExact: state.session.editor.selection.kind === 'none',
      historyStable: state.session.editor.history.undoCount === state.history,
      inputs: state.inputs,
    };
    state.view.destroy();
    state.session.dispose();
    delete globalThis.trustedTouchHit;
    return result;
  })()`);
  if (!touchSelected || !mouseExact || !hitResult.penExact || !hitResult.historyStable
    || hitResult.inputs.length < 3
    || hitResult.inputs.some((event) => !event.trusted)
    || !['touch', 'mouse', 'pen'].every((type) => hitResult.inputs.some((event) => event.type === type))) {
    throw new Error(`可信触屏细描边命中失败：${JSON.stringify({
      touchSelected, mouseExact, ...hitResult,
    })}`);
  }

  const setup = await evaluate(`(async () => {
    const { openEditor, load } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const session = await openEditor(await load('sample-editor-60.pptx'), {
      idPrefix: 'trusted-touch-',
    });
    const navigation = [];
    const contexts = [];
    const samples = [];
    let lastMoveAt = null;
    const view = session.mount(mount, {
      mode: 'edit', textMode: 'svg', zoom: 1, snapping: false,
      onTouchNavigate(change) {
        navigation.push(structuredClone(change));
        if (change.phase === 'update' && lastMoveAt !== null) {
          samples.push(performance.now() - lastMoveAt);
          lastMoveAt = null;
        }
      },
      onContextRequest(request) { contexts.push(structuredClone(request)); },
    });
    const captures = { got: [], lost: [] };
    view.element.addEventListener('gotpointercapture', (event) => {
      captures.got.push({ id: event.pointerId, trusted: event.isTrusted, type: event.pointerType });
    });
    view.element.addEventListener('lostpointercapture', (event) => {
      captures.lost.push({ id: event.pointerId, trusted: event.isTrusted, type: event.pointerType });
    });
    view.element.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') lastMoveAt = performance.now();
    }, true);
    mount.scrollIntoView({ block: 'start', inline: 'start' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = mount.querySelector('[data-ppt-stage]').getBoundingClientRect();
    const center = {
      x: Math.min(innerWidth - 190, Math.max(190, rect.left + Math.min(rect.width / 2, 480))),
      y: Math.min(innerHeight - 150, Math.max(150, rect.top + Math.min(rect.height / 2, 300))),
    };
    globalThis.trustedTouchContract = {
      session, view, navigation, contexts, samples, captures,
      projection: JSON.stringify(session.editor.toSlide(view.slideId)),
      history: session.editor.history.undoCount,
      rect: { left: rect.left, top: rect.top }, center,
    };
    return { center, rect: { left: rect.left, top: rect.top } };
  })()`, true);
  const start = {
    first: { id: 31, x: setup.center.x - 80, y: setup.center.y },
    second: { id: 32, x: setup.center.x + 80, y: setup.center.y },
  };
  await dispatch('touchStart', [start.first]);
  await dispatch('touchStart', [start.first, start.second]);
  for (let index = 0; index < 25; index++) {
    const half = 84 + index * 1.5;
    const current = {
      first: { id: 31, x: setup.center.x + 20 - half, y: setup.center.y + 15 },
      second: { id: 32, x: setup.center.x + 20 + half, y: setup.center.y + 15 },
    };
    await dispatch('touchMove', [current.first, current.second]);
    await waitFrames(evaluate);
  }
  // CDP 要求 touchEnd 不携带触点，可信链路验证单指升级双指；降级由公开 PointerEvent 契约覆盖。
  await dispatch('touchEnd', []);
  await waitFrames(evaluate);
  const navigation = await evaluate(`(() => {
    const state = globalThis.trustedTouchContract;
    const scaled = state.navigation.findLast((change) => change.phase === 'update'
      && change.pointerCount === 2);
    const end = state.navigation.at(-1);
    const expectedZoom = 1.5;
    const expectedLeft = state.center.x + 20
      - (state.center.x - state.rect.left) * expectedZoom;
    const expectedTop = state.center.y + 15
      - (state.center.y - state.rect.top) * expectedZoom;
    const ordered = [...state.samples].sort((a, b) => a - b);
    return {
      zoomError: Math.abs((scaled?.viewport.zoom ?? 0) - expectedZoom),
      centerError: Math.hypot(
        (scaled?.viewport.left ?? Infinity) - expectedLeft,
        (scaled?.viewport.top ?? Infinity) - expectedTop,
      ),
      panError: Math.hypot(
        (end?.viewport.left ?? Infinity) - (scaled?.viewport.left ?? -Infinity),
        (end?.viewport.top ?? Infinity) - (scaled?.viewport.top ?? -Infinity),
      ),
      ended: end?.phase === 'end' && end.pointerCount === 0,
      modelStable: JSON.stringify(state.session.editor.toSlide(state.view.slideId)) === state.projection,
      historyStable: state.session.editor.history.undoCount === state.history,
      captureGot: state.captures.got,
      captureLost: state.captures.lost,
      clean: !state.view.element.hasAttribute('data-touch-navigation'),
      p95: ordered[Math.floor(ordered.length * 0.95)] ?? Infinity,
      samples: ordered.length,
    };
  })()`);
  const captureValid = navigation.captureGot.length >= 2 && navigation.captureLost.length >= 2
    && [...navigation.captureGot, ...navigation.captureLost]
      .every((event) => event.trusted && event.type === 'touch');
  if (navigation.zoomError > 0.005 || navigation.centerError > 0.5
    || navigation.panError > 0.5 || !navigation.ended || !navigation.modelStable
    || !navigation.historyStable || !navigation.clean || !captureValid || navigation.samples < 20) {
    throw new Error(`真实双指缩放/平移失败：${JSON.stringify(navigation)}`);
  }

  const longPressPoint = await evaluate(`(() => {
    const state = globalThis.trustedTouchContract;
    const id = state.session.editor.doc.slides[state.view.slideId].children[0];
    const rect = document.querySelector('#mount [data-edit-id="' + id + '"]').getBoundingClientRect();
    state.longPressTarget = id;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await dispatch('touchStart', [{ id: 41, ...longPressPoint }]);
  await delay(450);
  const beforeThreshold = await evaluate('globalThis.trustedTouchContract.contexts.length');
  await delay(80);
  const afterThreshold = await evaluate(`(() => {
    const state = globalThis.trustedTouchContract;
    const request = state.contexts[0];
    return {
      count: state.contexts.length,
      target: request?.targetId === state.longPressTarget,
      source: request?.source,
    };
  })()`);
  await dispatch('touchEnd', []);
  if (beforeThreshold !== 0 || afterThreshold.count !== 1
    || !afterThreshold.target || afterThreshold.source !== 'touch') {
    throw new Error(`真实长按阈值失败：before=${beforeThreshold} after=${JSON.stringify(afterThreshold)}`);
  }

  await dispatch('touchStart', [{ id: 51, x: setup.center.x - 60, y: setup.center.y }]);
  await dispatch('touchStart', [
    { id: 51, x: setup.center.x - 60, y: setup.center.y },
    { id: 52, x: setup.center.x + 60, y: setup.center.y },
  ]);
  await dispatch('touchCancel', []);
  const cancelled = await evaluate(`(() => {
    const state = globalThis.trustedTouchContract;
    const last = state.navigation.at(-1);
    const result = last?.phase === 'cancel'
      && !state.view.element.hasAttribute('data-touch-navigation')
      && JSON.stringify(state.session.editor.toSlide(state.view.slideId)) === state.projection
      && state.session.editor.history.undoCount === state.history;
    state.view.destroy();
    state.session.dispose();
    delete globalThis.trustedTouchContract;
    return result;
  })()`);
  if (!cancelled) throw new Error('真实 touchcancel 没有收束手势或污染了模型历史');
  return {
    hitDistance: 6,
    zoomError: navigation.zoomError,
    centerError: navigation.centerError,
    panError: navigation.panError,
    p95: navigation.p95,
  };
  } finally {
    await evaluate(`(() => {
      const state = globalThis.trustedTouchContract;
      state?.view.destroy();
      state?.session.dispose();
      delete globalThis.trustedTouchContract;
      const hit = globalThis.trustedTouchHit;
      hit?.view.destroy();
      hit?.session.dispose();
      delete globalThis.trustedTouchHit;
    })()`).catch(() => {});
    await request('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
  }
}
