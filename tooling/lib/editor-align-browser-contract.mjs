import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const p95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

function frameLeft(mount, record) {
  const node = mount.querySelector(`[data-edit-id="${record.id}"]`);
  const base = node?.querySelector(':scope > g[transform]');
  const matrix = base?.getScreenCTM();
  if (!matrix) throw new Error(`浏览器对齐缺少元素框 CTM：${record.id}`);
  return Math.min(...[
    new DOMPoint(0, 0), new DOMPoint(record.src.w, 0),
    new DOMPoint(record.src.w, record.src.h), new DOMPoint(0, record.src.h),
  ].map((point) => point.matrixTransform(matrix).x));
}

/** 浏览器 CTM 是模型矩阵之外的 ground truth，同时测量完整同步 DOM 反馈。 */
export async function runEditorAlignBrowserContract({ openEditor, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const session = await openEditor(await load('sample-editor-align.pptx'), {
    idPrefix: 'browser-align-geometry-',
  });
  let geometryError = 0;
  let geometryDetail = '';
  try {
    session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const byName = (name) => Object.values(session.editor.doc.elements)
      .find((record) => record.src.name === name);
    const plain = byName('align-plain');
    const rotated = byName('align-rotated');
    const leaf = byName('align-group-leaf');
    session.editor.exec({ type: 'AlignElements', ids: [plain.id, rotated.id], edge: 'left' });
    mount.querySelector('svg')?.getBoundingClientRect();
    const plainRotated = [frameLeft(mount, plain), frameLeft(mount, rotated)];
    geometryError = Math.abs(plainRotated[0] - plainRotated[1]);
    session.editor.exec({ type: 'AlignElements', ids: [plain.id, leaf.id], edge: 'left' });
    mount.querySelector('svg')?.getBoundingClientRect();
    const plainLeaf = [frameLeft(mount, plain), frameLeft(mount, leaf)];
    geometryError = Math.max(geometryError, Math.abs(plainLeaf[0] - plainLeaf[1]));
    geometryDetail = JSON.stringify({ plainRotated, plainLeaf });
    if (geometryError > 0.5) {
      throw new Error(`旋转/组合视觉对齐偏差 ${geometryError.toFixed(3)}px：${geometryDetail}`);
    }
  } finally {
    session.dispose();
    mount.replaceChildren();
  }

  const perfSession = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-align-perf-',
  });
  try {
    const view = perfSession.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const ids = [...perfSession.editor.doc.slides[view.slideId].children];
    perfSession.editor.select({ kind: 'elements', ids, enteredGroup: null });
    const staticLayer = mount.querySelector('[data-ppt-layer="static"]');
    const samples = [];
    for (let index = 0; index < 80; index++) {
      const started = performance.now();
      perfSession.editor.exec({ type: 'AlignElements', ids, edge: 'left' });
      staticLayer?.querySelector('svg')?.getBoundingClientRect();
      samples.push(performance.now() - started);
      perfSession.editor.undo();
      staticLayer?.querySelector('svg')?.getBoundingClientRect();
    }
    const alignP95 = p95(samples);
    if (ids.length !== 60
      || mount.querySelector('[data-ppt-layer="static"]') !== staticLayer
      || perfSession.editor.isDirty() || perfSession.editor.history.undoCount !== 0) {
      throw new Error('60 元素完整 DOM 对齐后的 DOM 或历史状态不稳定');
    }
    recordPerformanceBudget('60 元素完整 DOM 对齐反馈 p95', alignP95, 8);
    return { geometryError, p95: alignP95 };
  } finally {
    perfSession.dispose();
    mount.remove();
  }
}
