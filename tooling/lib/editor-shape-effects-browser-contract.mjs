import { queryElementEffects } from '/out/editor/editor.mjs';
import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);

/** 真实浏览器守住效果 filter/mask/use 上屏、双视图同步与 60 元素预算。 */
export async function runEditorShapeEffectsBrowserContract({ openEditor, load }) {
  const mount = document.createElement('div');
  const viewMount = document.createElement('div');
  const unrelatedMount = document.createElement('div');
  mount.className = viewMount.className = unrelatedMount.className = 'contract-offscreen';
  document.body.append(mount, viewMount, unrelatedMount);
  const session = await openEditor(await load('sample-editor-effects.pptx'), {
    idPrefix: 'browser-effects-',
  });
  session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
  session.mount(viewMount, { mode: 'view', textMode: 'svg', snapping: false });
  session.mount(unrelatedMount, {
    slideId: session.editor.doc.slideOrder[1], mode: 'view', textMode: 'svg', snapping: false,
  });
  const target = byName(session.editor.doc, 'effects-rich');
  const sibling = byName(session.editor.doc, 'effects-explicit-empty');
  if (!target || !sibling) throw new Error('二维效果 Chrome 固件缺少稳定元素');
  const editStatic = mount.querySelector('[data-ppt-layer="static"]');
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
  const state = queryElementEffects(session.editor.doc, [target.id]);
  const targetAfter = editStatic.querySelector(`[data-edit-id="${target.id}"]`);
  const ownedDefs = editStatic.querySelectorAll(`[data-edit-defs="${target.id}"]`);
  const evidence = {
    direct: state.direct,
    editReplaced: targetAfter !== editTarget,
    viewReplaced: viewStatic.querySelector(`[data-edit-id="${target.id}"]`) !== viewTarget,
    editSiblingStable: editStatic.querySelector(`[data-edit-id="${sibling.id}"]`) === editSibling,
    viewSiblingStable: viewStatic.querySelector(`[data-edit-id="${sibling.id}"]`) === viewSibling,
    editSvgStable: editStatic.querySelector('svg') === editSvg,
    viewSvgStable: viewStatic.querySelector('svg') === viewSvg,
    unrelatedSvgStable: unrelatedStatic.querySelector('svg') === unrelatedSvg,
    unrelatedElementStable:
      unrelatedStatic.querySelector(`[data-edit-id="${unrelated.id}"]`) === unrelatedElement,
    filter: !!targetAfter?.querySelector('[filter^="url("]'),
    mask: !!targetAfter?.querySelector('[mask^="url("]'),
    reflectionUse: !!targetAfter?.querySelector('use'),
    defs: ownedDefs.length >= 3,
    viewHidden: getComputedStyle(viewMount.querySelector('[data-ppt-layer="interaction"]')).display === 'none',
  };
  if (!Object.values(evidence).every(Boolean)) {
    throw new Error(`Chrome 二维效果上屏、双视图同步或增量身份失败：${JSON.stringify(evidence)}`);
  }
  session.dispose();
  mount.replaceChildren();
  viewMount.replaceChildren();
  unrelatedMount.replaceChildren();

  const perfSession = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-effects-perf-',
  });
  const perfView = perfSession.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
  const roots = perfSession.editor.doc.slides[perfView.slideId].children;
  const [perfTarget, perfSibling] = roots;
  const perfStatic = mount.querySelector('[data-ppt-layer="static"]');
  const stableSibling = perfStatic.querySelector(`[data-edit-id="${perfSibling}"]`);
  const stableSvg = perfStatic.querySelector('svg');
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
      if (!result.dirtyElements.has(perfTarget)) {
        throw new Error(`Chrome ${name}第 ${index + 1} 次性能提交意外成为 no-op`);
      }
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    return [name, samples[Math.floor(samples.length * 0.95)]];
  });
  if (roots.length !== 60
    || perfStatic.querySelector(`[data-edit-id="${perfSibling}"]`) !== stableSibling
    || perfStatic.querySelector('svg') !== stableSvg) {
    throw new Error('Chrome 60 元素二维效果后的 DOM 身份不稳定');
  }
  for (const [name, value] of p95s) recordPerformanceBudget(`Chrome 60 元素${name} p95`, value, 16);
  perfSession.dispose();
  mount.remove();
  viewMount.remove();
  unrelatedMount.remove();
  console.info(`60 元素 ${p95s.map(([name, p95]) => `${name} p95 ${p95.toFixed(3)}ms`).join(' · ')}`);
}
