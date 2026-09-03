import { diffPackageBytes } from '../diff-package.mjs';

const scenarioFor = (masterId, slideIndex) => ({
  type: 'master', file: 'sample-editor-master-editing.pptx', slideIndex, masterId,
  markerName: '目标母版标记', x: 916,
  background: { type: 'solid', color: '#112233' },
  text: {
    category: 'body', level: 1,
    paragraph: { align: 'right' },
    run: { size: 30, color: '#4263EB' },
  },
});

/** 母版写回从最小包差异、重开和独立进程双文本指纹共同取证。 */
export async function runMasterEditSaveContract({
  edit, core, load, check, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ Master 最小写回与渲染等价\x1b[0m');
  const input = load('sample-editor-master-editing.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'master-save-' });
  const editor = new edit.Editor(doc);
  const master = edit.listMasters(doc)
    .find((item) => item.id === 'ppt/slideMasters/slideMaster2.xml');
  const slideIndex = doc.slideOrder.findIndex((id) =>
    doc.slides[id].origin?.part === 'ppt/slides/slide9.xml');
  if (!check('找到保存目标母版与三级继承页面', !!master && slideIndex >= 0)) return;
  const marker = doc.masters[master.id].children.map((id) => doc.elements[id])
    .find((record) => record.src.name === '目标母版标记');
  if (!check('找到保存目标母版图形', !!marker)) return;
  const scenario = scenarioFor(master.id, slideIndex);
  editor.execDesign(master.target,
    { type: 'SetXfrm', id: marker.id, x: scenario.x },
    { type: 'SetBackground', target: master.target, fill: scenario.background },
    {
      type: 'SetMasterTextStyle', target: master.target,
      category: scenario.text.category, level: scenario.text.level,
      paragraph: scenario.text.paragraph, run: scenario.text.run,
    });
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('master-editing.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  check('母版图形、背景和文字默认值只重写目标 master part',
    diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === master.id,
  `artifact=${artifact}`);

  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedMaster = reopened.editInfo.masters.find((item) => item.id === master.id);
  const reopenedSlide = reopened.slides[slideIndex];
  const reopenedBody = reopenedSlide.elements.find((element) =>
    element.editInfo?.origin?.part === 'ppt/slides/slide9.xml'
      && element.editInfo?.placeholder?.type === 'body');
  check('保存重开保留母版有效背景、图形和第二级正文默认值',
    reopenedMaster?.background?.type === 'solid'
      && reopenedMaster.background.color === 'rgb(17,34,51)'
      && reopenedMaster.elements.find((element) => element.name === scenario.markerName)?.x === scenario.x
      && reopenedSlide.background?.type === 'solid'
      && reopenedSlide.background.color === 'rgb(17,34,51)'
      && reopenedBody?.kind === 'shape'
      && reopenedBody.text?.paragraphs[1]?.align === 'right'
      && reopenedBody.text.paragraphs[1].runs[0]?.size === 30
      && reopenedBody.text.paragraphs[1].runs[0]?.color === 'rgb(66,99,235)');
  reopened.dispose();

  const projected = renderFingerprint(scenario.file, 'projected', scenario);
  const persisted = renderFingerprint(artifact, 'saved', scenario);
  check('母版依赖页保存前后 HTML 与原生 SVG 独立进程指纹一致',
    projected.html === persisted.html && projected.svg === persisted.svg);

  editor.undo();
  const restored = await editor.save();
  check('保存后撤销母版事务恢复完整原包', diffPackageBytes(input, restored).equal);
  edit.disposeDoc(doc);
}
