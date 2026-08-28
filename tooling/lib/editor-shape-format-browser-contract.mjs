import { queryElementFill, queryElementStroke } from '/out/editor/editor.mjs';
import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);

/** 真实浏览器守住渐变/图片描边上屏、查看视图同步与 60 元素提交预算。 */
export async function runEditorShapeFormatBrowserContract({ openEditor, load }) {
  const mount = document.createElement('div');
  const viewMount = document.createElement('div');
  mount.className = viewMount.className = 'contract-offscreen';
  document.body.append(mount, viewMount);
  const session = await openEditor(await load('sample-editor-shape-format.pptx'), {
    idPrefix: 'browser-shape-format-',
  });
  const editView = session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
  const viewView = session.mount(viewMount, { mode: 'view', textMode: 'svg', snapping: false });
  const target = byName(session.editor.doc, 'format-inherited');
  const sibling = byName(session.editor.doc, 'format-pattern');
  const picture = byName(session.editor.doc, 'format-picture-border');
  if (!target || !sibling || !picture) throw new Error('形状格式浏览器固件缺少稳定元素');
  const editStatic = mount.querySelector('[data-ppt-layer="static"]');
  const viewStatic = viewMount.querySelector('[data-ppt-layer="static"]');
  const editSvg = editStatic.querySelector('svg');
  const viewSvg = viewStatic.querySelector('svg');
  const editTarget = editStatic.querySelector(`[data-edit-id="${target.id}"]`);
  const viewTarget = viewStatic.querySelector(`[data-edit-id="${target.id}"]`);
  const editSibling = editStatic.querySelector(`[data-edit-id="${sibling.id}"]`);
  const viewSibling = viewStatic.querySelector(`[data-edit-id="${sibling.id}"]`);
  session.editor.exec({
    type: 'SetFill', id: target.id,
    fill: {
      type: 'gradient', angle: 45,
      stops: [{ pos: 0, color: '#0EA5E9' }, { pos: 1, color: '#8B5CF6' }],
    },
  });
  const fillState = queryElementFill(session.editor.doc, [target.id]);
  const fillNode = editStatic.querySelector(`[data-edit-id="${target.id}"]`);
  const gradient = editStatic.querySelector(`[data-edit-defs="${target.id}"]`);
  const fillEvidence = {
    direct: fillState.direct,
    gradientValue: fillState.value?.type === 'gradient',
    gradientDef: gradient?.querySelectorAll('stop').length === 2,
    gradientUse: !!fillNode?.querySelector('[fill^="url("]'),
    editReplaced: fillNode !== editTarget,
    viewReplaced: viewStatic.querySelector(`[data-edit-id="${target.id}"]`) !== viewTarget,
    editSiblingStable: editStatic.querySelector(`[data-edit-id="${sibling.id}"]`) === editSibling,
    viewSiblingStable: viewStatic.querySelector(`[data-edit-id="${sibling.id}"]`) === viewSibling,
    editSvgStable: editStatic.querySelector('svg') === editSvg,
    viewSvgStable: viewStatic.querySelector('svg') === viewSvg,
    viewHidden: getComputedStyle(viewMount.querySelector('[data-ppt-layer="interaction"]')).display === 'none',
    fillMarkup: fillNode?.innerHTML.slice(0, 300),
  };
  if (!Object.entries(fillEvidence).filter(([key]) => key !== 'fillMarkup')
    .every(([, value]) => value)) {
    throw new Error(`Chrome 渐变上屏、查看视图同步或增量 DOM 身份失败：${JSON.stringify(fillEvidence)}`);
  }

  const pictureBefore = editStatic.querySelector(`[data-edit-id="${picture.id}"]`);
  const fillAfter = editStatic.querySelector(`[data-edit-id="${target.id}"]`);
  session.editor.exec({
    type: 'SetStroke', id: picture.id,
    stroke: { color: '#F97316', width: 3, dash: [12, 9], cap: 'round', join: 'bevel' },
  });
  const strokeState = queryElementStroke(session.editor.doc, [picture.id]);
  const pictureAfter = editStatic.querySelector(`[data-edit-id="${picture.id}"]`);
  if (!strokeState.direct || strokeState.value?.color !== 'rgb(249,115,22)'
    || pictureAfter === pictureBefore || !pictureAfter?.querySelector('[stroke="rgb(249,115,22)"]')
    || editStatic.querySelector(`[data-edit-id="${target.id}"]`) !== fillAfter
    || editStatic.querySelector('svg') !== editSvg) {
    throw new Error('Chrome 图片描边上屏或无关分区身份失败');
  }
  session.dispose();
  mount.replaceChildren();
  viewMount.replaceChildren();

  const perfSession = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-shape-format-perf-',
  });
  const perfView = perfSession.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
  const roots = perfSession.editor.doc.slides[perfView.slideId].children;
  const [perfTarget, perfSibling] = roots;
  const perfStatic = mount.querySelector('[data-ppt-layer="static"]');
  const stableSibling = perfStatic.querySelector(`[data-edit-id="${perfSibling}"]`);
  const stableSvg = perfStatic.querySelector('svg');
  const fillSamples = [];
  const strokeSamples = [];
  for (let index = 0; index < 80; index++) {
    const started = performance.now();
    const strokeRound = index % 2 === 1;
    const result = perfSession.editor.exec(strokeRound
      ? {
        type: 'SetStroke', id: perfTarget,
        stroke: {
          color: index % 4 === 1 ? '#0369A1' : '#C2410C', width: 1, dash: null,
        },
      }
      : {
        type: 'SetFill', id: perfTarget,
        fill: { type: 'solid', color: index % 4 ? '#E0F2FE' : '#FFEDD5' },
      });
    if (!result.dirtyElements.has(perfTarget)) {
      throw new Error(`Chrome 第 ${index + 1} 次格式性能提交意外成为 no-op`);
    }
    (strokeRound ? strokeSamples : fillSamples).push(performance.now() - started);
  }
  const p95 = (samples) => {
    samples.sort((left, right) => left - right);
    return samples[Math.floor(samples.length * 0.95)];
  };
  const fillP95 = p95(fillSamples);
  const strokeP95 = p95(strokeSamples);
  if (roots.length !== 60
    || perfStatic.querySelector(`[data-edit-id="${perfSibling}"]`) !== stableSibling
    || perfStatic.querySelector('svg') !== stableSvg) {
    throw new Error('Chrome 60 元素填充/描边后的 DOM 身份不稳定');
  }
  recordPerformanceBudget('Chrome 60 元素填充 p95', fillP95, 16);
  recordPerformanceBudget('Chrome 60 元素描边 p95', strokeP95, 16);
  perfSession.dispose();
  mount.remove();
  viewMount.remove();
  console.info(`60 元素填充/描边提交 p95 ${fillP95.toFixed(3)}/${strokeP95.toFixed(3)}ms`);
}
