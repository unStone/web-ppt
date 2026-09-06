import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleBrowser } from './bundle-browser.mjs';

export async function runMixedEditingContract({ root, out, check, eq }) {
  const entry = join(out, 'mixed-entry.mjs');
  writeFileSync(entry, Object.entries({ core: 'core/src/index.ts', edit: 'edit-core/src/index.ts',
    chart: 'edit-core/src/chart/index.ts', media: 'edit-core/src/media/index.ts',
    appearance: 'edit-core/src/appearance/index.ts', modern: 'core/src/modern-charts.ts' })
    .map(([name, path]) => `export * as ${name} from ${JSON.stringify(join(root, 'packages', path))};`).join('\n'));
  const { core, edit, chart, media, appearance, modern } = await bundleBrowser({ root, entry,
    output: join(out, 'mixed.mjs'), aliases: [
      ['@web-ppt/core/chart-edit', join(root, 'packages/core/src/chart-edit.ts')],
      ['@web-ppt/core/chart-ex', join(root, 'packages/core/src/chart-ex.ts')],
      ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
      ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
      ['@web-ppt/edit-core/xml', join(root, 'packages/edit-core/src/xml/index.ts')],
      ['@web-ppt/edit-core/opc', join(root, 'packages/edit-core/src/opc/index.ts')],
      ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
    ] });
  const bytes = (name) => new Uint8Array(readFileSync(join(root, 'fixtures', name)));
  const open = async (name) => {
    const source = bytes(name); await modern.prepareModernCharts(source);
    const p = await core.parse(source, { lazy: false, edit: true, keepPackage: true });
    const doc = edit.createDoc(p); return { p, doc, editor: new edit.Editor(doc) };
  };
  const base = await open('sample-editor-mixed.pptx');
  const pictures = await open('sample-editor-appearance.pptx');
  const { p, doc, editor } = base, slideId = doc.slideOrder[0];
  try {
    check('产品准备入口共享 core hook 并自动启用 ChartEx', p.slides[0].elements.some((e) => e.id === 906 && e.kind === 'group'));
    const native = Object.values(doc.elements).find((r) => r.src.id === 906).id;
    editor.exec({ type: 'SetXfrm', id: native, x: 660, y: 140, w: 500, h: 300 });
    const sourceChart = chart.listEditableCharts(doc)[0];
    const sourceData = chart.queryChartData(doc, sourceChart.id);
    chart.createChartDataEditor(editor).setValue(sourceChart.id, sourceData.series[0].id, sourceData.categories[0].id, 9876);
    const paste = (source, id, x, y) => {
      editor.exec({ type: 'PasteElements', payload: edit.copyElements(source.doc, [id]), at: { parentId: slideId, x, y } });
      return editor.selection.ids[0];
    };
    const chartId = sourceChart.id;
    editor.exec({ type: 'SetXfrm', id: chartId, x: 40, y: 140, w: 560, h: 420 });
    const image = Object.values(pictures.doc.elements).find((r) => r.src.name === 'picture-901').id;
    appearance.createAppearanceEditor(pictures.editor).exec({ type: 'SetPictureFx', id: image,
      effects: { grayscale: true, duotone: ['#112233', '#FFEEDD'] } });
    const imageId = paste(pictures, image, 920, 510);
    const shape = Object.values(pictures.doc.elements).find((r) => r.src.name === 'plain-shape').id;
    const shapeId = paste(pictures, shape, 680, 510);
    appearance.createAppearanceEditor(editor).exec({ type: 'SetScene3D', id: shapeId, scene: { extrusion: 14, bevelTop: 3, material: 'metal' } });
    media.createMediaEditor(editor).exec({ type: 'AddMedia', slideId, rect: { x: 1140, y: 530, w: 60, h: 60 },
      source: { kind: 'embedded', mime: 'audio/wav', bytes: bytes('sample-editor-media.wav') } });
    for (const generated of [false, true]) {
      if (generated) p.dispose();
      const saved = await editor.save();
      writeFileSync(join(out, `mixed-${generated ? 'generated' : 'patched'}.pptx`), saved);
      const reopened = await core.parse(saved, { lazy: false, edit: true, keepPackage: true });
      const after = edit.createDoc(reopened), elements = reopened.slides[0].elements;
      check('混合保存保留现代图表、经典数据、媒体与立体效果', elements.filter((e) => e.kind === 'group').length === 2
        && elements.some((e) => e.media?.kind === 'audio') && elements.some((e) => e.scene3d?.bevelTop === 3));
      const chartAfter = chart.listEditableCharts(after)[0];
      eq('混合保存的工作簿数据保持编辑值', chart.queryChartData(after, chartAfter.id).series[0].points[0].value, 9876);
      check('已编辑双色调跨文稿复制后保存仍保留', elements.some((e) => e.duotone?.[0] === 'rgb(17,34,51)'));
      reopened.dispose();
    }
    check('跨文稿粘贴的图片仍可继续编辑', appearance.queryPictureFx(doc, imageId).duotone?.length === 2);
  } finally { for (const session of [base, pictures]) { session.editor.dispose(); session.p.dispose(); } }
}
