/** 真实浏览器验证 60 元素组合/解组完整反馈预算与可信快捷键。 */
import { keyboardEvent } from './keyboard-event.mjs';
import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const p95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

export async function runEditorGroupBrowserContract({ openEditor, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const session = await openEditor(await load('sample-editor-layer.pptx'), {
    idPrefix: 'browser-group-perf-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const roots = [...session.editor.doc.slides[view.slideId].children];
    const ids = roots.filter((id) => session.editor.doc.elements[id].meta.editable !== 'none');
    const untouchedId = roots.find((id) => !ids.includes(id));
    const untouched = mount.querySelector(`[data-edit-root="${untouchedId}"]`);
    const svg = mount.querySelector('[data-ppt-layer="static"] svg');
    const groupSamples = [];
    const ungroupSamples = [];
    let correct = ids.length === 60 && !!untouched;
    for (let index = 0; index < 45; index++) {
      session.editor.select({ kind: 'elements', ids, enteredGroup: null });
      let started = performance.now();
      correct &&= !view.element.dispatchEvent(keyboardEvent('keydown', 'g', { ctrlKey: true }));
      const groupedSelection = session.editor.selection;
      const groupId = groupedSelection.kind === 'elements' ? groupedSelection.ids[0] : null;
      const groupNode = mount.querySelector(`[data-edit-root="${groupId}"]`);
      groupNode?.getBoundingClientRect();
      const groupElapsed = performance.now() - started;
      if (index >= 5) groupSamples.push(groupElapsed);
      correct &&= groupedSelection.kind === 'elements' && groupedSelection.ids.length === 1
        && session.editor.doc.elements[groupId]?.children?.join(',') === ids.join(',')
        && ids.every((id) => groupNode?.contains(mount.querySelector(`[data-edit-root="${id}"]`)));

      started = performance.now();
      correct &&= !view.element.dispatchEvent(keyboardEvent('keydown', 'G', {
        ctrlKey: true, shiftKey: true,
      }));
      const ungroupedSelection = session.editor.selection;
      svg?.getBoundingClientRect();
      const ungroupElapsed = performance.now() - started;
      if (index >= 5) ungroupSamples.push(ungroupElapsed);
      correct &&= !session.editor.doc.elements[groupId]
        && ungroupedSelection.kind === 'elements'
        && ungroupedSelection.ids.join(',') === ids.join(',')
        && ids.every((id) => mount.querySelectorAll(`[data-edit-root="${id}"]`).length === 1)
        && !mount.querySelector(`[data-edit-root="${groupId}"]`);
      session.editor.history.clear();
      session.editor.markSaved();
    }
    const result = { groupP95: p95(groupSamples), ungroupP95: p95(ungroupSamples) };
    correct &&= mount.querySelector(`[data-edit-root="${untouchedId}"]`) === untouched
      && mount.querySelector('[data-ppt-layer="static"] svg') === svg
      && session.editor.doc.slides[view.slideId].children.join(',') === roots.join(',')
      && session.editor.history.undoCount === 0 && session.editor.history.redoCount === 0
      && !session.editor.isDirty();
    if (!correct) throw new Error('60 元素组合/解组最终状态不一致');
    recordPerformanceBudget('60 元素组合 p95', result.groupP95, 8);
    recordPerformanceBudget('60 元素解组 p95', result.ungroupP95, 8);
    return result;
  } finally {
    session.dispose();
    mount.remove();
  }
}

export async function runTrustedGroupContract({ evaluate, dispatchKey }) {
  await evaluate(`(() => {
    const { trustedGroupSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    trustedGroupSession.editor.history.clear();
    trustedGroupSession.editor.markSaved();
    const view = trustedGroupSession.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const named = Object.values(trustedGroupSession.editor.doc.elements);
    const ids = ['space-plain', 'space-rotated-flipped']
      .map((name) => named.find((record) => record.src.name === name).id);
    trustedGroupSession.editor.select({ kind: 'elements', ids, enteredGroup: null });
    const svg = mount.querySelector('[data-ppt-layer="static"] svg');
    const events = [];
    view.element.addEventListener('keydown', (event) => {
      if (event.code === 'KeyG') events.push({
        key: event.key, trusted: event.isTrusted, prevented: event.defaultPrevented,
        ctrl: event.ctrlKey, shift: event.shiftKey,
      });
    });
    view.element.focus({ preventScroll: true });
    globalThis.trustedGroupContract = { view, ids, svg, events };
  })()`);
  await dispatchKey('g', 'KeyG', 71, 2);
  const grouped = await evaluate(`(() => {
    const state = globalThis.trustedGroupContract;
    const { trustedGroupSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const selection = trustedGroupSession.editor.selection;
    const groupId = selection.kind === 'elements' ? selection.ids[0] : null;
    state.groupId = groupId;
    const group = mount.querySelector('[data-edit-root="' + groupId + '"]');
    return {
      selected: selection.kind === 'elements' && selection.ids.length === 1,
      grouped: trustedGroupSession.editor.doc.elements[groupId]?.children.join(',') === state.ids.join(','),
      nested: state.ids.every((id) => group?.contains(mount.querySelector('[data-edit-root="' + id + '"]'))),
      oneHistory: trustedGroupSession.editor.history.undoCount === 1,
      svgStable: mount.querySelector('[data-ppt-layer="static"] svg') === state.svg,
      focused: document.activeElement === state.view.element,
    };
  })()`);
  await dispatchKey('G', 'KeyG', 71, 10);
  const ungrouped = await evaluate(`(() => {
    const state = globalThis.trustedGroupContract;
    const { trustedGroupSession } = globalThis.editorContract;
    const mount = document.querySelector('#mount');
    const selection = trustedGroupSession.editor.selection;
    const result = {
      removed: !trustedGroupSession.editor.doc.elements[state.groupId]
        && !mount.querySelector('[data-edit-root="' + state.groupId + '"]'),
      selected: selection.kind === 'elements' && selection.ids.join(',') === state.ids.join(','),
      unique: state.ids.every((id) => mount.querySelectorAll('[data-edit-root="' + id + '"]').length === 1),
      twoHistory: trustedGroupSession.editor.history.undoCount === 2,
      svgStable: mount.querySelector('[data-ppt-layer="static"] svg') === state.svg,
      focused: document.activeElement === state.view.element,
      events: state.events,
    };
    trustedGroupSession.editor.undo();
    trustedGroupSession.editor.undo();
    trustedGroupSession.editor.history.clear();
    trustedGroupSession.editor.markSaved();
    state.view.destroy();
    delete globalThis.trustedGroupContract;
    return result;
  })()`);
  const eventsCorrect = ungrouped.events.length === 2
    && ungrouped.events.every((event) => event.trusted && event.prevented && event.ctrl)
    && ungrouped.events[0].key === 'g' && !ungrouped.events[0].shift
    && ungrouped.events[1].key === 'G' && ungrouped.events[1].shift;
  if (!Object.values(grouped).every(Boolean)
    || !Object.entries(ungrouped).filter(([key]) => key !== 'events').every(([, value]) => value)
    || !eventsCorrect) {
    throw new Error(`真实 Ctrl+G / Ctrl+Shift+G 失败：${JSON.stringify({ grouped, ungrouped, eventsCorrect })}`);
  }
}
