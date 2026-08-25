const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const rejected = (fn) => { try { fn(); return false; } catch { return true; } };

const normalizedShadow = (shadow) => {
  const distUnits = Math.round(Math.hypot(shadow.dx, shadow.dy) * 9525);
  let dirUnits = Math.round(Math.atan2(shadow.dy, shadow.dx) * 180 / Math.PI * 60000);
  dirUnits = ((dirUnits % 21600000) + 21600000) % 21600000;
  const dist = distUnits / 9525;
  const radians = dirUnits / 60000 * Math.PI / 180;
  return {
    dx: dist * Math.cos(radians), dy: dist * Math.sin(radians),
    blur: Math.round(shadow.blur * 9525) / 9525,
    color: 'rgba(17,34,51,0.457)', inner: true,
  };
};

/** 二维效果的公开模型 seam：直接覆盖、继承重置与显式无效果不能混为一谈。 */
export async function runShapeEffectsContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 形状与图片二维效果\x1b[0m');
  const inheritancePresentation = await core.parse(load('sample-editor-effects.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const inherited = inheritancePresentation.slides[0].elements.find((element) =>
    element.name === 'effects-inherited');
  const explicitEmpty = inheritancePresentation.slides[0].elements.find((element) =>
    element.name === 'effects-explicit-empty');
  check('解析器区分主题效果继承与显式空 effectLst',
    !!inherited?.effects?.shadow && JSON.stringify(explicitEmpty?.effects) === '{}');
  const presentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'shape-effects-' });
  const editor = new edit.Editor(doc);
  const shapeId = Object.values(doc.elements).find((record) =>
    record.src.kind === 'shape' && record.src.path && record.meta.editable === 'full')?.id;
  if (!check('找到可编辑二维效果目标', !!shapeId)) return;

  const sourceEffects = structuredClone(edit.effectiveElement(doc, shapeId).effects ?? {});
  const before = edit.queryElementEffects(doc, [shapeId]);
  const historyBefore = editor.history.undoCount;
  let lastChange;
  const unsubscribe = editor.subscribe((change) => { lastChange = change; });
  const changed = editor.exec({
    type: 'SetEffects', id: shapeId,
    effects: { shadow: { dx: 12, dy: 0, blur: 6, color: '#334455' } },
  });
  const direct = edit.queryElementEffects(doc, [shapeId]);
  check('SetEffects 投影阴影并只失效目标与祖先',
    changed.dirtyElements.has(shapeId) && lastChange?.renderElements.has(shapeId)
      && direct.mixed === false && direct.direct === true
      && JSON.stringify(direct.value) === JSON.stringify({
        shadow: { dx: 12, dy: 0, blur: 6, color: 'rgb(51,68,85)', inner: false },
      })
      && JSON.stringify(edit.effectiveElement(doc, shapeId).effects) === JSON.stringify(direct.value)
      && editor.history.undoCount === historyBefore + 1);

  editor.exec({ type: 'SetEffects', id: shapeId, effects: null });
  const reset = edit.queryElementEffects(doc, [shapeId]);
  check('effects:null 删除直接覆盖并恢复来源/主题有效值',
    !own(doc.elements[shapeId].ovr, 'effects') && reset.direct === false
      && JSON.stringify(reset.value) === JSON.stringify(sourceEffects));

  editor.exec({ type: 'SetEffects', id: shapeId, effects: {} });
  const none = edit.queryElementEffects(doc, [shapeId]);
  const explicitNone = own(doc.elements[shapeId].ovr, 'effects');
  const undo = editor.undo();
  check('空效果列表明确屏蔽继承并可逆',
    none.direct === true && JSON.stringify(none.value) === '{}'
      && explicitNone
      && undo?.dirtyElements.has(shapeId)
      && !own(doc.elements[shapeId].ovr, 'effects'));
  check('初始查询不伪造直接效果',
    before.mixed === false && before.direct === false
      && JSON.stringify(before.value) === JSON.stringify(sourceEffects));

  const complete = {
    shadow: { dx: -3.3333, dy: 4.4444, blur: 6.78901, color: 'rgba(17,34,51,0.456789)', inner: true },
    glow: { radius: 8.76543, color: '#A1B2C3' },
    softEdge: 2.34567,
    reflection: { alpha: 0.678914, size: 0.432196, distance: 7.65432 },
  };
  editor.exec({ type: 'SetEffects', id: shapeId, effects: complete });
  const normalized = edit.queryElementEffects(doc, [shapeId]).value;
  const expectedComplete = {
    shadow: normalizedShadow(complete.shadow),
    glow: { radius: Math.round(complete.glow.radius * 9525) / 9525, color: 'rgb(161,178,195)' },
    softEdge: Math.round(complete.softEdge * 9525) / 9525,
    reflection: {
      alpha: Math.round(complete.reflection.alpha * 100000) / 100000,
      size: Math.round(complete.reflection.size * 100000) / 100000,
      distance: Math.round(complete.reflection.distance * 9525) / 9525,
    },
  };
  const noOpHistory = editor.history.undoCount;
  const noOp = editor.exec({ type: 'SetEffects', id: shapeId, effects: expectedComplete });
  check('四类效果在命令入口收敛到 core 与 OOXML 的共同精度且重复提交 no-op',
    JSON.stringify(normalized) === JSON.stringify(expectedComplete)
      && noOp.dirtyElements.size === 0 && editor.history.undoCount === noOpHistory);

  const imageId = Object.values(doc.elements).find((record) =>
    record.src.kind === 'image' && record.meta.editable === 'full')?.id;
  const groupId = Object.values(doc.elements).find((record) =>
    record.src.kind === 'group' && record.meta.editable === 'full')?.id;
  if (check('找到图片与组合效果目标', !!imageId && !!groupId)) {
    editor.exec(
      { type: 'SetEffects', id: imageId, effects: { glow: { radius: 5, color: '#2563EB' } } },
      { type: 'SetEffects', id: groupId, effects: { reflection: { alpha: 0.5, size: 0.6, distance: 4 } } },
    );
    const imageState = edit.queryElementEffects(doc, [imageId]);
    const groupState = edit.queryElementEffects(doc, [groupId]);
    const mixed = edit.queryElementEffects(doc, [shapeId, imageId, groupId]);
    check('图片与组合沿用同一效果模型，多选查询报告 mixed',
      imageState.value.glow?.color === 'rgb(37,99,235)'
        && groupState.value.reflection?.size === 0.6
        && imageState.direct && groupState.direct && mixed.mixed && mixed.direct);
    const childId = doc.elements[groupId].children?.[0];
    if (check('组合包含可编辑子元素用于祖先失效', !!childId)) {
      const childChange = editor.exec({
        type: 'SetEffects', id: childId, effects: { softEdge: 1 },
      });
      check('子元素效果失效精确向组合祖先传播',
        childChange.dirtyElements.has(childId) && childChange.dirtyElements.has(groupId)
          && lastChange?.renderElements.has(childId)
          && !lastChange?.renderElements.has(groupId));
    }
  }

  const tableId = Object.values(doc.elements).find((record) => record.src.kind === 'table')?.id;
  const atomicBefore = {
    doc: JSON.stringify(doc), identity: JSON.stringify(doc.identity),
    history: editor.history.undoCount, selection: JSON.stringify(editor.selection),
  };
  const invalidEffects = [
    { shadow: { dx: Number.NaN, dy: 0, blur: 1, color: '#000000' } },
    { shadow: { dx: 300000, dy: 300000, blur: 1, color: '#000000' } },
    { shadow: { dx: 0, dy: 0, blur: -1, color: '#000000' } },
    { shadow: { dx: 0, dy: 0, blur: 1, color: 'red' } },
    { shadow: { dx: 0, dy: 0, blur: 1, color: '#000000', inner: 'yes' } },
    { glow: { radius: Infinity, color: '#000000' } },
    { glow: { radius: 1, color: '#000000', extra: true } },
    { softEdge: -0.1 },
    { reflection: { alpha: 1.1, size: 0.5, distance: 1 } },
    { reflection: { alpha: 0.5, size: -0.1, distance: 1 } },
    { reflection: { alpha: 0.5, size: 0.5, distance: -1 } },
    { reflection: { alpha: 0.5, size: 0.5, distance: 1, extra: true } },
    { shadow: undefined },
    { extra: true },
  ];
  const invalidRejected = invalidEffects.every((effects) => rejected(() => editor.exec({
    type: 'SetEffects', id: shapeId, effects,
  })));
  const locked = doc.elements[shapeId].meta.locked;
  doc.elements[shapeId].meta.locked = true;
  const lockedRejected = rejected(() => editor.exec({
    type: 'SetEffects', id: shapeId, effects: {},
  }));
  if (locked === undefined) delete doc.elements[shapeId].meta.locked;
  else doc.elements[shapeId].meta.locked = locked;
  const readonly = doc.meta.readonly;
  doc.meta.readonly = true;
  const readonlyRejected = rejected(() => editor.exec({
    type: 'SetEffects', id: shapeId, effects: {},
  }));
  doc.meta.readonly = readonly;
  check('非法效果、额外字段、锁定/错误目标与非法批量在提交前原子拒绝',
    invalidRejected && lockedRejected && readonlyRejected
      && rejected(() => editor.exec({ type: 'SetEffects', id: tableId, effects: {} }))
      && rejected(() => editor.exec({ type: 'SetEffects', id: 'missing', effects: {} }))
      && rejected(() => editor.exec({ type: 'SetEffects', id: shapeId, effects: {}, extra: true }))
      && rejected(() => editor.exec(
        { type: 'SetEffects', id: shapeId, effects: {} },
        { type: 'SetEffects', id: 'missing', effects: {} },
      ))
      && JSON.stringify(doc) === atomicBefore.doc
      && JSON.stringify(doc.identity) === atomicBefore.identity
      && editor.history.undoCount === atomicBefore.history
      && JSON.stringify(editor.selection) === atomicBefore.selection);

  const patchBefore = JSON.stringify(doc);
  check('伪造效果 Patch 复用命令值校验并保持原子',
    rejected(() => edit.applyPatches(doc, [{
      op: 'set', path: ['elements', shapeId, 'ovr', 'effects'],
      value: { reflection: { alpha: 0.5, size: 0.5, distance: Number.NaN } }, origin: 'forged',
    }]))
      && rejected(() => edit.applyPatches(doc, [{
        op: 'set', path: ['elements', tableId, 'ovr', 'effects'], value: {}, origin: 'forged',
      }]))
      && JSON.stringify(doc) === patchBefore);
  const validEffects = doc.elements[shapeId].ovr.effects;
  doc.elements[shapeId].ovr.effects = { softEdge: Number.NaN };
  const invalidModelRejected = rejected(() => edit.validateEditDoc(doc));
  doc.elements[shapeId].ovr.effects = validEffects;
  check('全局模型入口拒绝绕过命令伪造的效果覆盖', invalidModelRejected);
  unsubscribe();
}
