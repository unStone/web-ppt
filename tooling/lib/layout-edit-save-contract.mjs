import { diffPackageBytes } from '../diff-package.mjs';

const scenarioFor = (slideIndex) => ({
  type: 'layout', file: 'sample-editor-layout-editing.pptx', slideIndex,
  layoutName: '标题和正文', placeholderType: 'title', x: 444,
  background: { type: 'solid', color: '#112233' },
  added: {
    preset: 'roundRect', rect: { x: 880, y: 540, w: 220, h: 90 },
    name: '版式共享标记', fill: { type: 'solid', color: '#FA6432' },
  },
});

/** 版式写回只从公开设计 seam、包差异、重开和独立进程双文本指纹取证。 */
export async function runLayoutEditSaveContract({
  edit, core, load, check, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ Layout 最小写回与渲染等价\x1b[0m');
  const input = load('sample-editor-layout-editing.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'layout-save-' });
  const editor = new edit.Editor(doc);
  const layout = edit.listLayouts(doc).find((item) => item.name === '标题和正文');
  if (!check('找到两个来源页共享的保存目标版式', !!layout
    && doc.slideOrder.every((id) => doc.slides[id].layoutId === layout.id))) return;
  const host = doc.layouts[layout.id].children.map((id) => doc.elements[id])
    .find((record) => record.meta.editable === 'full' && record.meta.ph?.type === 'title');
  if (!check('找到版式标题宿主', !!host)) return;
  const scenario = scenarioFor(0);
  editor.execDesign(layout.target,
    { type: 'SetXfrm', id: host.id, x: scenario.x },
    { type: 'SetBackground', target: layout.target, fill: scenario.background });
  editor.execDesign(layout.target, {
    type: 'AddShape', target: layout.target,
    preset: scenario.added.preset, rect: scenario.added.rect,
  });
  const addedId = editor.selection.ids[0];
  editor.execDesign(layout.target,
    { type: 'SetName', id: addedId, name: scenario.added.name },
    { type: 'SetFill', id: addedId, fill: scenario.added.fill });
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('layout-editing.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  check('不含资源的版式编辑只重写目标 layout part',
    diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === layout.id,
  `artifact=${artifact}`);

  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedLayout = reopened.editInfo.layouts.find((item) => item.id === layout.id);
  check('保存重开让两个共享页面得到同一版式背景、宿主几何和新增图形',
    reopenedLayout?.background?.type === 'solid'
      && reopenedLayout.background.color === 'rgb(17,34,51)'
      && reopenedLayout.elements.find((element) =>
        element.editInfo?.placeholder?.type === 'title')?.x === scenario.x
      && reopened.slides.every((slide) =>
        slide.background?.type === 'solid' && slide.background.color === 'rgb(17,34,51)'
          && slide.elements.some((element) => element.name === scenario.added.name
            && element.x === scenario.added.rect.x && element.y === scenario.added.rect.y)));

  for (const slideIndex of [0, 1]) {
    const projected = renderFingerprint(scenario.file, 'projected', scenarioFor(slideIndex));
    const persisted = renderFingerprint(artifact, 'saved', scenarioFor(slideIndex));
    check(`共享页 ${slideIndex + 1} 保存前后 HTML 与原生 SVG 独立进程指纹一致`,
      projected.html === persisted.html && projected.svg === persisted.svg);
  }
  editor.undo();
  editor.undo();
  editor.undo();
  const restored = await editor.save();
  check('保存后撤销全部版式命令恢复完整原包', diffPackageBytes(input, restored).equal);
  edit.disposeDoc(doc);
}
