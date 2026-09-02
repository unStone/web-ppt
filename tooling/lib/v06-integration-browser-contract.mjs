import { zipFiles } from './core-image-zip-browser-contract.mjs';
import { applyV06Journey } from './v06-integration-save-contract.mjs';

function assertJourney(lib, session) {
  const { editor } = session;
  const shape = Object.values(editor.doc.elements)
    .find((record) => editor.effectiveElement(record.id).name === '0.6 列表形状');
  const table = Object.values(editor.doc.elements)
    .find((record) => editor.effectiveElement(record.id).name === '0.6 结构表格');
  const range = { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 4 } };
  const preset = lib.queryElementPresetGeometry(editor.doc, [shape.id]);
  const run = lib.queryRunProps(editor.doc, shape.id, range);
  const para = lib.queryParaProps(editor.doc, shape.id, range);
  const grid = lib.queryTableGrid(editor.doc, table.id);
  const size = lib.querySlideSize(editor.doc);
  const evidence = {
    preset: preset.value, underline: run.underline.value, highlight: run.highlight.value,
    bullet: para.bullet.value, rows: grid.rows.length, columns: grid.columns.length,
    merges: grid.merges.length, sectionSlides: lib.listSections(editor.doc)[0]?.slideIds.length,
    size,
  };
  return {
    ...evidence,
    complete: preset.value?.preset === 'roundRect' && preset.value.adj.adj === 36_000
      && run.underline.value === 'wavyDbl' && run.highlight.value === 'rgb(253,230,138)'
      && para.bullet.value?.kind === 'char' && para.bullet.value.char === '◆'
      && grid.rows.length === 3 && grid.columns.length === 3 && grid.merges.length === 1
      && lib.listSections(editor.doc)[0]?.slideIds.length === 2
      && size.w === 1200 && size.h === 675,
  };
}

/** 真浏览器把恢复、DOM、当前投影图片导出与保存重开串成同一条旅程。 */
export async function runV06IntegrationBrowserContract({
  lib, createBlankPptx, presentationToImageZip, mount,
}) {
  const blank = createBlankPptx();
  const seed = await lib.openEditor(blank, { idPrefix: 'v06-browser-' });
  const frames = [];
  const unsubscribe = seed.editor.subscribeRecovery((frame) => frames.push(frame));
  applyV06Journey(lib, seed.editor);
  unsubscribe();
  const seedEvidence = assertJourney(lib, seed);
  if (!seedEvidence.complete) {
    throw new Error(`0.6 浏览器旅程的编辑模型不完整：${JSON.stringify(seedEvidence)}`);
  }
  seed.dispose();

  const restored = await lib.openEditor(blank, {
    idPrefix: 'v06-browser-', recoveryFrames: JSON.parse(JSON.stringify(frames)),
  });
  const restoredEvidence = assertJourney(lib, restored);
  if (!restoredEvidence.complete) {
    throw new Error(`0.6 浏览器旅程恢复后语义不完整：${JSON.stringify(restoredEvidence)}`);
  }
  const view = restored.mount(mount, { mode: 'edit', zoom: 0.5 });
  const staticText = mount.querySelector('[data-ppt-layer="static"]')?.textContent ?? '';
  if (!staticText.includes('表格结构') || !staticText.includes('跨能力旅程')) {
    throw new Error('0.6 浏览器旅程没有进入三层 DOM');
  }

  const projection = restored.toPresentation();
  const beforeSaveDirty = restored.editor.isDirty();
  const zip = await zipFiles(await presentationToImageZip(projection, { scale: 0.1 }));
  if (!beforeSaveDirty || !restored.editor.isDirty() || zip.files.length !== 2
    || zip.files.map((file) => file.name).join(',') !== 'slide-001.png,slide-002.png') {
    throw new Error('当前编辑态批量导出改变了保存状态或遗漏页面');
  }
  view.destroy();
  const saved = await restored.editor.save();
  restored.dispose();

  const reopened = await lib.openEditor(saved, { idPrefix: 'v06-browser-reopen-' });
  if (!assertJourney(lib, reopened).complete || reopened.editor.isDirty()) {
    throw new Error('0.6 浏览器旅程保存重开不等价');
  }
  reopened.dispose();
  return { pages: zip.files.length, frames: frames.length };
}
