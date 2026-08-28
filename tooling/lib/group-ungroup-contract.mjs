const corners = (edit, doc, id) => {
  const element = edit.effectiveElement(doc, id);
  return [
    { x: 0, y: 0 }, { x: element.w, y: 0 },
    { x: element.w, y: element.h }, { x: 0, y: element.h },
  ].map((point) => edit.elementFrameToSlidePoint(doc, id, point));
};

const samePoints = (left, right, epsilon = 1e-8) => left.length === right.length
  && left.every((point, index) => Math.abs(point.x - right[index].x) <= epsilon
    && Math.abs(point.y - right[index].y) <= epsilon);

const pointError = (left, right) => Math.max(...left.flatMap((point, index) => [
  Math.abs(point.x - right[index].x), Math.abs(point.y - right[index].y),
]));

const contentCorners = (edit, doc, id) => {
  const element = edit.effectiveElement(doc, id);
  const matrix = edit.elementContentToSlideMatrix(doc, id);
  return [
    { x: 0, y: 0 }, { x: element.w, y: 0 },
    { x: element.w, y: element.h }, { x: 0, y: element.h },
  ].map((point) => edit.transformSpacePoint(matrix, point));
};

/** 首条竖切只走公开命令、投影、选择和历史 seam。 */
export async function runGroupUngroupContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 元素组合与解组\x1b[0m');
  const bytes = load('sample-editor-space.pptx');
  if (!check('找到组合坐标固件', !!bytes)) return;
  const presentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'group-basic-' });
  const editor = new edit.Editor(doc);
  const byName = (name) => Object.values(doc.elements).find((record) => record.src.name === name);
  const plain = byName('space-plain');
  const rotated = byName('space-rotated-flipped');
  if (!check('组合固件含同父普通与旋转翻转元素', !!plain && !!rotated
    && plain.parent === rotated.parent)) return;
  const slide = doc.slides[plain.parent];
  const childrenBefore = [...slide.children];
  const geometryBefore = new Map([plain, rotated].map((record) => [record.id, corners(edit, doc, record.id)]));

  editor.select({ kind: 'elements', ids: [plain.id, rotated.id], enteredGroup: null });
  const result = editor.exec({ type: 'Group', ids: [plain.id, rotated.id] });
  const selection = editor.selection;
  const groupId = selection.kind === 'elements' && selection.ids.length === 1 ? selection.ids[0] : null;
  const group = groupId ? doc.elements[groupId] : null;
  check('Group 原子建立稳定组合并切换选区', !!group && group.src.kind === 'group'
    && group.children?.join(',') === [plain.id, rotated.id].join(',')
    && group.meta.origin?.spid === group.src.id && editor.history.undoCount === 1
    && result.forward.length === 1);
  check('Group 保持孩子世界变换与兄弟相对顺序', !!group
    && [plain, rotated].every((record) => samePoints(
      geometryBefore.get(record.id), corners(edit, doc, record.id),
    ))
    && slide.children.filter((id) => id !== group.id).join(',')
      === childrenBefore.filter((id) => id !== plain.id && id !== rotated.id).join(','));

  const saved = await editor.save();
  const reopenedPresentation = await core.parse(saved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopened = edit.createDoc(reopenedPresentation, { idPrefix: 'group-basic-reopen-' });
  const reopenedGroup = Object.values(reopened.elements).find((record) =>
    record.src.kind === 'group' && record.src.name === group?.src.name);
  const reopenedByName = (name) => Object.values(reopened.elements)
    .find((record) => record.src.name === name);
  check('Group 保存重开物化 grpSp 且原宿主只出现一次', !!reopenedGroup
    && reopenedGroup.children?.length === 2
    && ['space-plain', 'space-rotated-flipped'].every((name) => {
      const record = reopenedByName(name);
      return !!record && record.parent === reopenedGroup.id;
    }));
  edit.disposeDoc(reopened);

  const groupedState = JSON.stringify({ elements: doc.elements, children: slide.children });
  const ungrouped = editor.exec({ type: 'Ungroup', id: group.id });
  const ungroupSelection = editor.selection;
  check('Ungroup 原子展开孩子并选中全部直属元素', !doc.elements[group.id]
    && [plain.id, rotated.id].every((id) => doc.elements[id]?.parent === slide.id)
    && ungroupSelection.kind === 'elements'
    && ungroupSelection.ids.join(',') === [plain.id, rotated.id].join(',')
    && ungrouped.forward.length === 1);
  check('Ungroup 保持孩子世界变换', [plain, rotated].every((record) => samePoints(
    geometryBefore.get(record.id), corners(edit, doc, record.id),
  )));
  editor.undo();
  check('组合→解组→撤销精确恢复组合模型与选区', groupedState
    === JSON.stringify({ elements: doc.elements, children: slide.children })
    && editor.selection.kind === 'elements' && editor.selection.ids[0] === group.id);

  edit.disposeDoc(doc);

  const sourcePresentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const sourceDoc = edit.createDoc(sourcePresentation, { idPrefix: 'ungroup-source-' });
  const sourceEditor = new edit.Editor(sourceDoc);
  const sourceGroup = Object.values(sourceDoc.elements)
    .find((record) => record.src.name === 'space-outer-group');
  if (!check('解组固件含旋转翻转的来源组合', !!sourceGroup?.children?.length)) return;
  const sourceChildren = sourceGroup.children.map((id) => sourceDoc.elements[id]);
  const sourceGeometry = new Map(sourceChildren.map((record) => [
    record.src.name, contentCorners(edit, sourceDoc, record.id),
  ]));
  sourceEditor.select({ kind: 'elements', ids: [sourceGroup.id], enteredGroup: null });
  sourceEditor.exec({ type: 'Ungroup', id: sourceGroup.id });
  check('来源组合解组后保持旋转翻转孩子的世界内容变换', sourceChildren.every((record) =>
    samePoints(sourceGeometry.get(record.src.name), contentCorners(edit, sourceDoc, record.id))));
  const sourceSaved = await sourceEditor.save();
  const sourceReopenedPresentation = await core.parse(sourceSaved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const sourceReopened = edit.createDoc(sourceReopenedPresentation, { idPrefix: 'ungroup-source-reopen-' });
  const reopenedNames = new Map(Object.values(sourceReopened.elements)
    .map((record) => [record.src.name, record]));
  check('来源 grpSp 展开保存重开后不复活且几何保持', !reopenedNames.has('space-outer-group')
    && sourceChildren.every((record) => {
      const reopenedRecord = reopenedNames.get(record.src.name);
      return !!reopenedRecord && sourceReopened.slides[reopenedRecord.parent]
        && samePoints(sourceGeometry.get(record.src.name),
          contentCorners(edit, sourceReopened, reopenedRecord.id), 2e-4);
    }));
  edit.disposeDoc(sourceReopened);
  edit.disposeDoc(sourceDoc);

  const boundaryPresentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const boundaryDoc = edit.createDoc(boundaryPresentation, { idPrefix: 'group-boundary-' });
  const boundaryEditor = new edit.Editor(boundaryDoc);
  const boundaryByName = (name) => Object.values(boundaryDoc.elements)
    .find((record) => record.src.name === name);
  const boundaryPlain = boundaryByName('space-plain');
  const boundaryNested = boundaryByName('space-nested-leaf');
  const boundaryGroup = boundaryByName('space-outer-group');
  let crossParentRejected = false;
  try { boundaryEditor.exec({ type: 'Group', ids: [boundaryPlain.id, boundaryNested.id] }); } catch (error) {
    crossParentRejected = /同一父级/.test(String(error));
  }
  boundaryEditor.exec({ type: 'SetXfrm', id: boundaryGroup.id, w: boundaryGroup.src.w * 1.2 });
  const beforeRisk = JSON.stringify(boundaryDoc.elements);
  const historyBeforeRisk = boundaryEditor.history.undoCount;
  let irreversibleRejected = false;
  try { boundaryEditor.exec({ type: 'Ungroup', id: boundaryGroup.id }); } catch (error) {
    irreversibleRejected = /旋转与非等比缩放/.test(String(error));
  }
  let unknownRejected = false;
  try {
    boundaryEditor.exec({ type: 'Group', ids: [boundaryPlain.id, boundaryGroup.id], extra: true });
  } catch (error) { unknownRejected = /未知字段/.test(String(error)); }
  check('组合边界拒绝跨父、不可逆解组与未知字段且保持原子', crossParentRejected
    && irreversibleRejected && unknownRejected && JSON.stringify(boundaryDoc.elements) === beforeRisk
    && boundaryEditor.history.undoCount === historyBeforeRisk);
  edit.disposeDoc(boundaryDoc);

  let degenerateFramesPersist = true;
  for (const zeroAxis of ['w', 'h']) {
    const degeneratePresentation = await core.parse(bytes, {
      edit: true, keepPackage: true, lazy: false, assets: 'defer',
    });
    const degenerateDoc = edit.createDoc(degeneratePresentation, {
      idPrefix: `group-zero-${zeroAxis}-`,
    });
    const degenerateEditor = new edit.Editor(degenerateDoc);
    const targets = ['space-plain', 'space-rotated-flipped'].map((name) =>
      Object.values(degenerateDoc.elements).find((record) => record.src.name === name));
    targets.forEach((record, index) => degenerateEditor.exec({
      type: 'SetXfrm', id: record.id,
      x: zeroAxis === 'w' ? 160 : 80 + index * 180,
      y: zeroAxis === 'h' ? 160 : 80 + index * 180,
      w: zeroAxis === 'w' ? 0 : 120,
      h: zeroAxis === 'h' ? 0 : 120,
      rot: 0,
    }));
    degenerateEditor.exec({ type: 'Group', ids: targets.map((record) => record.id) });
    const degenerateGroup = degenerateDoc.elements[degenerateEditor.selection.ids[0]];
    const saved = await degenerateEditor.save();
    const reopenedPresentation = await core.parse(saved, {
      edit: true, keepPackage: true, lazy: false, assets: 'defer',
    });
    const reopenedDoc = edit.createDoc(reopenedPresentation, {
      idPrefix: `group-zero-${zeroAxis}-reopen-`,
    });
    const reopenedGroup = Object.values(reopenedDoc.elements).find((record) =>
      record.src.kind === 'group' && record.children?.length === 2
      && record.children.every((id) => ['space-plain', 'space-rotated-flipped']
        .includes(reopenedDoc.elements[id].src.name)));
    degenerateFramesPersist &&= degenerateGroup.src[zeroAxis] === 0
      && reopenedGroup?.src[zeroAxis] === 0;
    edit.disposeDoc(reopenedDoc);
    edit.disposeDoc(degenerateDoc);
  }
  check('同轴线条允许组合，零宽/零高 grpSp 保存重开仍保持退化 frame', degenerateFramesPersist);

  const propertyPresentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const propertyDoc = edit.createDoc(propertyPresentation, { idPrefix: 'group-property-' });
  const propertyEditor = new edit.Editor(propertyDoc);
  const propertyNames = [
    'space-plain', 'space-rotated-flipped', 'space-rotated-45', 'space-outer-group',
  ];
  let seed = 0x0675eed;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  let maximumError = 0;
  let propertyCorrect = true;
  for (let iteration = 0; iteration < 24; iteration++) {
    const records = propertyNames.map((name) => Object.values(propertyDoc.elements)
      .find((record) => record.src.name === name));
    const first = Math.floor(random() * records.length);
    let second = Math.floor(random() * (records.length - 1));
    if (second >= first) second++;
    const targets = [records[first], records[second]];
    const before = JSON.stringify({
      slides: propertyDoc.slides, elements: propertyDoc.elements,
      removedElements: propertyDoc.removedElements,
    });
    const geometry = new Map(targets.map((record) => [
      record.id, contentCorners(edit, propertyDoc, record.id),
    ]));
    propertyEditor.select({ kind: 'elements', ids: targets.map((record) => record.id), enteredGroup: null });
    propertyEditor.exec({ type: 'Group', ids: targets.map((record) => record.id) });
    const propertyGroupId = propertyEditor.selection.ids[0];
    const grouped = JSON.stringify({
      slides: propertyDoc.slides, elements: propertyDoc.elements,
      removedElements: propertyDoc.removedElements,
    });
    propertyEditor.exec({ type: 'Ungroup', id: propertyGroupId });
    for (const record of targets) maximumError = Math.max(maximumError, pointError(
      geometry.get(record.id), contentCorners(edit, propertyDoc, record.id),
    ));
    propertyEditor.undo();
    propertyCorrect &&= grouped === JSON.stringify({
      slides: propertyDoc.slides, elements: propertyDoc.elements,
      removedElements: propertyDoc.removedElements,
    });
    propertyEditor.undo();
    propertyCorrect &&= before === JSON.stringify({
      slides: propertyDoc.slides, elements: propertyDoc.elements,
      removedElements: propertyDoc.removedElements,
    });
    propertyEditor.history.clear();
    propertyEditor.markSaved();
  }
  check('固定种子属性测试覆盖嵌套/旋转/翻转，世界变换≤0.01px 且逐层撤销全等',
    propertyCorrect && maximumError <= 0.01, `最大偏差 ${maximumError}`);
  edit.disposeDoc(propertyDoc);

  const recoveryPresentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveryDoc = edit.createDoc(recoveryPresentation, { idPrefix: 'group-recovery-' });
  const recoveryEditor = new edit.Editor(recoveryDoc);
  const recoveryFrames = [];
  const stopRecovery = recoveryEditor.subscribeRecovery((frame) => recoveryFrames.push(frame));
  const recoveryTargets = ['space-plain', 'space-rotated-flipped'].map((name) =>
    Object.values(recoveryDoc.elements).find((record) => record.src.name === name));
  recoveryEditor.select({
    kind: 'elements', ids: recoveryTargets.map((record) => record.id), enteredGroup: null,
  });
  recoveryEditor.exec({ type: 'Group', ids: recoveryTargets.map((record) => record.id) });
  recoveryEditor.exec({ type: 'Ungroup', id: recoveryEditor.selection.ids[0] });
  stopRecovery();
  const recoveryExpected = JSON.stringify({
    identity: recoveryDoc.identity, slides: recoveryDoc.slides, elements: recoveryDoc.elements,
    removedElements: recoveryDoc.removedElements, selection: recoveryEditor.selection,
  });
  const restoredPresentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const restoredDoc = edit.createDoc(restoredPresentation, { idPrefix: 'group-recovery-' });
  const restoredEditor = new edit.Editor(restoredDoc, {
    recoveryFrames: JSON.parse(JSON.stringify(recoveryFrames)),
  });
  check('组合/解组层级 Patch 经纯 JSON 恢复日志重放后模型、身份与选区一致',
    recoveryExpected === JSON.stringify({
      identity: restoredDoc.identity, slides: restoredDoc.slides, elements: restoredDoc.elements,
      removedElements: restoredDoc.removedElements, selection: restoredEditor.selection,
    }));
  edit.disposeDoc(restoredDoc);
  edit.disposeDoc(recoveryDoc);

  const remotePresentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const remoteDoc = edit.createDoc(remotePresentation, { idPrefix: 'group-peer-' });
  const remoteEditor = new edit.Editor(remoteDoc);
  const remoteTargets = ['space-plain', 'space-rotated-flipped'].map((name) =>
    Object.values(remoteDoc.elements).find((record) => record.src.name === name));
  let remoteGroupResult;
  for (let attempt = 0; attempt < 3; attempt++) {
    remoteGroupResult = remoteEditor.exec({
      type: 'Group', ids: remoteTargets.map((record) => record.id),
    });
    if (attempt < 2) remoteEditor.undo();
  }
  const remoteGroupPatch = JSON.parse(JSON.stringify(remoteGroupResult.forward));
  const remoteGroupRecord = remoteGroupPatch[0].value.records[remoteGroupPatch[0].path[1]];

  const peerPresentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const peerDoc = edit.createDoc(peerPresentation, { idPrefix: 'group-peer-' });
  const peerEditor = new edit.Editor(peerDoc);
  const peerTargets = ['space-plain', 'space-rotated-flipped'].map((name) =>
    Object.values(peerDoc.elements).find((record) => record.src.name === name));
  peerEditor.exec({ type: 'Group', ids: peerTargets.map((record) => record.id) });
  peerEditor.undo();
  edit.applyPatches(peerDoc, remoteGroupPatch);
  const remoteSpid = remoteGroupRecord.meta.origin.spid;
  const remotePart = remoteGroupRecord.meta.origin.part;
  peerEditor.exec({
    type: 'AddShape', slideId: peerDoc.slideOrder[0], preset: 'rect',
    rect: { x: 20, y: 20, w: 40, h: 30 },
  });
  const localAfterRemote = peerDoc.elements[peerEditor.selection.ids[0]];
  check('外部层级 Patch 推进已初始化的 spid 水位，后续本地新增不复用身份',
    peerDoc.identity.nextSpid[remotePart] === remoteSpid + 2
    && localAfterRemote.meta.origin.spid === remoteSpid + 1);
  edit.disposeDoc(peerDoc);
  edit.disposeDoc(remoteDoc);

  const deletePresentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const deleteDoc = edit.createDoc(deletePresentation, { idPrefix: 'group-delete-' });
  const deleteEditor = new edit.Editor(deleteDoc);
  const deleteRoots = ['space-plain', 'space-rotated-flipped'].map((name) =>
    Object.values(deleteDoc.elements).find((record) => record.src.name === name));
  deleteEditor.exec({ type: 'Group', ids: deleteRoots.map((record) => record.id) });
  const deleteGroupId = deleteEditor.selection.ids[0];
  deleteEditor.exec({ type: 'RemoveElement', id: deleteGroupId });
  const deletedSaved = await deleteEditor.save();
  const deletedReopened = await core.parse(deletedSaved, { edit: true, lazy: false });
  const deletedNames = new Set(deletedReopened.slides[0].elements.flatMap((element) => {
    const names = [];
    const visit = (current) => {
      names.push(current.name);
      if (current.kind === 'group') current.children.forEach(visit);
    };
    visit(element);
    return names;
  }));
  check('删除新组合不会让被移动的来源孩子在保存时复活',
    deleteRoots.every((record) => !deletedNames.has(record.src.name)));
  edit.disposeDoc(deleteDoc);
}
