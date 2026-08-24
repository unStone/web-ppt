import { diffPackageBytes } from '../diff-package.mjs';

const textOf = (element) => element.text.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');

const endOf = (text) => {
  const p = text.paragraphs.length - 1;
  const r = text.paragraphs[p].runs.length - 1;
  return { p, r, off: text.paragraphs[p].runs[r].text.length };
};

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

/** spAutoFit 的文本和派生 frame 必须落在同一页补丁里，重开后不再依赖编辑器二次计算。 */
export async function runShapeAutofitSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ spAutoFit 文字形状保存与重开\x1b[0m');
  const inserted = '保存后仍随文字增高，'.repeat(14);
  const scenario = Object.freeze({
    type: 'text', file: 'sample-editor-sp-autofit.pptx', targetName: 'sp-autofit-rotated',
    edits: [{
      targetName: 'sp-autofit-rotated',
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 4 }, to: { p: 0, r: 0, off: 4 }, text: inserted,
      }],
    }],
  });
  const input = load(scenario.file);
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'shape-autofit-save-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements)
    .find((candidate) => candidate.src.name === scenario.targetName);
  if (!check('spAutoFit 保存固件含可写旋转形状与独立第二页',
    record?.meta.origin && record.src.kind === 'shape' && record.src.text?.autoFitShape
      && doc.slideOrder.length === 2)) {
    edit.disposeDoc(doc);
    return;
  }
  const sourceHeight = record.src.h;
  editor.exec({
    type: 'EditText', id: record.id,
    ops: [{ type: 'replace', from: endOf(record.src.text), to: endOf(record.src.text), text: inserted }],
  });
  const projected = editor.effectiveElement(record.id);
  const expected = {
    text: textOf(projected), x: projected.x, y: projected.y,
    w: projected.w, h: projected.h, rot: projected.rot,
  };
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('shape-autofit-text-editing.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  check('spAutoFit 保存只重写文字所在页的单一 ZIP entry',
    saved.mode === 'passthrough' && saved.rewrittenEntries === 1
      && diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === 'ppt/slides/slide1.xml',
  `mode=${saved.mode} rewritten=${saved.rewrittenEntries} changed=${diff.changed.join(',')}`);

  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const target = findNamed(reopened.slides[0].elements, scenario.targetName);
  const xml = new TextDecoder().decode(reopened.package.parts['ppt/slides/slide1.xml']);
  check('重开精确保留文字、spAutoFit 与旋转 frame',
    target?.kind === 'shape' && target.text?.autoFitShape
      && expected.h > sourceHeight && textOf(target) === expected.text
      && target.x === expected.x && target.y === expected.y
      && target.w === expected.w && target.h === expected.h && target.rot === expected.rot
      && xml.includes('<a:spAutoFit/>') && xml.includes('保存后仍随文字增高'));

  const projectedFingerprint = renderFingerprint(scenario.file, 'projected', scenario);
  const savedFingerprint = renderFingerprint(artifact, 'saved', scenario);
  for (const mode of ['html', 'svg']) {
    eq(`spAutoFit 保存产物 ${mode} 指纹等于独立进程中的有效投影`,
      savedFingerprint[mode], projectedFingerprint[mode]);
  }
  reopened.dispose?.();
  edit.disposeDoc(doc);
}
