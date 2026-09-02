export async function runPresetShapeCollabContract({
  bindPair, check, createPair, edit, OfflineHub, semanticDoc, seededShuffle, stringDiff,
}) {
  console.log('\n\x1b[36m▸ 预设形状字段级协同与远端恢复\x1b[0m');
  const pair = await createPair('sample-editor-preset-shape.pptx', 'collab-preset-shape-');
  const hub = new OfflineHub();
  const errors = [];
  const bindings = bindPair(pair, hub, errors);
  const source = Object.values(pair.left.elements)
    .find((record) => record.src.name === 'preset-source');
  const polar = Object.values(pair.left.elements)
    .find((record) => record.src.name === 'preset-polar');
  const multi = Object.values(pair.left.elements)
    .find((record) => record.src.name === 'preset-multi');
  const custom = Object.values(pair.left.elements)
    .find((record) => record.src.name === 'preset-custom');
  const remoteFrames = [];
  const stopRecovery = pair.rightEditor.subscribeRecovery((frame) => remoteFrames.push(frame));

  pair.leftEditor.exec({ type: 'SetPreset', id: source.id, preset: 'hexagon' });
  pair.rightEditor.exec({ type: 'SetAdj', id: source.id, name: 'adj', value: 47_000 });
  pair.leftEditor.exec({ type: 'SetAdj', id: polar.id, name: 'adj1', value: 3_600_000 });
  pair.leftEditor.exec({ type: 'SetPreset', id: multi.id, preset: 'chevron' });
  pair.rightEditor.exec({ type: 'ConvertToCustomGeometry', id: multi.id });
  const customGeometry = edit.queryElementCustomGeometry(pair.right, custom.id);
  const point = customGeometry.paths[0].commands[1].points.at(-1);
  pair.leftEditor.exec({ type: 'SetPreset', id: custom.id, preset: 'star5' });
  pair.rightEditor.exec({
    type: 'SetGeometry', id: custom.id,
    geometry: edit.moveCustomGeometryPoint(customGeometry, point.id, {
      x: point.x.value + 6000, y: point.y.value + 4000,
    }),
  });
  hub.flush((messages) => seededShuffle(messages, 0xa0d003));
  stopRecovery();
  const leftSource = edit.queryElementPresetGeometry(pair.left, [source.id]).value;
  const rightSource = edit.queryElementPresetGeometry(pair.right, [source.id]).value;
  check('并发预设切换与调节值按同一几何字段 LWW 收敛，独立形状修改不丢失',
    semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0
      && JSON.stringify(leftSource) === JSON.stringify(rightSource)
      && ((leftSource?.preset === 'hexagon' && Object.keys(leftSource.adj).length === 0)
        || (leftSource?.preset === 'roundRect' && leftSource.adj.adj === 47_000))
      && edit.queryElementPresetGeometry(pair.right, [polar.id]).value?.adj.adj1 === 3_600_000,
    errors.map(String).join(' / ') || stringDiff(semanticDoc(pair.left), semanticDoc(pair.right)));
  const exclusiveGeometry = (record) =>
    Number(record.ovr.geometry !== undefined) + Number(record.ovr.presetGeometry !== undefined) === 1;
  check('预设与自由几何的并发切换用对侧 tombstone 收敛为唯一覆盖',
    [pair.left.elements[multi.id], pair.right.elements[multi.id],
      pair.left.elements[custom.id], pair.right.elements[custom.id]].every(exclusiveGeometry));

  const restoredPair = await createPair(
    'sample-editor-preset-shape.pptx', 'collab-preset-shape-',
  );
  const restored = new edit.Editor(restoredPair.right, {
    recoveryFrames: JSON.parse(JSON.stringify(remoteFrames)),
  });
  check('远端预设几何消息与协同 checkpoint 同帧恢复到最终投影',
    JSON.stringify(edit.queryElementPresetGeometry(restoredPair.right, [source.id]).value)
      === JSON.stringify(rightSource)
      && restored.effectiveElement(polar.id).path === pair.rightEditor.effectiveElement(polar.id).path);
  bindings.forEach((binding) => binding.dispose());

  const nullPair = await createPair('sample-editor-preset-shape.pptx', 'collab-preset-null-');
  const nullHub = new OfflineHub();
  const nullErrors = [];
  const nullBindings = bindPair(nullPair, nullHub, nullErrors);
  const nullCustom = Object.values(nullPair.left.elements)
    .find((record) => record.src.name === 'preset-custom');
  const nullGeometry = edit.queryElementCustomGeometry(nullPair.left, nullCustom.id);
  const nullPoint = nullGeometry.paths[0].commands[1].points.at(-1);
  const seededGeometry = edit.moveCustomGeometryPoint(nullGeometry, nullPoint.id, {
    x: nullPoint.x.value + 3000, y: nullPoint.y.value + 2000,
  });
  nullPair.leftEditor.exec({ type: 'SetGeometry', id: nullCustom.id, geometry: seededGeometry });
  nullHub.flush();
  nullPair.leftEditor.exec({ type: 'SetGeometry', id: nullCustom.id, geometry: null });
  nullPair.rightEditor.exec({ type: 'SetPreset', id: nullCustom.id, preset: 'star5' });
  nullHub.flush((messages) => seededShuffle(messages, 0xa0d004));
  check('清除自由几何覆盖也广播预设 tombstone 并与并发切换收敛',
    semanticDoc(nullPair.left) === semanticDoc(nullPair.right) && nullErrors.length === 0
      && [nullPair.left.elements[nullCustom.id], nullPair.right.elements[nullCustom.id]]
        .every((record) => !(record.ovr.geometry && record.ovr.presetGeometry)),
    nullErrors.map(String).join(' / ')
      || stringDiff(semanticDoc(nullPair.left), semanticDoc(nullPair.right)));
  nullBindings.forEach((binding) => binding.dispose());
}
