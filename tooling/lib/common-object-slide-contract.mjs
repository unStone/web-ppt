/** 四组高频命令只通过 edit-core 发布的查询、命令、投影与历史 seam 验收。 */
export async function runCommonObjectSlideContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 高频对象与页面命令\x1b[0m');
  const bytes = load('sample-editor-common-commands.pptx');
  if (!check('找到分布、替代文字、节与页面尺寸确定性固件', !!bytes)) return;
  const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(presentation, { idPrefix: 'common-commands-' });
  const editor = new edit.Editor(doc);
  const byName = (name) => Object.values(doc.elements).find((record) => record.src.name === name);
  const distributed = ['common-left', 'common-middle-a', 'common-middle-b', 'common-right']
    .map(byName);
  const world = (record) => edit.elementWorldBounds(doc, record.id);
  const gaps = (items, axis) => items.slice(1).map((item, index) => axis === 'horizontal'
    ? item.left - items[index].right : item.top - items[index].bottom);
  const horizontalBefore = distributed.map(world);
  const distributionHistory = editor.history.undoCount;
  const horizontal = editor.exec({
    type: 'DistributeElements', ids: distributed.map((record) => record.id), axis: 'horizontal',
  });
  const horizontalAfter = distributed.map(world).sort((a, b) => a.left - b.left);
  const horizontalGaps = gaps(horizontalAfter, 'horizontal');
  check('水平分布以世界 AABB 保持两端并原子等距移动中间对象',
    horizontal.forward.length > 0
      && Math.max(...horizontalGaps) - Math.min(...horizontalGaps) < 1e-6
      && Math.min(...horizontalAfter.map((item) => item.left))
        === Math.min(...horizontalBefore.map((item) => item.left))
      && Math.max(...horizontalAfter.map((item) => item.right))
        === Math.max(...horizontalBefore.map((item) => item.right))
      && editor.history.undoCount === distributionHistory + 1);
  editor.undo();
  const verticalBefore = distributed.map(world).sort((a, b) => a.top - b.top);
  editor.exec({
    type: 'DistributeElements', ids: distributed.map((record) => record.id), axis: 'vertical',
  });
  const verticalAfter = distributed.map(world).sort((a, b) => a.top - b.top);
  const verticalGaps = gaps(verticalAfter, 'vertical');
  check('垂直分布同样使用旋转后 AABB 且撤销恢复稀疏覆盖',
    Math.max(...verticalGaps) - Math.min(...verticalGaps) < 1e-6
      && Math.abs(verticalAfter[0].top - verticalBefore[0].top) < 1e-9
      && Math.abs(verticalAfter.at(-1).bottom - verticalBefore.at(-1).bottom) < 1e-9);
  editor.undo();
  check('两次分布撤销恢复全部来源几何', distributed.every((record) =>
    !Object.hasOwn(record.ovr, 'x') && !Object.hasOwn(record.ovr, 'y')));
  const alt = Object.values(doc.elements).find((record) => record.src.name === 'common-alt');
  const source = edit.queryElementAltText(doc, alt.id);
  check('替代文字查询保留来源标题与描述且独立于对象名称',
    source.title === '来源标题' && source.descr === '来源描述'
      && source.sourceTitle === '来源标题' && source.sourceDescr === '来源描述'
      && source.direct === false && editor.effectiveElement(alt.id).name === 'common-alt');
  const altHistory = editor.history.undoCount;
  const altResult = editor.exec({
    type: 'SetAltText', id: alt.id, title: '无障碍标题', descr: '蓝色信息卡片',
  });
  const altered = edit.queryElementAltText(doc, alt.id);
  check('SetAltText 原子修改两项 cNvPr 语义而不覆盖对象名称',
    altResult.forward.length === 2 && altered.title === '无障碍标题'
      && altered.descr === '蓝色信息卡片' && altered.directTitle && altered.directDescr
      && editor.effectiveElement(alt.id).name === 'common-alt'
      && !Object.hasOwn(doc.elements[alt.id].ovr, 'name')
      && editor.history.undoCount === altHistory + 1);
  editor.undo();
  check('替代文字撤销清除稀疏覆盖并恢复两个来源属性',
    !Object.hasOwn(doc.elements[alt.id].ovr, 'altText')
      && edit.queryElementAltText(doc, alt.id).title === '来源标题'
      && edit.queryElementAltText(doc, alt.id).descr === '来源描述');
  editor.redo();
  editor.exec({ type: 'SetAltText', id: alt.id, title: null, descr: null });
  check('替代文字 null 恢复来源且重复恢复严格 no-op',
    !Object.hasOwn(doc.elements[alt.id].ovr, 'altText')
      && editor.exec({ type: 'SetAltText', id: alt.id, title: null, descr: null }).forward.length === 0);
  const sections = edit.listSections(doc);
  check('节查询用稳定 SlideId 返回来源成员',
    sections.map((section) => section.name).join(',') === '开场,结尾'
      && sections[0].slideIds.join(',') === doc.slideOrder.slice(0, 2).join(',')
      && sections[1].slideIds.join(',') === doc.slideOrder[2]);
  const copied = editor.exec({ type: 'DuplicateSlide', id: doc.slideOrder[0] });
  const copiedId = copied.forward.find((patch) => patch.path[0] === 'slides')?.path[1];
  check('复制页以稳定 SlideId 继承节归属且普通结构动作不标记显式节重建',
    edit.sectionOfSlide(doc, copiedId) === sections[0].id
      && doc.sections.records[sections[0].id].slideIds.join(',')
        === doc.slideOrder.filter((id) => edit.sectionOfSlide(doc, id) === sections[0].id).join(',')
      && doc.sections.edited === false);
  editor.exec({ type: 'RemoveSlide', id: copiedId });
  check('删除复制页同步移除节成员且不留下悬空 SlideId',
    !doc.sections.records[sections[0].id].slideIds.includes(copiedId)
      && Object.values(doc.sections.records).every((section) =>
        section.slideIds.every((id) => !!doc.slides[id])));
  editor.undo();
  editor.undo();
  check('复制与删除页撤销后恢复来源节成员',
    edit.listSections(doc).map((section) => section.slideIds.join(',')).join('|')
      === sections.map((section) => section.slideIds.join(',')).join('|'));
  const firstSection = sections[0];
  const secondSection = sections[1];
  const renamed = editor.exec({ type: 'RenameSection', id: firstSection.id, name: '主体内容' });
  check('节改名是单一目标字段 Patch 且不改变成员',
    renamed.forward.length === 1
      && renamed.forward[0].path.join('.') === `document.sections.${firstSection.id}.name`
      && edit.listSections(doc)[0].name === '主体内容'
      && edit.listSections(doc)[0].slideIds.join(',') === doc.slideOrder.slice(0, 2).join(','));
  editor.exec({ type: 'MoveSection', id: secondSection.id, at: { after: null } });
  check('移动节只改变稳定节顺序，不暗中重排页面',
    edit.listSections(doc).map((section) => section.id).join(',')
      === [secondSection.id, firstSection.id].join(',')
      && doc.slideOrder.join(',') === sections.flatMap((section) => section.slideIds).join(','));
  editor.exec({ type: 'RemoveSection', id: firstSection.id });
  check('删除节保留原页面并释放其成员归属',
    edit.listSections(doc).length === 1 && doc.slideOrder.length === 3
      && doc.slideOrder.slice(0, 2).every((id) => edit.sectionOfSlide(doc, id) === null));
  const added = editor.exec({
    type: 'AddSection', name: '重新分节', slideIds: doc.slideOrder.slice(0, 2),
    at: { after: secondSection.id },
  });
  const addedSection = edit.listSections(doc)[1];
  check('新增节分配稳定身份并用 SlideId 原子写入连续成员',
    added.forward.length === 1 && addedSection.name === '重新分节'
      && addedSection.id.startsWith('section:common-commands-e')
      && addedSection.slideIds.join(',') === doc.slideOrder.slice(0, 2).join(','));
  editor.undo();
  check('节命令撤销恢复完整先前状态',
    edit.listSections(doc).length === 1
      && doc.slideOrder.slice(0, 2).every((id) => edit.sectionOfSlide(doc, id) === null));
  editor.redo();
  check('节命令重做恢复同一稳定节身份', edit.listSections(doc)[1].id === addedSection.id);
  const size = edit.querySlideSize(doc);
  check('页面尺寸查询同时返回当前值与来源值',
    size.w === 1280 && size.h === 720 && size.sourceW === 1280 && size.sourceH === 720
      && size.direct === false);
  const elementGeometry = JSON.stringify(Object.fromEntries(Object.values(doc.elements).map((record) => [
    record.id,
    (({ x, y, w, h, rot, flipH, flipV }) => ({ x, y, w, h, rot, flipH, flipV }))(editor.effectiveElement(record.id)),
  ])));
  const sizeHistory = editor.history.undoCount;
  const resized = editor.exec({ type: 'SetSlideSize', w: 1600, h: 900 });
  check('SetSlideSize 用一个历史单元修改画布且不执行元素重排',
    resized.forward.length === 2 && edit.querySlideSize(doc).w === 1600
      && edit.querySlideSize(doc).h === 900 && edit.querySlideSize(doc).direct
      && JSON.stringify(Object.fromEntries(Object.values(doc.elements).map((record) => [
        record.id,
        (({ x, y, w, h, rot, flipH, flipV }) => ({ x, y, w, h, rot, flipH, flipV }))(editor.effectiveElement(record.id)),
      ]))) === elementGeometry
      && editor.history.undoCount === sizeHistory + 1);
  editor.undo();
  check('页面尺寸撤销恢复来源画布', edit.querySlideSize(doc).w === 1280
    && edit.querySlideSize(doc).h === 720 && !edit.querySlideSize(doc).direct);
  editor.redo();
  editor.exec({ type: 'SetSlideSize', w: null, h: null });
  check('页面尺寸 null 恢复来源且重复恢复严格 no-op',
    !edit.querySlideSize(doc).direct
      && editor.exec({ type: 'SetSlideSize', w: null, h: null }).forward.length === 0);

  const invalidState = JSON.stringify({
    sections: doc.sections, meta: doc.meta,
    elements: Object.fromEntries(Object.entries(doc.elements).map(([id, record]) => [id, record.ovr])),
  });
  const rejects = (command) => {
    try { editor.exec(command); return false; } catch { return true; }
  };
  doc.elements[distributed[1].id].meta.locked = true;
  const lockedDistribution = rejects({
    type: 'DistributeElements', ids: distributed.map((record) => record.id), axis: 'horizontal',
  });
  delete doc.elements[distributed[1].id].meta.locked;
  const secondPage = doc.slides[doc.slideOrder[1]].children[0];
  check('四组命令在非法输入时于落模前整体拒绝',
    lockedDistribution
      && rejects({ type: 'DistributeElements', ids: distributed.slice(0, 2).map((record) => record.id), axis: 'horizontal' })
      && rejects({ type: 'DistributeElements', ids: [distributed[0].id, distributed[1].id, secondPage], axis: 'vertical' })
      && rejects({ type: 'SetAltText', id: alt.id, title: 'a'.repeat(32768), descr: '' })
      && rejects({ type: 'AddSection', name: '', slideIds: [doc.slideOrder[0]], at: { after: null } })
      && rejects({ type: 'MoveSection', id: addedSection.id, at: { after: addedSection.id } })
      && rejects({ type: 'SetSlideSize', w: 0, h: 900 })
      && rejects({ type: 'SetSlideSize', w: edit.MIN_SLIDE_SIZE - 1, h: 900 })
      && rejects({ type: 'SetSlideSize', w: edit.MAX_SLIDE_SIZE + 1, h: 900 })
      && invalidState === JSON.stringify({
        sections: doc.sections, meta: doc.meta,
        elements: Object.fromEntries(Object.entries(doc.elements).map(([id, record]) => [id, record.ovr])),
      }));
  edit.disposeDoc(doc);

  const recoveryPresentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false,
  });
  const recoveryDoc = edit.createDoc(recoveryPresentation, { idPrefix: 'common-recovery-' });
  const recoveryEditor = new edit.Editor(recoveryDoc);
  const recoveryFrames = [];
  recoveryEditor.subscribeRecovery((frame) => recoveryFrames.push(frame));
  const recoveryByName = (name) => Object.values(recoveryDoc.elements)
    .find((record) => record.src.name === name);
  const recoveryIds = ['common-left', 'common-middle-a', 'common-middle-b', 'common-right']
    .map((name) => recoveryByName(name).id);
  const recoveryAlt = recoveryByName('common-alt');
  const recoverySection = edit.listSections(recoveryDoc)[0];
  recoveryEditor.transaction((transaction) => {
    transaction.exec({ type: 'DistributeElements', ids: recoveryIds, axis: 'horizontal' });
    transaction.exec({ type: 'SetAltText', id: recoveryAlt.id, title: '恢复标题', descr: '恢复描述' });
    transaction.exec({ type: 'RenameSection', id: recoverySection.id, name: '恢复后的节' });
    transaction.exec({ type: 'SetSlideSize', w: 1440, h: 810 });
  }, '四组公共命令恢复');
  const freshPresentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false,
  });
  const freshDoc = edit.createDoc(freshPresentation, { idPrefix: 'common-recovery-' });
  const restored = new edit.Editor(freshDoc, {
    recoveryFrames: JSON.parse(JSON.stringify(recoveryFrames)),
  });
  const recoveredGaps = recoveryIds.map((id) => edit.elementWorldBounds(freshDoc, id))
    .sort((a, b) => a.left - b.left);
  check('四组命令可序列化为单帧恢复日志并恢复原子结果',
    recoveryFrames.length === 1
      && Math.max(...gaps(recoveredGaps, 'horizontal'))
        - Math.min(...gaps(recoveredGaps, 'horizontal')) < 1e-6
      && edit.queryElementAltText(freshDoc, recoveryAlt.id).title === '恢复标题'
      && edit.listSections(freshDoc)[0].name === '恢复后的节'
      && edit.querySlideSize(freshDoc).w === 1440 && restored.isDirty());
  edit.disposeDoc(recoveryDoc);
  edit.disposeDoc(freshDoc);
}
