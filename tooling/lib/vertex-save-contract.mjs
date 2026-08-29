export async function runVertexSaveContract({ core, edit, load, check, saveArtifact }) {
  console.log('\n\x1b[36m▸ 顶点编辑保留型保存\x1b[0m');
  const presentation = await core.parse(load('sample-editor-vertex.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'vertex-save-' });
  const editor = new edit.Editor(doc);
  const shape = Object.values(doc.elements).find((record) => record.src.name === 'vertex-freeform');
  const preset = Object.values(doc.elements).find((record) => record.src.name === 'vertex-load-1');
  const source = edit.queryElementCustomGeometry(doc, shape.id);
  const target = source.paths[0].commands.find((command) => command.type === 'line').points[0];
  const moved = edit.moveCustomGeometryPoint(source, target.id, { x: 4_500_000, y: 500_000 });
  editor.exec({ type: 'SetGeometry', id: shape.id, geometry: moved });
  editor.exec({ type: 'ConvertToCustomGeometry', id: preset.id });
  const saved = await editor.saveDetailed();
  saveArtifact('vertex-editing.pptx', saved.bytes);
  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedShape = reopened.slides[0].elements.find((element) => element.name === 'vertex-freeform');
  const reopenedPreset = reopened.slides[0].elements.find((element) => element.name === 'vertex-load-1');
  check('顶点保存产物重解析后逐点相等且预设转换已物化',
    JSON.stringify(reopenedShape?.editInfo?.customGeometry?.paths) === JSON.stringify(moved.paths)
      && reopenedPreset?.editInfo?.customGeometry?.paths.length > 0);
  check('顶点保存只形成两项显式历史且保持 60 元素页面',
    editor.history.undoCount === 2 && reopened.slides[0].elements.length === 60);

  const undoDoc = edit.createDoc(presentation, { idPrefix: 'vertex-seed-' });
  const undoEditor = new edit.Editor(undoDoc);
  const undoShape = Object.values(undoDoc.elements).find((record) => record.src.name === 'vertex-freeform');
  const undoSource = edit.queryElementCustomGeometry(undoDoc, undoShape.id);
  let seed = 0x70c0ffee;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  let seeded = undoSource;
  for (const path of undoSource.paths) {
    for (const command of path.commands) {
      for (const vertex of command.points) {
        seeded = edit.moveCustomGeometryPoint(seeded, vertex.id, {
          x: vertex.x.value + (random() - 0.5) * 200_000,
          y: vertex.y.value + (random() - 0.5) * 200_000,
        });
      }
    }
  }
  undoEditor.exec({ type: 'SetGeometry', id: undoShape.id, geometry: seeded });
  const undone = undoEditor.undo();
  const undoSaved = await undoEditor.saveDetailed();
  const undoReopened = await core.parse(undoSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const undoReopenedShape = undoReopened.slides[0].elements.find(
    (element) => element.name === 'vertex-freeform',
  );
  check('固定种子顶点编辑、撤销、保存、重解析后路径逐点相等',
    undone && JSON.stringify(undoReopenedShape?.editInfo?.customGeometry?.paths)
      === JSON.stringify(undoSource.paths));
  undoReopened.dispose?.();
  edit.disposeDoc(undoDoc);
  reopened.dispose?.();
  edit.disposeDoc(doc);
  presentation.dispose?.();
}
