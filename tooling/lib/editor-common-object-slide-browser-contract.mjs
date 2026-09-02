import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const percentile95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

function screenBounds(mount, editor, id) {
  const element = editor.effectiveElement(id);
  const node = mount.querySelector(`[data-edit-id="${id}"]`);
  const base = node?.querySelector(':scope > g[transform]');
  const matrix = base?.getScreenCTM();
  if (!matrix) throw new Error(`公共命令缺少浏览器 CTM：${id}`);
  const points = [
    new DOMPoint(0, 0), new DOMPoint(element.w, 0),
    new DOMPoint(element.w, element.h), new DOMPoint(0, element.h),
  ].map((point) => point.matrixTransform(matrix));
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

/** 真浏览器同时验证 adapter seam、旋转 AABB 视觉结果和同步 DOM 反馈预算。 */
export async function runEditorCommonObjectSlideBrowserContract({ createWebPptAdapter, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const adapter = createWebPptAdapter();
  adapter.setView({ mode: 'edit', textMode: 'svg', snapping: false });
  adapter.attach(mount);
  try {
    await adapter.setDocument({
      source: await load('sample-editor-common-commands.pptx'),
      openOptions: { idPrefix: 'browser-common-' },
    });
    const editor = adapter.snapshot.session.editor;
    const byName = (name) => Object.values(editor.doc.elements)
      .find((record) => record.src.name === name);
    const ids = ['common-left', 'common-middle-a', 'common-middle-b', 'common-right']
      .map((name) => byName(name).id);
    editor.select({ kind: 'elements', ids, enteredGroup: null });
    const history = editor.history.undoCount;
    if (!adapter.distributeElements('horizontal')) throw new Error('adapter 未执行选区分布');
    mount.querySelector('[data-ppt-layer="static"] svg')?.getBoundingClientRect();
    const bounds = ids.map((id) => screenBounds(mount, editor, id))
      .sort((left, right) => left.left - right.left);
    const gaps = bounds.slice(1).map((item, index) => item.left - bounds[index].right);
    const geometryError = Math.max(...gaps) - Math.min(...gaps);
    if (geometryError > 0.5 || editor.history.undoCount !== history + 1) {
      throw new Error(`浏览器水平分布视觉偏差 ${geometryError.toFixed(3)}px`);
    }
    adapter.undo();

    const samples = [];
    for (let index = 0; index < 80; index++) {
      const started = performance.now();
      adapter.distributeElements('horizontal', ids);
      mount.querySelector('[data-ppt-layer="static"] svg')?.getBoundingClientRect();
      samples.push(performance.now() - started);
      adapter.undo();
    }
    const distributionP95 = percentile95(samples);
    recordPerformanceBudget('Chrome 四对象分布完整反馈 p95', distributionP95, 16);

    const alt = byName('common-alt');
    editor.select({ kind: 'elements', ids: [alt.id], enteredGroup: null });
    const sections = adapter.listSections();
    if (!adapter.setAltText({ title: 'Chrome 标题', descr: 'Chrome 描述' })
      || adapter.queryAltText()?.descr !== 'Chrome 描述'
      || !adapter.renameSection(sections[0].id, 'Chrome 节')
      || adapter.listSections()[0].name !== 'Chrome 节') {
      throw new Error('真实 Chrome adapter 的替代文字或节反馈无效');
    }

    const geometry = JSON.stringify(Object.values(editor.doc.elements).map((record) => {
      const { x, y, w, h } = editor.effectiveElement(record.id);
      return [record.id, x, y, w, h];
    }));
    const sizeSamples = [];
    for (let index = 0; index < 80; index++) {
      const wide = index % 2 === 0;
      const started = performance.now();
      adapter.setSlideSize(wide ? { w: 1600, h: 900 } : { w: 1280, h: 720 });
      mount.querySelector('[data-ppt-stage]')?.getBoundingClientRect();
      sizeSamples.push(performance.now() - started);
    }
    adapter.setSlideSize({ w: 1600, h: 900 });
    const stage = mount.querySelector('[data-ppt-stage]');
    const interaction = mount.querySelector('[data-ppt-layer="interaction"]');
    const svg = mount.querySelector('[data-ppt-layer="static"] svg');
    const geometryAfter = JSON.stringify(Object.values(editor.doc.elements).map((record) => {
        const { x, y, w, h } = editor.effectiveElement(record.id);
        return [record.id, x, y, w, h];
      }));
    if (stage?.style.width !== '1600px' || stage?.style.height !== '900px'
      || interaction?.getAttribute('viewBox') !== '0 0 1600 900'
      || svg?.getAttribute('viewBox') !== '0 0 1600 900'
      || geometryAfter !== geometry) {
      throw new Error(`页面尺寸没有按最大化语义同步三层画布：${JSON.stringify({
        stage: [stage?.style.width, stage?.style.height],
        interaction: interaction?.getAttribute('viewBox'), svg: svg?.getAttribute('viewBox'),
        geometryStable: geometryAfter === geometry,
      })}`);
    }
    const sizeP95 = percentile95(sizeSamples);
    recordPerformanceBudget('Chrome 页面尺寸完整反馈 p95', sizeP95, 16);
    return { geometryError, distributionP95, sizeP95 };
  } finally {
    adapter.dispose();
    mount.remove();
  }
}
