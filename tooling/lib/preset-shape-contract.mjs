const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);

const rejected = (fn) => {
  try { fn(); return false; } catch { return true; }
};

/** 预设切换只观察公开命令、查询、有效投影和历史。 */
export async function runPresetShapeContract({ edit, core, geometryHandles, load, check }) {
  console.log('\n\x1b[36m▸ 预设形状切换与调节柄\x1b[0m');
  const input = load('sample-editor-preset-shape.pptx');
  if (!check('找到确定性预设形状编辑固件', !!input)) return;
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'preset-shape-' });
  const editor = new edit.Editor(doc);
  const record = byName(doc, 'preset-source');
  if (!check('固件包含带调节值的来源预设形状',
    record?.meta.geom?.preset === 'roundRect' && record.meta.geom.adj.adj === 26000)) return;
  const before = editor.effectiveElement(record.id);
  const source = edit.queryElementPresetGeometry(doc, [record.id]);
  editor.exec({ type: 'SetPreset', id: record.id, preset: 'hexagon' });
  const after = editor.effectiveElement(record.id);
  const changed = edit.queryElementPresetGeometry(doc, [record.id]);
  check('SetPreset 重置调节值并只替换预设几何语义',
    source.value?.preset === 'roundRect' && source.value.adj.adj === 26000 && !source.direct
      && changed.value?.preset === 'hexagon' && Object.keys(changed.value.adj).length === 0
      && changed.direct && record.ovr.presetGeometry?.preset === 'hexagon'
      && after.path === core.resolveGeomPath({ preset: 'hexagon', adj: {} }, before.w, before.h).d);
  check('切换预设保留 frame、文字、填充、描边、效果与链接',
    [after.x, after.y, after.w, after.h, after.rot, after.flipH, after.flipV].join(',')
      === [before.x, before.y, before.w, before.h, before.rot, before.flipH, before.flipV].join(',')
      && JSON.stringify(after.text) === JSON.stringify(before.text)
      && JSON.stringify(after.fill) === JSON.stringify(before.fill)
      && JSON.stringify(after.stroke) === JSON.stringify(before.stroke)
      && JSON.stringify(after.effects) === JSON.stringify(before.effects)
      && JSON.stringify(after.link) === JSON.stringify(before.link));
  editor.undo();
  check('撤销预设切换删除稀疏覆盖并恢复来源路径',
    record.ovr.presetGeometry === undefined
      && editor.effectiveElement(record.id).path === before.path
      && edit.queryElementPresetGeometry(doc, [record.id]).value?.adj.adj === 26000);
  editor.redo();
  check('重做预设切换恢复同一规范预设而不物化自由路径',
    record.ovr.geometry === undefined && record.ovr.presetGeometry?.preset === 'hexagon'
      && editor.effectiveElement(record.id).path === after.path);
  check('SetPreset 拒绝未知预设、非形状、锁定形状和额外字段',
    rejected(() => editor.exec({ type: 'SetPreset', id: record.id, preset: 'not-a-preset' }))
      && rejected(() => editor.exec({ type: 'SetPreset', id: record.id, preset: '__proto__' }))
      && rejected(() => editor.exec({ type: 'SetPreset', id: 'missing', preset: 'rect' }))
      && rejected(() => editor.exec({ type: 'SetPreset', id: record.id, preset: 'rect', extra: true })));

  const roundRect = geometryHandles.resolvePresetAdjustmentHandles(
    record.meta.geom, record.src.w, record.src.h,
  );
  const xy = roundRect[0];
  const polarRecord = byName(doc, 'preset-polar');
  const multiRecord = byName(doc, 'preset-multi');
  const noHandleRecord = byName(doc, 'preset-no-handle');
  const polar = geometryHandles.resolvePresetAdjustmentHandles(
    polarRecord.meta.geom, polarRecord.src.w, polarRecord.src.h,
  );
  const multi = geometryHandles.resolvePresetAdjustmentHandles(
    multiRecord.meta.geom, multiRecord.src.w, multiRecord.src.h,
  );
  const none = geometryHandles.resolvePresetAdjustmentHandles(
    noHandleRecord.meta.geom, noHandleRecord.src.w, noHandleRecord.src.h,
  );
  check('生成式句柄表覆盖 XY、极坐标、多手柄与无手柄预设',
    roundRect.length === 1 && xy.kind === 'xy'
      && Math.abs(xy.x - 39) < 0.001 && xy.y === 0
      && xy.adjustments[0].name === 'adj' && xy.adjustments[0].min === 0
      && xy.adjustments[0].max === 50000 && xy.adjustments[0].value === 26000
      && polar.length === 2 && polar.every((handle) => handle.kind === 'polar')
      && multi.length === 2 && multi[1].adjustments.length === 2
      && none.length === 0);
  check('187 个规范预设的句柄与路径求值有限，拖到原位不发生跳变',
    geometryHandles.PRESET_DEFINITION_NAMES.length === 187
      && geometryHandles.PRESET_DEFINITION_NAMES.every((preset) => {
        const sourceGeometry = { preset, adj: {} };
        const handles = geometryHandles.resolvePresetAdjustmentHandles(sourceGeometry, 320, 180);
        const geom = core.resolveGeomPath(sourceGeometry, 320, 180);
        return handles.every((handle) => Number.isFinite(handle.x) && Number.isFinite(handle.y)
          && handle.adjustments.every((value) => [value.value, value.min, value.max].every(Number.isFinite))
          && (() => {
            const draggedGeometry = geometryHandles.dragPresetAdjustmentHandle(
              sourceGeometry, 320, 180, handle.index, handle,
            );
            const roundTrip = geometryHandles.resolvePresetAdjustmentHandles(
              draggedGeometry, 320, 180,
            )[handle.index];
            return Math.hypot(roundTrip.x - handle.x, roundTrip.y - handle.y) < 0.05;
          })())
          && !/NaN|Infinity/.test(geom.d);
      }));
  const dragged = geometryHandles.dragPresetAdjustmentHandle(
    record.meta.geom, record.src.w, record.src.h, 0, { x: 90, y: 0 },
  );
  const draggedHandle = geometryHandles.resolvePresetAdjustmentHandles(
    dragged, record.src.w, record.src.h,
  )[0];
  check('无 DOM 拖动 seam 反求并夹逼调节值，命中 seam 使用幻灯片坐标容差',
    dragged.adj.adj === 50000 && Math.abs(draggedHandle.x - 75) < 0.001
      && geometryHandles.clampPresetAdjustment(
        polarRecord.meta.geom, polarRecord.src.w, polarRecord.src.h, 'adj1', 99_000_000,
      ) === 21599999
      && rejected(() => geometryHandles.clampPresetAdjustment(
        polarRecord.meta.geom, polarRecord.src.w, polarRecord.src.h, 'missing', 1,
      ))
      && geometryHandles.hitTestPresetAdjustmentHandles(roundRect, { x: 40, y: 1 }, 3)?.index === 0
      && geometryHandles.hitTestPresetAdjustmentHandles(roundRect, { x: 90, y: 30 }, 3) === null);

  const polarBefore = editor.effectiveElement(polarRecord.id).path;
  editor.exec({ type: 'SetAdj', id: polarRecord.id, name: 'adj1', value: 3_600_000 });
  const polarState = edit.queryElementPresetGeometry(doc, [polarRecord.id]);
  check('SetAdj 原值更新目标调节值并保留其余调整值',
    polarState.direct && polarState.value?.preset === 'arc'
      && polarState.value.adj.adj1 === 3_600_000 && polarState.value.adj.adj2 === 12600000
      && editor.effectiveElement(polarRecord.id).path
        === core.resolveGeomPath(polarState.value, polarRecord.src.w, polarRecord.src.h).d
      && editor.effectiveElement(polarRecord.id).path !== polarBefore);
  editor.undo();
  check('SetAdj 撤销恢复来源调节值且不残留预设覆盖',
    polarRecord.ovr.presetGeometry === undefined
      && edit.queryElementPresetGeometry(doc, [polarRecord.id]).value?.adj.adj1 === 1800000
      && editor.effectiveElement(polarRecord.id).path === polarBefore);
  check('SetAdj 拒绝非法 guide 名、非整数和越界 DrawingML 值',
    rejected(() => editor.exec({ type: 'SetAdj', id: polarRecord.id, name: 'bad name', value: 1 }))
      && rejected(() => editor.exec({ type: 'SetAdj', id: polarRecord.id, name: 'adj1', value: 1.5 }))
      && rejected(() => editor.exec({
        type: 'SetAdj', id: polarRecord.id, name: 'adj1', value: 2147483648,
      })));

  const customRecord = byName(doc, 'preset-custom');
  const customGeometry = edit.queryElementCustomGeometry(doc, customRecord.id);
  const point = customGeometry.paths[0].commands[1].points.at(-1);
  const moved = edit.moveCustomGeometryPoint(customGeometry, point.id, {
    x: point.x.value + 12000, y: point.y.value + 8000,
  });
  editor.exec({ type: 'SetGeometry', id: customRecord.id, geometry: moved });
  editor.exec({ type: 'SetPreset', id: customRecord.id, preset: 'star5' });
  check('自由形状覆盖切到预设时原子移除旧路径覆盖，来源自由几何仍只读保留',
    customRecord.ovr.geometry === undefined && customRecord.ovr.presetGeometry?.preset === 'star5'
      && JSON.stringify(customRecord.meta.customGeometry) === JSON.stringify(customGeometry)
      && editor.effectiveElement(customRecord.id).path
        === core.resolveGeomPath({ preset: 'star5', adj: {} }, customRecord.src.w, customRecord.src.h).d);
  editor.undo();
  check('撤销自由形状的预设切换恢复同一顶点覆盖',
    customRecord.ovr.presetGeometry === undefined
      && JSON.stringify(customRecord.ovr.geometry) === JSON.stringify(moved));
  editor.redo();
  const presetPath = editor.effectiveElement(customRecord.id).path;
  editor.exec({ type: 'ConvertToCustomGeometry', id: customRecord.id });
  check('预设覆盖转自由形状时原子互换两种覆盖并保留有效路径',
    customRecord.ovr.presetGeometry === undefined && !!customRecord.ovr.geometry
      && editor.effectiveElement(customRecord.id).path === presetPath);
  editor.undo();
  check('撤销预设转自由形状恢复预设覆盖且不残留自由路径',
    customRecord.ovr.geometry === undefined && customRecord.ovr.presetGeometry?.preset === 'star5'
      && editor.effectiveElement(customRecord.id).path === presetPath);
  editor.exec({ type: 'SetGeometry', id: customRecord.id, geometry: moved });
  check('自由形状来源上的 SetGeometry 也原子替换预设覆盖',
    customRecord.ovr.presetGeometry === undefined
      && JSON.stringify(customRecord.ovr.geometry) === JSON.stringify(moved));
  editor.undo();
  check('撤销 SetGeometry 恢复此前预设覆盖而非退回来源自由形状',
    customRecord.ovr.geometry === undefined && customRecord.ovr.presetGeometry?.preset === 'star5'
      && editor.effectiveElement(customRecord.id).path === presetPath);

  const payload = edit.copyElements(doc, [record.id]);
  editor.exec({
    type: 'PasteElements', payload,
    at: { parentId: record.parent, x: record.src.x + 300, y: record.src.y + 180 },
  });
  const pastedId = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
  const pasted = pastedId ? doc.elements[pastedId] : null;
  check('复制粘贴以有效预设几何为单一真值且保留形状外观',
    pasted?.meta.geom?.preset === 'hexagon' && Object.keys(pasted.meta.geom.adj).length === 0
      && editor.effectiveElement(pasted.id).path
        === core.resolveGeomPath(pasted.meta.geom, pasted.src.w, pasted.src.h).d
      && JSON.stringify(editor.effectiveElement(pasted.id).fill) === JSON.stringify(after.fill)
      && JSON.stringify(editor.effectiveElement(pasted.id).effects) === JSON.stringify(after.effects));

  const recoveryPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveryDoc = edit.createDoc(recoveryPresentation, { idPrefix: 'preset-recovery-' });
  const recoveryEditor = new edit.Editor(recoveryDoc);
  const recoveryTarget = byName(recoveryDoc, 'preset-source');
  const recoveryFrames = [];
  const stopRecovery = recoveryEditor.subscribeRecovery((frame) => recoveryFrames.push(frame));
  recoveryEditor.transaction((transaction) => {
    transaction.exec({ type: 'SetPreset', id: recoveryTarget.id, preset: 'roundRect' });
    transaction.exec({ type: 'SetAdj', id: recoveryTarget.id, name: 'adj', value: 41_000 });
  }, '拖动预设调节柄');
  stopRecovery();
  const recoveryLog = JSON.parse(JSON.stringify(recoveryFrames));
  const freshPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const freshDoc = edit.createDoc(freshPresentation, { idPrefix: 'preset-recovery-' });
  const restored = new edit.Editor(freshDoc, { recoveryFrames: recoveryLog });
  const restoredTarget = byName(freshDoc, 'preset-source');
  const recoveryPatches = recoveryFrames[0]?.patches ?? [];
  check('一次拖动事务只产生一帧恢复日志并可 JSON 往返恢复同一几何',
    recoveryFrames.length === 1
      && recoveryPatches.filter((patch) => patch.op === 'set'
        && patch.path.at(-1) === 'presetGeometry').length === 2
      && recoveryPatches.some((patch) => patch.op === 'del' && patch.path.at(-1) === 'geometry')
      && edit.queryElementPresetGeometry(freshDoc, [restoredTarget.id]).value?.adj.adj === 41_000
      && restored.effectiveElement(restoredTarget.id).path
        === core.resolveGeomPath({ preset: 'roundRect', adj: { adj: 41_000 } },
          restoredTarget.src.w, restoredTarget.src.h).d
      && restored.history.undoCount === 0);
  edit.disposeDoc(freshDoc);
  edit.disposeDoc(recoveryDoc);
  edit.disposeDoc(doc);
}
