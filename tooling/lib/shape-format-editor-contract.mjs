import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);

/** 框架工具栏只调用公开命令/查询；编辑与查看视图共享同一条目标分区更新链路。 */
export async function runShapeFormatEditorContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 形状格式公开工具栏 seam 与增量 DOM\x1b[0m');
  if (!check('editor 发布入口公开填充/描边查询和标准图案目录',
    typeof lib.queryElementFill === 'function'
      && typeof lib.queryElementStroke === 'function'
      && Array.isArray(lib.SHAPE_PATTERN_PRESETS))) return;

  const bytes = new Uint8Array(readFileSync(
    join(root, 'fixtures/sample-editor-shape-format.pptx'),
  ));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-shape-format-' });
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  const editView = session.mount(editMount, { mode: 'edit', textMode: 'svg', snapping: false });
  const viewView = session.mount(viewMount, { mode: 'view', textMode: 'svg', snapping: false });
  const target = byName(session.editor.doc, 'format-inherited');
  const sibling = byName(session.editor.doc, 'format-pattern');
  const picture = byName(session.editor.doc, 'format-picture-border');
  if (!check('富格式视图目标均映射为公开 EditDoc 身份', !!target && !!sibling && !!picture)) {
    session.dispose();
    return;
  }
  const editStatic = editMount.querySelector('[data-ppt-layer="static"]');
  const viewStatic = viewMount.querySelector('[data-ppt-layer="static"]');
  const editSvg = editStatic.querySelector('svg');
  const viewSvg = viewStatic.querySelector('svg');
  const editTarget = editStatic.querySelector(`[data-edit-id="${target.id}"]`);
  const viewTarget = viewStatic.querySelector(`[data-edit-id="${target.id}"]`);
  const editSibling = editStatic.querySelector(`[data-edit-id="${sibling.id}"]`);
  const viewSibling = viewStatic.querySelector(`[data-edit-id="${sibling.id}"]`);
  let toolbarState = null;
  const unsubscribe = session.editor.subscribe((change) => {
    if (change.touchedElements.has(target.id)) {
      toolbarState = lib.queryElementFill(session.editor.doc, [target.id]);
    }
  });
  session.editor.exec({
    type: 'SetFill', id: target.id,
    fill: {
      type: 'gradient', angle: 45, radial: false,
      stops: [{ pos: 0, color: '#38BDF8' }, { pos: 1, color: '#6366F1' }],
    },
  });
  check('外置工具栏提交填充后编辑/查看视图只替换目标分区',
    toolbarState?.direct === true && toolbarState.value?.type === 'gradient'
      && editStatic.querySelector(`[data-edit-id="${target.id}"]`) !== editTarget
      && viewStatic.querySelector(`[data-edit-id="${target.id}"]`) !== viewTarget
      && editStatic.querySelector(`[data-edit-id="${sibling.id}"]`) === editSibling
      && viewStatic.querySelector(`[data-edit-id="${sibling.id}"]`) === viewSibling
      && editStatic.querySelector('svg') === editSvg && viewStatic.querySelector('svg') === viewSvg
      && viewMount.querySelector('[data-ppt-layer="interaction"]').style.display === 'none');
  check('渐变 defs 随目标分区换代且不泄漏到兄弟分区',
    editStatic.querySelectorAll(`[data-edit-defs="${target.id}"]`).length > 0
      && editStatic.querySelectorAll(`[data-edit-defs="${sibling.id}"]`).length === 0);

  const pictureBefore = editStatic.querySelector(`[data-edit-id="${picture.id}"]`);
  const targetAfterFill = editStatic.querySelector(`[data-edit-id="${target.id}"]`);
  session.editor.exec({
    type: 'SetStroke', id: picture.id,
    stroke: { color: '#F97316', width: 3, dash: [12, 9], cap: 'round', join: 'bevel' },
  });
  const strokeState = lib.queryElementStroke(session.editor.doc, [picture.id]);
  check('图片描边复用同一分区更新并保留无关形状身份',
    strokeState.direct && strokeState.value?.color === 'rgb(249,115,22)'
      && editStatic.querySelector(`[data-edit-id="${picture.id}"]`) !== pictureBefore
      && editStatic.querySelector(`[data-edit-id="${target.id}"]`) === targetAfterFill
      && editStatic.querySelector('svg') === editSvg);

  unsubscribe();
  editView.destroy();
  viewView.destroy();
  session.dispose();

  const perfBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-60.pptx')));
  const perfSession = await lib.openEditor(perfBytes, { idPrefix: 'editor-shape-format-perf-' });
  const perfMount = document.createElement('div');
  const perfView = perfSession.mount(perfMount, { mode: 'edit', textMode: 'svg' });
  const roots = perfSession.editor.doc.slides[perfView.slideId].children;
  const [perfTarget, perfSibling] = roots;
  const perfStatic = perfMount.querySelector('[data-ppt-layer="static"]');
  const stableSibling = perfStatic.querySelector(`[data-edit-id="${perfSibling}"]`);
  const fillSamples = [];
  const strokeSamples = [];
  let allDirty = true;
  for (let index = 0; index < 80; index++) {
    const started = performance.now();
    const strokeRound = index % 2 === 1;
    const result = perfSession.editor.exec(strokeRound
      ? {
        type: 'SetStroke', id: perfTarget,
        stroke: {
          color: index % 4 === 1 ? '#0EA5E9' : '#F97316', width: 1, dash: null,
        },
      }
      : {
        type: 'SetFill', id: perfTarget,
        fill: { type: 'solid', color: index % 4 ? '#E0F2FE' : '#FFEDD5' },
      });
    allDirty = allDirty && result.dirtyElements.has(perfTarget);
    (strokeRound ? strokeSamples : fillSamples).push(performance.now() - started);
  }
  const p95 = (samples) => {
    samples.sort((left, right) => left - right);
    return samples[Math.floor(samples.length * 0.95)];
  };
  const fillP95 = p95(fillSamples);
  const strokeP95 = p95(strokeSamples);
  check('60 元素页填充与描边提交到 DOM 的 p95 均不超过 16ms',
    allDirty && roots.length === 60 && Math.max(fillP95, strokeP95) <= 16
      && perfStatic.querySelector(`[data-edit-id="${perfSibling}"]`) === stableSibling,
  `fill/stroke=${fillP95.toFixed(3)}/${strokeP95.toFixed(3)}ms`);
  console.log(`  60 元素 · 填充/描边提交 p95 ${fillP95.toFixed(3)}/${strokeP95.toFixed(3)}ms`);
  perfSession.dispose();
}
