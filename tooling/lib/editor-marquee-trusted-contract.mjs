/** CDP 真实鼠标事件证明空白按下后由画布持有 pointer capture。 */
export async function runTrustedMarqueeContract({ evaluate, trustedMouseGesture }) {
  const points = await evaluate(`(() => {
    const { trustedMarqueeSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const view = trustedMarqueeSession.mount(mount, {
      mode: 'edit', textMode: 'svg', zoom: 0.75,
    });
    const records = Object.values(trustedMarqueeSession.editor.doc.elements);
    const target = records.find((candidate) => candidate.src.name === 'marquee-plain');
    const prior = records.find((candidate) => candidate.src.name === 'marquee-rotated-flipped');
    trustedMarqueeSession.editor.select({ kind: 'elements', ids: [prior.id], enteredGroup: null });
    mount.scrollIntoView({ block: 'start', inline: 'start' });
    const interaction = mount.querySelector('svg[data-ppt-layer="interaction"]');
    const matrix = interaction.getScreenCTM();
    const start = new DOMPoint(80, 80).matrixTransform(matrix);
    const end = new DOMPoint(240, 200).matrixTransform(matrix);
    globalThis.trustedMarqueeContract = {
      view, targetId: target.id, priorId: prior.id,
      target: mount.querySelector('[data-edit-id="' + target.id + '"]'),
      svg: mount.querySelector('[data-ppt-layer="static"] svg'),
      defs: mount.querySelector('[data-ppt-layer="static"] defs'),
      historyBefore: trustedMarqueeSession.editor.history.undoCount,
    };
    return {
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
    };
  })()`);
  const result = await trustedMouseGesture(points.start, points.end, `(() => {
    const state = globalThis.trustedMarqueeContract;
    const { trustedMarqueeSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const selection = trustedMarqueeSession.editor.selection;
    const candidate = mount.querySelector('[data-edit-marquee-candidate="' + state.targetId + '"]');
    return {
      captured: state.view.element.hasPointerCapture(1),
      rubberBand: !!mount.querySelector('[data-edit-marquee-frame]'),
      candidate: candidate && candidate.getAttribute('display') !== 'none',
      modelStable: selection.kind === 'elements' && selection.ids[0] === state.priorId,
      noHistory: trustedMarqueeSession.editor.history.undoCount === state.historyBefore,
      targetStable: mount.querySelector('[data-edit-id="' + state.targetId + '"]') === state.target,
      svgStable: mount.querySelector('[data-ppt-layer="static"] svg') === state.svg,
      defsStable: mount.querySelector('[data-ppt-layer="static"] defs') === state.defs,
    };
  })()`, `(() => {
    const state = globalThis.trustedMarqueeContract;
    const { trustedMarqueeSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const selection = trustedMarqueeSession.editor.selection;
    const result = {
      captureReleased: !state.view.element.hasPointerCapture(1),
      selected: selection.kind === 'elements' && selection.ids.length === 1
        && selection.ids[0] === state.targetId && selection.enteredGroup === null,
      noHistory: trustedMarqueeSession.editor.history.undoCount === state.historyBefore,
      previewGone: !mount.querySelector('[data-edit-marquee-layer]'),
      targetStable: mount.querySelector('[data-edit-id="' + state.targetId + '"]') === state.target,
      svgStable: mount.querySelector('[data-ppt-layer="static"] svg') === state.svg,
      defsStable: mount.querySelector('[data-ppt-layer="static"] defs') === state.defs,
    };
    state.view.destroy();
    trustedMarqueeSession.dispose();
    delete globalThis.trustedMarqueeContract;
    return result;
  })()`);
  const passed = Object.values(result.during).every(Boolean)
    && Object.values(result.committed).every(Boolean);
  if (!passed) throw new Error(`真实 pointer capture 框选失败：${JSON.stringify(result)}`);
}
