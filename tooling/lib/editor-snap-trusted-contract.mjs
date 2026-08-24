/** CDP 真实鼠标事件补足合成 PointerEvent 无法证明的 pointer capture 链路。 */
export async function runTrustedSnapContract({ evaluate, trustedMouseGesture }) {
  const start = await evaluate(`(() => {
    const { trustedSnapSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const view = trustedSnapSession.mount(mount, {
      mode: 'edit', textMode: 'svg', zoom: 0.75,
    });
    const record = Object.values(trustedSnapSession.editor.doc.elements)
      .find((candidate) => candidate.src.name === 'snap-threshold-target');
    trustedSnapSession.editor.select({ kind: 'elements', ids: [record.id], enteredGroup: null });
    const target = mount.querySelector('[data-edit-id="' + record.id + '"]');
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    globalThis.trustedSnapContract = {
      view, id: record.id, target, beforeLeft: rect.left,
      svg: mount.querySelector('[data-ppt-layer="static"] svg'),
      defs: mount.querySelector('[data-ppt-layer="static"] defs'),
      source: trustedSnapSession.editor.effectiveElement(record.id),
      historyBefore: trustedSnapSession.editor.history.undoCount,
    };
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  const end = { x: start.x + 70, y: start.y };
  const result = await trustedMouseGesture(start, end, `(() => {
    const state = globalThis.trustedSnapContract;
    const { trustedSnapSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const guide = mount.querySelector('[data-edit-snap-guide="x"]');
    const linePoint = new DOMPoint(Number(guide.getAttribute('x1')), Number(guide.getAttribute('y1')))
      .matrixTransform(guide.getScreenCTM());
    const interaction = mount.querySelector('svg[data-ppt-layer="interaction"]');
    const expected = new DOMPoint(300, Number(guide.getAttribute('y1')))
      .matrixTransform(interaction.getScreenCTM());
    return {
      captured: state.view.element.hasPointerCapture(1),
      ghost: !!mount.querySelector('[data-edit-drag-ghost]'),
      guide: guide.getAttribute('data-edit-snap-source') === 'element-edge'
        && Math.hypot(linePoint.x - expected.x, linePoint.y - expected.y) <= 0.5,
      shifted: Math.abs(state.target.getBoundingClientRect().left - state.beforeLeft - 75) <= 0.5,
      modelStable: trustedSnapSession.editor.effectiveElement(state.id).x === state.source.x,
      targetStable: mount.querySelector('[data-edit-id="' + state.id + '"]') === state.target,
      svgStable: mount.querySelector('[data-ppt-layer="static"] svg') === state.svg,
      defsStable: mount.querySelector('[data-ppt-layer="static"] defs') === state.defs,
    };
  })()`, `(() => {
    const state = globalThis.trustedSnapContract;
    const { trustedSnapSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const moved = trustedSnapSession.editor.effectiveElement(state.id);
    const result = {
      captureReleased: !state.view.element.hasPointerCapture(1),
      snapped: Math.abs(moved.x - 200) < 1e-6 && Math.abs(moved.y - 100) < 1e-6,
      oneHistory: trustedSnapSession.editor.history.undoCount === state.historyBefore + 1,
      previewGone: !mount.querySelector('[data-edit-drag-ghost]')
        && !mount.querySelector('[data-edit-snap-guides]'),
      targetPatched: mount.querySelector('[data-edit-id="' + state.id + '"]') !== state.target,
    };
    trustedSnapSession.editor.undo();
    result.undoRestored = Math.abs(trustedSnapSession.editor.effectiveElement(state.id).x - 100) < 1e-6;
    state.view.destroy();
    trustedSnapSession.dispose();
    delete globalThis.trustedSnapContract;
    return result;
  })()`);
  const passed = Object.values(result.during).every(Boolean)
    && Object.values(result.committed).every(Boolean);
  if (!passed) throw new Error(`真实 pointer capture 吸附失败：${JSON.stringify(result)}`);
}
