import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);

/** 外置属性面板只依赖公开查询/命令；效果 defs 与 markup 必须原子增量换代。 */
export async function runShapeEffectsEditorContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 二维效果公开工具栏 seam 与增量 DOM\x1b[0m');
  if (!check('editor 发布入口公开二维效果查询',
    typeof lib.queryElementEffects === 'function')) return;
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-effects.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-effects-' });
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  const unrelatedMount = document.createElement('div');
  const editView = session.mount(editMount, { mode: 'edit', textMode: 'svg', snapping: false });
  const viewView = session.mount(viewMount, { mode: 'view', textMode: 'svg', snapping: false });
  const unrelatedView = session.mount(unrelatedMount, {
    slideId: session.editor.doc.slideOrder[1], mode: 'view', textMode: 'svg', snapping: false,
  });
  const target = byName(session.editor.doc, 'effects-rich');
  const sibling = byName(session.editor.doc, 'effects-explicit-empty');
  const picture = byName(session.editor.doc, 'effects-picture');
  const group = byName(session.editor.doc, 'effects-group');
  if (!check('效果视图目标映射为公开 EditDoc 身份',
    !!target && !!sibling && !!picture && !!group)) {
    session.dispose();
    return;
  }
  const editStatic = editMount.querySelector('[data-ppt-layer="static"]');
  const viewStatic = viewMount.querySelector('[data-ppt-layer="static"]');
  const editSvg = editStatic.querySelector('svg');
  const viewSvg = viewStatic.querySelector('svg');
  const unrelatedStatic = unrelatedMount.querySelector('[data-ppt-layer="static"]');
  const unrelatedSvg = unrelatedStatic.querySelector('svg');
  const unrelated = byName(session.editor.doc, 'effects-unrelated-page');
  const unrelatedElement = unrelatedStatic.querySelector(`[data-edit-id="${unrelated.id}"]`);
  const editTarget = editStatic.querySelector(`[data-edit-id="${target.id}"]`);
  const viewTarget = viewStatic.querySelector(`[data-edit-id="${target.id}"]`);
  const editSibling = editStatic.querySelector(`[data-edit-id="${sibling.id}"]`);
  const viewSibling = viewStatic.querySelector(`[data-edit-id="${sibling.id}"]`);
  session.editor.exec({
    type: 'SetEffects', id: target.id,
    effects: {
      shadow: { dx: 6, dy: 5, blur: 7, color: 'rgba(15,23,42,0.6)' },
      glow: { radius: 8, color: '#F97316' }, softEdge: 2,
      reflection: { alpha: 0.55, size: 0.5, distance: 4 },
    },
  });
  const state = lib.queryElementEffects(session.editor.doc, [target.id]);
  const targetAfter = editStatic.querySelector(`[data-edit-id="${target.id}"]`);
  const targetDefs = editStatic.querySelectorAll(`[data-edit-defs="${target.id}"]`);
  check('外置工具栏提交四类效果后编辑/查看视图只替换目标分区',
    state.direct && !state.mixed && state.value.reflection?.size === 0.5
      && targetAfter !== editTarget
      && viewStatic.querySelector(`[data-edit-id="${target.id}"]`) !== viewTarget
      && editStatic.querySelector(`[data-edit-id="${sibling.id}"]`) === editSibling
      && viewStatic.querySelector(`[data-edit-id="${sibling.id}"]`) === viewSibling
      && editStatic.querySelector('svg') === editSvg && viewStatic.querySelector('svg') === viewSvg
      && unrelatedStatic.querySelector('svg') === unrelatedSvg
      && unrelatedStatic.querySelector(`[data-edit-id="${unrelated.id}"]`) === unrelatedElement
      && viewMount.querySelector('[data-ppt-layer="interaction"]').style.display === 'none');
  check('filter、mask 与 reflection use 在同一目标 defs 分区原子换代',
    targetDefs.length >= 3
      && !!targetAfter.querySelector('[filter^="url("]')
      && !!targetAfter.querySelector('[mask^="url("]')
      && !!targetAfter.querySelector('use'));

  const pictureBefore = editStatic.querySelector(`[data-edit-id="${picture.id}"]`);
  const groupBefore = editStatic.querySelector(`[data-edit-id="${group.id}"]`);
  const targetStable = editStatic.querySelector(`[data-edit-id="${target.id}"]`);
  session.editor.exec(
    { type: 'SetEffects', id: picture.id, effects: { glow: { radius: 5, color: '#2563EB' } } },
    { type: 'SetEffects', id: group.id, effects: { softEdge: 1 } },
  );
  check('图片与组合效果复用同一分区更新且保留无关目标身份',
    editStatic.querySelector(`[data-edit-id="${picture.id}"]`) !== pictureBefore
      && editStatic.querySelector(`[data-edit-id="${group.id}"]`) !== groupBefore
      && editStatic.querySelector(`[data-edit-id="${target.id}"]`) === targetStable
      && editStatic.querySelector('svg') === editSvg);
  editView.destroy();
  viewView.destroy();
  unrelatedView.destroy();
  session.dispose();

  const perfBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-60.pptx')));
  const perfSession = await lib.openEditor(perfBytes, { idPrefix: 'editor-effects-perf-' });
  const perfMount = document.createElement('div');
  const perfView = perfSession.mount(perfMount, { mode: 'edit', textMode: 'svg', snapping: false });
  const roots = perfSession.editor.doc.slides[perfView.slideId].children;
  const [perfTarget, perfSibling] = roots;
  const perfStatic = perfMount.querySelector('[data-ppt-layer="static"]');
  const stableSibling = perfStatic.querySelector(`[data-edit-id="${perfSibling}"]`);
  const stableSvg = perfStatic.querySelector('svg');
  let allDirty = true;
  const effectCases = [
    ['阴影', (index) => ({ shadow: {
      dx: index % 2 ? 3 : 4, dy: 3, blur: 5, color: '#334155',
    } })],
    ['发光', (index) => ({ glow: {
      radius: index % 2 ? 4 : 5, color: '#0284C7',
    } })],
    ['柔边', (index) => ({ softEdge: index % 2 ? 1 : 2 })],
    ['倒影', (index) => ({ reflection: {
      alpha: index % 2 ? 0.5 : 0.6, size: 0.6, distance: 2,
    } })],
  ];
  const p95s = effectCases.map(([name, effects]) => {
    const samples = [];
    for (let index = 0; index < 80; index++) {
      const started = performance.now();
      const result = perfSession.editor.exec({
        type: 'SetEffects', id: perfTarget, effects: effects(index),
      });
      samples.push(performance.now() - started);
      allDirty &&= result.dirtyElements.has(perfTarget);
    }
    samples.sort((left, right) => left - right);
    return [name, samples[Math.floor(samples.length * 0.95)]];
  });
  check('60 元素页四类非 no-op 效果各自提交到 DOM 的 p95 不超过 16ms',
    allDirty && roots.length === 60 && p95s.every(([, p95]) => p95 <= 16)
      && perfStatic.querySelector(`[data-edit-id="${perfSibling}"]`) === stableSibling
      && perfStatic.querySelector('svg') === stableSvg,
  p95s.map(([name, p95]) => `${name}=${p95.toFixed(3)}`).join('/') + 'ms');
  console.log(`  60 元素 · ${p95s.map(([name, p95]) => `${name} p95 ${p95.toFixed(3)}ms`).join(' · ')}`);
  perfSession.dispose();
}
