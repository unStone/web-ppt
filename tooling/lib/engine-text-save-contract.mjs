import { diffPackageBytes } from '../diff-package.mjs';

function findNamed(elements, name) {
  for (const element of elements) {
    if (element.name === name) return element;
    if (element.kind === 'group') {
      const nested = findNamed(element.children, name);
      if (nested) return nested;
    }
  }
  return null;
}

const plain = (element, paragraph) => element.text.paragraphs[paragraph].runs
  .map((run) => run.text).join('');

/** engine 编辑面改变的仍是统一模型；保存层必须证明重开语义和两条渲染投影一致。 */
export async function runEngineTextSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ engine 行盒文字保存与重开\x1b[0m');
  const scenario = Object.freeze({
    type: 'text', file: 'sample-editor-engine-text.pptx', targetName: 'Engine 跨行基准',
    edits: [
      {
        targetName: 'Engine 跨行基准',
        ops: [
          {
            type: 'replace', from: { p: 0, r: 0, off: 20 },
            to: { p: 0, r: 0, off: 20 }, text: '【行盒保存】',
          },
          {
            type: 'replace', from: { p: 1, r: 0, off: 0 },
            to: { p: 1, r: 0, off: 0 }, text: '空段重开',
          },
        ],
      },
      {
        targetName: 'Engine 公式基准',
        ops: [{
          type: 'replace', from: { p: 0, r: 0, off: 2 },
          to: { p: 0, r: 0, off: 2 }, text: '保存',
        }],
      },
      {
        targetName: 'Engine 裸自动缩放',
        ops: [{
          type: 'replace', from: { p: 0, r: 0, off: 10 },
          to: { p: 0, r: 0, off: 10 }, text: '【节流保存】',
        }],
      },
    ],
  });
  const input = load(scenario.file);
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'engine-text-save-' });
  const editor = new edit.Editor(doc);
  const targets = scenario.edits.map((change) => Object.values(doc.elements)
    .find((record) => record.src.name === change.targetName));
  if (!check('engine 保存固件暴露跨行、空段和公式写回锚点',
    targets.every((record) => !!record?.meta.origin))) {
    edit.disposeDoc(doc);
    return;
  }
  scenario.edits.forEach((change, index) => editor.exec({
    type: 'EditText', id: targets[index].id, ops: change.ops,
  }));
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('engine-text-editing.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const wrapping = findNamed(reopened.slides[0].elements, 'Engine 跨行基准');
  const vertical = findNamed(reopened.slides[0].elements, 'Engine 竖排基准');
  const columns = findNamed(reopened.slides[0].elements, 'Engine 分栏基准');
  const formula = findNamed(reopened.slides[0].elements, 'Engine 公式基准');
  const autofit = findNamed(reopened.slides[0].elements, 'Engine 裸自动缩放');
  const slideXml = new TextDecoder().decode(reopened.package.parts['ppt/slides/slide1.xml']);
  check('engine 文字只重写目标页且重开保留硬换行、空段、RTL、公式、竖排、分栏和 autofit',
    saved.mode === 'passthrough'
      && diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === 'ppt/slides/slide1.xml'
      && plain(wrapping, 0).includes('【行盒保存】')
      && wrapping.text.paragraphs[0].runs.some((run) => run.text === '\n')
      && plain(wrapping, 1) === '空段重开'
      && wrapping.text.paragraphs[2].rtl
      && plain(formula, 0).includes('公式保存前')
      && formula.text.paragraphs[0].runs.some((run) => run.math?.length)
      && vertical.text.vert === 'vert'
      && columns.text.columns === 2
      && plain(autofit, 0).includes('【节流保存】')
      && autofit.text.autoFitCompute === true
      && slideXml.includes('<a:normAutofit/>')
      && !slideXml.includes('fontScale='));
  const projected = renderFingerprint(scenario.file, 'projected', scenario);
  const reparsed = renderFingerprint(artifact, 'saved', scenario);
  for (const textMode of ['html', 'svg']) {
    eq(`engine 保存产物 ${textMode} 指纹等于独立进程中的有效投影`,
      reparsed[textMode], projected[textMode]);
  }
  reopened.dispose?.();
  edit.disposeDoc(doc);
}
