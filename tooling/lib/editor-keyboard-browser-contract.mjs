/** Chrome 的 getScreenCTM 是嵌套组键盘微移在屏幕空间里的独立坐标 oracle。 */
import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const key = (type, value, init = {}) => new KeyboardEvent(type, {
  key: value, bubbles: true, cancelable: true, ...init,
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
  if (!record) throw new Error(`键盘固件缺少 ${name}`);
  return record;
}

function screenCorners(mount, session, record) {
  const target = mount.querySelector(`[data-edit-id="${record.id}"]`);
  const matrix = target?.querySelector(':scope > g[transform]')?.getScreenCTM();
  if (!matrix) throw new Error(`无法取得 ${record.src.name} 的屏幕矩阵`);
  const frame = session.editor.effectiveElement(record.id);
  return [
    new DOMPoint(0, 0), new DOMPoint(frame.w, 0),
    new DOMPoint(frame.w, frame.h), new DOMPoint(0, frame.h),
  ].map((point) => point.matrixTransform(matrix));
}

function translationError(before, after, expected) {
  return Math.max(...after.map((point, index) => Math.hypot(
    point.x - before[index].x - expected.x,
    point.y - before[index].y - expected.y,
  )));
}

async function geometryContract(openEditor, load) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-keyboard.pptx'), {
    idPrefix: 'browser-keyboard-accuracy-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const plain = byName(session, 'nudge-plain');
    const rotated = byName(session, 'nudge-rotated-flipped');
    const leaf = byName(session, 'nudge-nested-leaf');
    const cases = [
      {
        records: [leaf], enteredGroup: leaf.parent, key: 'ArrowRight', shiftKey: false,
        delta: { x: 1, y: 0 },
      },
      {
        records: [plain, rotated], enteredGroup: null, key: 'ArrowDown', shiftKey: true,
        delta: { x: 0, y: 10 },
      },
    ];
    let error = 0;
    for (const zoom of [0.5, 1, 2]) {
      view.setZoom(zoom);
      for (const testCase of cases) {
        const ids = testCase.records.map((record) => record.id);
        session.editor.select({ kind: 'elements', ids, enteredGroup: testCase.enteredGroup });
        const before = testCase.records.map((record) => screenCorners(mount, session, record));
        const staticSvg = mount.querySelector('[data-ppt-layer="static"] svg');
        const defs = staticSvg.querySelector('defs');
        const accepted = view.element.dispatchEvent(key('keydown', testCase.key, {
          shiftKey: testCase.shiftKey,
        }));
        view.element.dispatchEvent(key('keyup', testCase.key));
        const after = testCase.records.map((record) => screenCorners(mount, session, record));
        const expected = { x: testCase.delta.x * zoom, y: testCase.delta.y * zoom };
        error = Math.max(error, ...after.map((points, index) =>
          translationError(before[index], points, expected)));
        const selection = session.editor.selection;
        if (accepted || selection.kind !== 'elements' || selection.ids.join(',') !== ids.join(',')
          || selection.enteredGroup !== testCase.enteredGroup
          || session.editor.history.undoCount !== 1
          || mount.querySelector('[data-ppt-layer="static"] svg') !== staticSvg
          || staticSvg.querySelector('defs') !== defs) {
          throw new Error(`zoom ${zoom} 键盘微移破坏选区、历史或静态 SVG 分区：`
            + `accepted=${accepted} selection=${selection.kind === 'elements'
              ? `${selection.ids.join(',')}@${selection.enteredGroup}` : selection.kind} `
            + `expected=${ids.join(',')}@${testCase.enteredGroup} history=${session.editor.history.undoCount} `
            + `svg=${mount.querySelector('[data-ppt-layer="static"] svg') === staticSvg} `
            + `defs=${staticSvg.querySelector('defs') === defs}`);
        }
        session.editor.undo();
      }
    }
    if (error > 0.5) throw new Error(`三档缩放键盘微移屏幕偏差 ${error.toFixed(3)}px`);
    return error;
  } finally {
    session.dispose();
    mount.remove();
  }
}

async function performanceContract(openEditor, load) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-keyboard-perf-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const ids = session.editor.doc.slides[view.slideId].children;
    session.editor.select({ kind: 'elements', ids, enteredGroup: null });
    const sources = ids.map((id) => session.editor.effectiveElement(id));
    const samples = [];
    for (let index = 0; index < 80; index++) {
      const arrow = index % 2 ? 'ArrowLeft' : 'ArrowRight';
      const started = performance.now();
      view.element.dispatchEvent(key('keydown', arrow));
      view.element.dispatchEvent(key('keyup', arrow));
      mount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    const pressP95 = samples[Math.floor(samples.length * 0.95)];
    const restored = ids.every((id, index) => {
      const current = session.editor.effectiveElement(id);
      return current.x === sources[index].x && current.y === sources[index].y;
    });
    if (ids.length !== 60 || !restored
      || session.editor.history.undoCount !== samples.length
      || session.editor.selection.kind !== 'elements'
      || session.editor.selection.ids.length !== 60) {
      throw new Error('60 元素独立键盘提交的模型或历史不一致');
    }
    recordPerformanceBudget('60 元素独立键盘提交 p95', pressP95, 16);

    session.editor.history.clear();
    const repeatSamples = [];
    for (let index = 0; index < 120; index++) {
      const started = performance.now();
      view.element.dispatchEvent(key('keydown', 'ArrowRight', { repeat: index > 0 }));
      mount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
      repeatSamples.push(performance.now() - started);
    }
    view.element.dispatchEvent(key('keyup', 'ArrowRight'));
    repeatSamples.sort((left, right) => left - right);
    const repeatP95 = repeatSamples[Math.floor(repeatSamples.length * 0.95)];
    const entry = session.editor.history.undoEntries[0];
    const repeated = ids.every((id, index) => {
      const current = session.editor.effectiveElement(id);
      return current.x === sources[index].x + 120 && current.y === sources[index].y;
    });
    const compact = session.editor.history.undoCount === 1
      && entry?.forward.length === 60 && entry?.inverse.length === 60;
    session.editor.undo();
    const repeatRestored = ids.every((id, index) => {
      const current = session.editor.effectiveElement(id);
      return current.x === sources[index].x && current.y === sources[index].y;
    });
    if (!repeated || !compact || !repeatRestored) {
      throw new Error(`60 元素连续 auto-repeat 压缩/撤销失败：compact=${compact} restored=${repeatRestored}`);
    }
    recordPerformanceBudget('60 元素连续 auto-repeat p95', repeatP95, 16);
    return Math.max(pressP95, repeatP95);
  } finally {
    session.dispose();
    mount.remove();
  }
}

export async function runEditorKeyboardBrowserContract({ openEditor, load }) {
  return {
    geometryError: await geometryContract(openEditor, load),
    p95: await performanceContract(openEditor, load),
  };
}
