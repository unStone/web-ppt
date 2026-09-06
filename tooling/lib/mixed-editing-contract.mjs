import { isDeepStrictEqual } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleBrowser } from './bundle-browser.mjs';

export async function runMixedEditingContract({ root, out, check, eq, dist = false }) {
  const entry = join(out, 'mixed-entry.mjs');
  writeFileSync(entry, Object.entries({ core: 'core/src/index.ts', edit: 'edit-core/src/index.ts',
    chart: 'edit-core/src/chart/index.ts', media: 'edit-core/src/media/index.ts',
    collab: 'collab/src/index.ts', appearance: 'edit-core/src/appearance/index.ts', modern: 'core/src/modern-charts.ts' })
    .map(([name, path]) => `export * as ${name} from ${JSON.stringify(join(root, 'packages', path))};`).join('\n'));
  const { core, edit, chart, media, appearance, modern, collab } = dist ? {
    core: await import('@web-ppt/core'), edit: await import('@web-ppt/edit-core'),
    chart: await import('@web-ppt/edit-core/chart'), media: await import('@web-ppt/edit-core/media'),
    appearance: await import('@web-ppt/edit-core/appearance'), modern: await import('@web-ppt/core/modern-charts'),
    collab: await import('@web-ppt/collab'),
  } : await bundleBrowser({ root, entry,
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
    const doc = edit.createDoc(p, { idPrefix: 'mixed-' }); return { p, doc, editor: new edit.Editor(doc) };
  };
  const base = await open('sample-editor-mixed.pptx');
  const pictures = await open('sample-editor-appearance.pptx');
  const { p, doc, editor } = base, slideId = doc.slideOrder[0];
  const remote = await open('sample-editor-mixed.pptx'), frames = [], messages = [], errors = [];
  const bindings = [base, remote].map((item, i) => collab.bindCollaboration(item.editor, {
    documentId: 'mixed', replicaId: String(i), replicaSlot: i + 1,
    provider: { send: (message) => messages.push(structuredClone(message)),
      subscribe: (listener) => { item.receive = listener; return () => {}; } },
    onError: (error) => errors.push(error),
  }));
  editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
  try {
    check('混合源文稿包含七种原生布局、地图回退、音视频、外观和批注',
      p.slides.slice(0, 7).every((s) => s.elements.some((e) => e.id === 906 && e.kind === 'group'))
      && p.slides[7].elements.some((e) => e.id === 906 && e.kind === 'image')
      && ['audio', 'video'].every((kind) => p.slides[8].elements.some((e) => e.media?.kind === kind))
      && p.slides[8].elements.some((e) => e.duotone) && p.slides[0].comments.length === 2);
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
    media.createMediaEditor(editor).exec({ type: 'AddMedia', slideId, rect: { x: 1040, y: 640, w: 120, h: 70 },
      source: { kind: 'embedded', mime: 'video/mp4', bytes: bytes('sample-editor-media.mp4') },
      poster: { mime: 'image/png', bytes: bytes('sample-editor-audio-icon.png') } });
    editor.undo(); editor.redo();
    for (const message of messages.splice(0)) if (message.replicaId === '0') remote.receive(message);
    check('全类型混合补丁经协同适配器应用没有错误', errors.length === 0);
    const recovered = await open('sample-editor-mixed.pptx');
    recovered.editor.dispose();
    recovered.editor = new edit.Editor(recovered.doc, { recoveryFrames: JSON.parse(JSON.stringify(frames)) });
    const state = (item) => JSON.stringify(item.doc.slideOrder.map((id) => item.editor.toSlide(id)),
      (key, value) => key === 'src' && typeof value === 'string' ? 'resource' : value);
    check('协同与冷恢复重建全部混合内容', [remote, recovered].every((item) => isDeepStrictEqual(JSON.parse(state(base)), JSON.parse(state(item)))));
    for (const item of [remote, recovered]) {
      item.p.dispose();
      const again = await core.parse(await item.editor.save(), { lazy: false });
      check('混合协同与恢复释放来源后仍可保存', again.slides.length === 10 && again.slides[0].comments.length === 2
        && again.slides[0].elements.some((e) => e.media?.kind === 'video'));
      again.dispose(); item.editor.dispose();
    }
    for (const generated of [false, true]) {
      if (generated) p.dispose();
      const saved = await editor.save();
      writeFileSync(join(out, `mixed-${generated ? 'generated' : 'patched'}.pptx`), saved);
      const reopened = await core.parse(saved, { lazy: false, edit: true, keepPackage: true });
      const after = edit.createDoc(reopened), elements = reopened.slides[0].elements;
      check('混合保存保留现代图表、经典数据、媒体与立体效果', elements.filter((e) => e.kind === 'group').length === 2
        && ['audio', 'video'].every((kind) => elements.some((e) => e.media?.kind === kind))
        && reopened.slides[0].comments.length === 2
        && reopened.slides.slice(0, 7).every((s, i) => s.elements.some((e) => e.kind === 'group' && e.name === p.slides[i].elements.find((e) => e.id === 906)?.name)) && elements.some((e) => e.scene3d?.bevelTop === 3));
      const chartAfter = chart.listEditableCharts(after)[0];
      eq('混合保存的工作簿数据保持编辑值', chart.queryChartData(after, chartAfter.id).series[0].points[0].value, 9876);
      check('已编辑双色调跨文稿复制后保存仍保留', elements.some((e) => e.duotone?.[0] === 'rgb(17,34,51)'));
      reopened.dispose();
    }
    check('跨文稿粘贴的图片仍可继续编辑', appearance.queryPictureFx(doc, imageId).duotone?.length === 2);
  } finally { bindings.forEach((b) => b.dispose()); for (const session of [base, pictures, remote]) { session.editor.dispose(); session.p.dispose(); } }
}
