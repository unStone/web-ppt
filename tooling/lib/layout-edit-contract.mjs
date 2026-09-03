import { diffPackageBytes } from '../diff-package.mjs';

const solid = (fill) => fill?.type === 'solid' ? fill.color : null;
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** 版式只经公开目录、设计目标、命令和有效投影 seam 验收。 */
export async function runLayoutEditContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ Layout 设计画布、命令与局部传播\x1b[0m');
  const input = load('sample-editor-layout-editing.pptx');
  if (!check('找到多母版版式确定性固件', !!input)) return;
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'layout-edit-' });
  const editor = new edit.Editor(doc);
  const layouts = edit.listLayouts(doc);
  const layout = layouts.find((candidate) => candidate.name === '重点内容');
  if (!check('公开版式目录返回显式设计目标', !!layout
    && layout.target.kind === 'layout' && layout.target.id === layout.id)) return;
  const sourceLayoutTarget = { kind: 'layout', id: doc.slides[doc.slideOrder[0]].layoutId };
  const sourceLayoutState = edit.queryLayout(doc, sourceLayoutTarget);
  check('公开版式查询区分来源值与稀疏覆盖',
    sourceLayoutState.id === sourceLayoutTarget.id
      && sourceLayoutState.background.direct === false
      && sourceLayoutState.transition.direct === false
      && JSON.stringify(sourceLayoutState.background.value)
        === JSON.stringify(sourceLayoutState.background.source));
  const record = doc.layouts[layout.id];
  const ownElement = record.children.map((id) => doc.elements[id]).find((element) =>
    element.meta.origin?.part === layout.id && element.src.name === '目标版式角标');
  const masterElement = record.children.map((id) => doc.elements[id]).find((element) =>
    element.meta.origin?.part === record.origin.masterPart);
  check('版式画布为来源节点建立稳定身份并隔离母版只读节点',
    !!ownElement && ownElement.meta.editable === 'full'
      && !!masterElement && masterElement.meta.editable === 'none');
  if (!ownElement) return;

  const sourceSlide = doc.slideOrder[0];
  const added = editor.exec({ type: 'AddSlide', layoutId: layout.id, at: { after: sourceSlide } });
  const dependentSlide = [...added.createdSlides][0];
  const before = editor.toDesignCanvas(layout.target);
  const beforeSlide = editor.toSlide(dependentSlide);
  const beforeElement = before.elements.find((element) => element.name === '目标版式角标');
  const result = editor.execDesign(layout.target, {
    type: 'SetXfrm', id: ownElement.id, x: ownElement.src.x + 37,
  });
  const after = editor.toDesignCanvas(layout.target);
  const afterSlide = editor.toSlide(dependentSlide);
  check('同一 SetXfrm 命令更新版式画布并只传播到依赖页面',
    beforeElement?.x === ownElement.src.x
      && after.elements.find((element) => element.name === '目标版式角标')?.x === ownElement.src.x + 37
      && afterSlide.elements.find((element) => element.name === '目标版式角标')?.x === ownElement.src.x + 37
      && result.dirtySlides.has(dependentSlide)
      && result.renderSlides.has(dependentSlide)
      && beforeSlide !== afterSlide);
  check('版式设计命令拒绝页面专属能力', (() => {
    try {
      editor.execDesign(layout.target, { type: 'SetHidden', id: dependentSlide, v: true });
      return false;
    } catch { return true; }
  })());
  const background = editor.execDesign(layout.target, {
    type: 'SetBackground', target: layout.target, fill: { type: 'solid', color: '#123456' },
  });
  check('版式背景使用显式设计目标并传播到依赖页面',
    solid(editor.toDesignCanvas(layout.target).background) === 'rgb(18,52,86)'
      && solid(editor.toSlide(dependentSlide).background) === 'rgb(18,52,86)'
      && background.renderSlides.has(dependentSlide));

  const transition = editor.execDesign(layout.target, {
    type: 'SetTransition', target: layout.target, t: { type: 'push', dir: 'r' },
  });
  check('版式切换效果沿同一设计目标传播',
    editor.toDesignCanvas(layout.target).transition?.type === 'push'
      && editor.toSlide(dependentSlide).transition?.type === 'push'
      && transition.renderSlides.has(dependentSlide));
  const queried = edit.queryLayout(doc, layout.target);
  check('版式属性查询保留来源值并标记直接覆盖',
    queried.background.direct && queried.transition.direct
      && solid(queried.background.value) === 'rgb(18,52,86)'
      && JSON.stringify(queried.background.value) !== JSON.stringify(queried.background.source));

  editor.execDesign(layout.target, {
    type: 'AddShape', target: layout.target, preset: 'rect',
    rect: { x: 50, y: 60, w: 120, h: 80 },
  });
  const firstAdded = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
  editor.execDesign(layout.target, {
    type: 'AddShape', target: layout.target, preset: 'ellipse',
    rect: { x: 180, y: 60, w: 120, h: 80 },
  });
  const secondAdded = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
  const layer = editor.execDesign(layout.target, { type: 'SetZ', id: firstAdded, to: 'front' });
  check('版式复用新增与层级命令且不伪造页面身份',
    doc.elements[firstAdded]?.parent === layout.id && doc.elements[secondAdded]?.parent === layout.id
      && doc.elements[firstAdded]?.meta.origin?.part === layout.id
      && record.children.at(-1) === firstAdded
      && layer.renderSlides.has(dependentSlide));

  const writableText = record.children.map((id) => doc.elements[id]).find((element) =>
    element.meta.editable === 'full' && element.src.kind === 'shape' && element.src.text);
  if (writableText) {
    const beforeText = textOf(editor.effectiveElement(writableText.id));
    editor.execDesign(layout.target, {
      type: 'EditText', id: writableText.id,
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '版',
      }],
    });
    check('版式占位符文字经既有文字命令编辑且继承地址保持不可变',
      textOf(editor.effectiveElement(writableText.id)) === `版${beforeText}`
        && JSON.stringify(writableText.meta.ph) === JSON.stringify(writableText.src.editInfo?.placeholder));
  } else check('版式固件包含可编辑文字占位符', false);

  const removed = editor.execDesign(layout.target, { type: 'RemoveElement', id: secondAdded });
  check('版式删除复用元素树 Patch 并传播依赖页',
    !doc.elements[secondAdded] && removed.renderSlides.has(dependentSlide));
  editor.undo();
  check('版式结构编辑进入同一撤销历史', doc.elements[secondAdded]?.parent === layout.id);

  const saved = await editor.saveDetailed();
  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedLayout = reopened.editInfo.layouts.find((candidate) => candidate.name === layout.name);
  const reopenedOwn = reopenedLayout?.elements.find((element) => element.name === '目标版式角标');
  check('保存只物化版式设计状态且重开保持即时投影',
    reopenedOwn?.x === ownElement.src.x + 37
      && solid(reopenedLayout?.background) === 'rgb(18,52,86)'
      && reopenedLayout?.transition?.type === 'push'
      && reopenedLayout.elements.some((element) => element.name === doc.elements[firstAdded].src.name)
      && reopenedLayout.elements.some((element) => element.name === doc.elements[secondAdded].src.name)
      && Buffer.compare(Buffer.from(presentation.package.parts[layout.id]),
        Buffer.from(reopened.package.parts[layout.id])) !== 0);
  edit.disposeDoc(doc);

  const placeholderPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const placeholderDoc = edit.createDoc(placeholderPresentation, { idPrefix: 'layout-placeholder-' });
  const placeholderEditor = new edit.Editor(placeholderDoc);
  const slideId = placeholderDoc.slideOrder[0];
  const sourceLayoutId = placeholderDoc.slides[slideId].layoutId;
  const sourceTarget = { kind: 'layout', id: sourceLayoutId };
  const sourceLayout = placeholderDoc.layouts[sourceLayoutId];
  const titleHost = sourceLayout.children.map((id) => placeholderDoc.elements[id])
    .find((element) => element.meta.ph?.type === 'title');
  const bodyHost = sourceLayout.children.map((id) => placeholderDoc.elements[id])
    .find((element) => element.meta.ph?.type === 'body');
  const title = placeholderDoc.slides[slideId].children.map((id) => placeholderDoc.elements[id])
    .find((element) => element.meta.ph?.type === 'title');
  const inheritedSlide = [...placeholderEditor.exec({
    type: 'AddSlide', layoutId: sourceLayoutId, at: { after: slideId },
  }).createdSlides][0];
  const inheritedBody = placeholderDoc.slides[inheritedSlide].children
    .map((id) => placeholderDoc.elements[id])
    .find((element) => element.meta.ph?.type === 'body');
  placeholderEditor.exec({ type: 'SetXfrm', id: title.id, x: 333 });
  placeholderEditor.execDesign(sourceTarget, { type: 'SetXfrm', id: titleHost.id, x: 444 });
  placeholderEditor.execDesign(sourceTarget, {
    type: 'SetXfrm', id: bodyHost.id, x: bodyHost.src.x + 51,
  });
  check('版式重算保留页面占位符身份与直接覆盖，未直设占位符跟随宿主',
    placeholderEditor.effectiveElement(title.id).x === 333
      && placeholderEditor.effectiveElement(inheritedBody.id).x === bodyHost.src.x + 51
      && placeholderDoc.elements[title.id] === title);
  placeholderEditor.execDesign(sourceTarget, { type: 'RemoveElement', id: titleHost.id });
  check('宿主断开时页面占位符以同一身份安全降级',
    placeholderEditor.effectiveElement(title.id).x === 333
      && placeholderDoc.elements[title.id] === title);
  const detachedSaved = await placeholderEditor.save();
  const detachedReopened = await core.parse(detachedSaved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const detachedTitle = detachedReopened.slides[0].elements.find((element) =>
    element.editInfo?.placeholder?.type === 'title');
  const detachedLayout = detachedReopened.editInfo.layouts.find((candidate) =>
    candidate.id === sourceLayoutId);
  check('宿主断开保存时把必要外观降级到页面且重开不复活已删宿主',
    detachedTitle?.x === 333
      && !detachedLayout?.elements.some((element) =>
        element.editInfo?.placeholder?.type === titleHost.meta.ph.type));
  placeholderEditor.undo();
  check('撤销宿主删除后按原继承地址重绑且不替换页面逻辑身份',
    placeholderEditor.effectiveElement(title.id).x === 333
      && placeholderDoc.elements[title.id] === title
      && placeholderDoc.elements[titleHost.id]?.parent === sourceLayoutId);
  check('showMasterSp=false 在版式进入编辑态后仍屏蔽母版图形',
    !placeholderEditor.toSlide(slideId).elements.some((element) => element.name === '母版标记'));
  edit.disposeDoc(placeholderDoc);

  const dependencyPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const dependencyDoc = edit.createDoc(dependencyPresentation, { idPrefix: 'layout-dependency-' });
  const dependencyEditor = new edit.Editor(dependencyDoc);
  const dependencySource = dependencyDoc.slideOrder[0];
  const dependencyLayout = dependencyDoc.slides[dependencySource].layoutId;
  const dependencyTarget = { kind: 'layout', id: dependencyLayout };
  const dependencyElement = dependencyDoc.layouts[dependencyLayout].children
    .map((id) => dependencyDoc.elements[id]).find((element) => element.meta.editable === 'full');
  dependencyEditor.execDesign(dependencyTarget, {
    type: 'SetXfrm', id: dependencyElement.id, x: dependencyElement.src.x + 1,
  });
  dependencyEditor.undo(); // 先建立反向索引，再验证增量维护。
  const addedSame = [...dependencyEditor.exec({
    type: 'AddSlide', layoutId: dependencyLayout, at: { after: dependencySource },
  }).createdSlides][0];
  const afterAdd = dependencyEditor.execDesign(dependencyTarget, {
    type: 'SetXfrm', id: dependencyElement.id, x: dependencyElement.src.x + 2,
  });
  check('AddSlide 增量加入版式反向依赖',
    afterAdd.dirtySlides.has(dependencySource) && afterAdd.dirtySlides.has(addedSame));
  const otherLayout = dependencyDoc.layoutOrder.find((id) => id !== dependencyLayout);
  dependencyEditor.exec({ type: 'SetLayout', id: addedSame, layoutId: otherLayout });
  const afterLayout = dependencyEditor.execDesign(dependencyTarget, {
    type: 'SetXfrm', id: dependencyElement.id, x: dependencyElement.src.x + 3,
  });
  check('SetLayout 增量迁移版式反向依赖',
    afterLayout.dirtySlides.has(dependencySource) && !afterLayout.dirtySlides.has(addedSame));
  dependencyEditor.exec({ type: 'RemoveSlide', id: dependencySource });
  const afterRemove = dependencyEditor.execDesign(dependencyTarget, {
    type: 'SetXfrm', id: dependencyElement.id, x: dependencyElement.src.x + 4,
  });
  const remainingSource = dependencyDoc.slideOrder.find((id) =>
    dependencyDoc.slides[id].layoutId === dependencyLayout);
  check('RemoveSlide 增量移除自身但保留共享版式的其余反向依赖',
    afterRemove.dirtySlides.size === 1 && afterRemove.dirtySlides.has(remainingSource));
  dependencyEditor.exec({ type: 'RemoveSlide', id: remainingSource });
  const afterLastRemove = dependencyEditor.execDesign(dependencyTarget, {
    type: 'SetXfrm', id: dependencyElement.id, x: dependencyElement.src.x + 5,
  });
  check('删除最后一页后版式反向依赖归零', afterLastRemove.dirtySlides.size === 0);
  edit.disposeDoc(dependencyDoc);

  const recoveryPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveryDoc = edit.createDoc(recoveryPresentation, { idPrefix: 'layout-recovery-' });
  const recoveryEditor = new edit.Editor(recoveryDoc);
  const recoveryFrames = [];
  recoveryEditor.subscribeRecovery((frame) => recoveryFrames.push(frame));
  const recoveryLayout = edit.listLayouts(recoveryDoc)[0];
  const recoveryElement = recoveryDoc.layouts[recoveryLayout.id].children
    .map((id) => recoveryDoc.elements[id]).find((element) => element.meta.editable === 'full');
  recoveryEditor.execDesign(recoveryLayout.target, {
    type: 'SetBackground', target: recoveryLayout.target,
    fill: { type: 'solid', color: '#506070' },
  });
  recoveryEditor.execDesign(recoveryLayout.target, {
    type: 'SetXfrm', id: recoveryElement.id, x: recoveryElement.src.x + 77,
  });
  const replayPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const replayDoc = edit.createDoc(replayPresentation, { idPrefix: 'layout-recovery-' });
  const replayEditor = new edit.Editor(replayDoc, {
    recoveryFrames: JSON.parse(JSON.stringify(recoveryFrames)),
  });
  check('版式属性与元素 Patch 可序列化恢复到同一设计投影',
    JSON.stringify(replayEditor.toDesignCanvas(recoveryLayout.target))
      === JSON.stringify(recoveryEditor.toDesignCanvas(recoveryLayout.target)));
  const atomicPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const atomicDoc = edit.createDoc(atomicPresentation, { idPrefix: 'layout-recovery-' });
  const brokenFrames = JSON.parse(JSON.stringify(recoveryFrames));
  brokenFrames[1].sequence = brokenFrames[0].sequence;
  const beforeAtomic = JSON.stringify(atomicDoc.layouts[recoveryLayout.id].ovr);
  let rejectedBrokenTail = false;
  try { edit.restoreRecoveryFrames(atomicDoc, brokenFrames); } catch { rejectedBrokenTail = true; }
  check('版式恢复坏尾失败时不污染目标文档',
    rejectedBrokenTail
      && JSON.stringify(atomicDoc.layouts[recoveryLayout.id].ovr) === beforeAtomic);
  edit.disposeDoc(recoveryDoc);
  edit.disposeDoc(replayDoc);
  edit.disposeDoc(atomicDoc);

  const minimalPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const minimalDoc = edit.createDoc(minimalPresentation, { idPrefix: 'layout-minimal-' });
  const minimalEditor = new edit.Editor(minimalDoc);
  const minimalLayout = edit.listLayouts(minimalDoc)[0];
  const minimalElement = minimalDoc.layouts[minimalLayout.id].children
    .map((id) => minimalDoc.elements[id]).find((element) => element.meta.editable === 'full');
  const originalLayoutBytes = minimalPresentation.package.parts[minimalLayout.id].slice();
  minimalEditor.execDesign(minimalLayout.target, {
    type: 'SetXfrm', id: minimalElement.id, x: minimalElement.src.x + 19,
  });
  const minimalSaved = await minimalEditor.saveDetailed();
  check('纯版式变换补丁保存只重写一个 layout part',
    minimalSaved.rewrittenEntries === 1);
  minimalEditor.undo();
  const restored = await minimalEditor.save();
  const restoredPresentation = await core.parse(restored, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  check('撤销至来源后版式 part 恢复逐字节直通',
    Buffer.compare(Buffer.from(restoredPresentation.package.parts[minimalLayout.id]),
      Buffer.from(originalLayoutBytes)) === 0);
  edit.disposeDoc(minimalDoc);

  const themedPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const themedDoc = edit.createDoc(themedPresentation, { idPrefix: 'layout-themed-' });
  const themedEditor = new edit.Editor(themedDoc);
  const themedLayout = edit.listLayouts(themedDoc).find((candidate) => candidate.name === '重点内容');
  const themedMarker = themedDoc.layouts[themedLayout.id].children
    .map((id) => themedDoc.elements[id]).find((element) => element.src.name === '目标版式角标');
  const originalMarkerColor = solid(themedEditor.effectiveElement(themedMarker.id).fill);
  themedEditor.exec({
    type: 'SetTheme', id: themedLayout.themeId, clrScheme: { accent2: '#AABBCC' },
  });
  const themedColor = solid(themedEditor.effectiveElement(themedMarker.id).fill);
  themedEditor.execDesign(themedLayout.target, {
    type: 'SetXfrm', id: themedMarker.id, x: themedMarker.src.x + 29,
  });
  const afterLayoutColor = solid(themedEditor.effectiveElement(themedMarker.id).fill);
  const themedSaved = await themedEditor.save();
  const themedReopened = await core.parse(themedSaved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedThemedLayout = themedReopened.editInfo.layouts.find((candidate) =>
    candidate.id === themedLayout.id);
  const reopenedThemedMarker = reopenedThemedLayout.elements.find((element) =>
    element.name === themedMarker.src.name);
  check('主题重解析后的版式基值不因后续元素编辑退回旧主题',
    originalMarkerColor !== 'rgb(170,187,204)'
      && themedColor === 'rgb(170,187,204)'
      && afterLayoutColor === themedColor
      && solid(reopenedThemedMarker?.fill) === themedColor);
  edit.disposeDoc(themedDoc);

  const resourcePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const resourceDoc = edit.createDoc(resourcePresentation, { idPrefix: 'layout-resource-' });
  const resourceEditor = new edit.Editor(resourceDoc);
  const resourceLayout = edit.listLayouts(resourceDoc).find((candidate) =>
    candidate.name === '重点内容');
  resourceEditor.execDesign(resourceLayout.target, {
    type: 'AddImage', target: resourceLayout.target,
    bytes: Uint8Array.from(Buffer.from(PNG_1PX, 'base64')), mime: 'image/png',
    rect: { x: 720, y: 80, w: 160, h: 90 },
  });
  const imageId = resourceEditor.selection.ids[0];
  resourceEditor.execDesign(resourceLayout.target, {
    type: 'AddTable', target: resourceLayout.target, rows: 2, cols: 2,
    rect: { x: 720, y: 220, w: 300, h: 140 },
  });
  const tableId = resourceEditor.selection.ids[0];
  const tableStyle = edit.listTableStyles(resourceDoc, resourceLayout.target)[0];
  resourceEditor.execDesign(resourceLayout.target, {
    type: 'SetTableStyle', id: tableId, styleId: tableStyle.styleId,
    firstRow: true, lastRow: false, bandRow: true,
    firstCol: false, lastCol: false, bandCol: false,
  });
  const styledTable = resourceEditor.effectiveElement(tableId);
  const resourceSaved = await resourceEditor.saveDetailed();
  const resourceDiff = diffPackageBytes(input, resourceSaved.bytes);
  const resourceReopened = await core.parse(resourceSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const resourceReopenedLayout = resourceReopened.editInfo.layouts.find((candidate) =>
    candidate.id === resourceLayout.id);
  check('版式图片与表格复用插入命令并保存真实 OPC 资源闭包',
    resourceReopenedLayout?.elements.some((element) =>
      element.name === resourceDoc.elements[imageId].src.name && element.kind === 'image')
      && resourceReopenedLayout?.elements.some((element) =>
        element.name === resourceDoc.elements[tableId].src.name && element.kind === 'table'
          && element.editInfo?.tableStyle?.styleId === tableStyle.styleId)
      && styledTable.kind === 'table'
      && styledTable.editInfo?.tableStyle?.styleId === tableStyle.styleId
      && resourceDiff.added.some((part) => part.startsWith('ppt/media/'))
      && resourceDiff.changed.includes(resourceLayout.id)
      && resourceDiff.changed.includes(`ppt/slideLayouts/_rels/${resourceLayout.id.split('/').at(-1)}.rels`)
      && !resourceDiff.changed.some((part) => part.startsWith('ppt/slides/')));
  edit.disposeDoc(resourceDoc);

  const generatedPresentation = await core.parse(load('sample-generated-save.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const generatedDoc = edit.createDoc(generatedPresentation, { idPrefix: 'layout-generated-' });
  const generatedEditor = new edit.Editor(generatedDoc);
  const generatedSlide = generatedDoc.slideOrder[0];
  const generatedLayout = edit.listLayouts(generatedDoc).find((candidate) =>
    candidate.id === generatedDoc.slides[generatedSlide].layoutId);
  generatedEditor.execDesign(generatedLayout.target, {
    type: 'AddShape', target: generatedLayout.target, preset: 'roundRect',
    rect: { x: 1040, y: 520, w: 160, h: 80 },
  });
  const generatedElement = generatedDoc.elements[generatedEditor.selection.ids[0]];
  const generatedExpected = generatedEditor.toSlide(generatedSlide).elements.find((element) =>
    element.name === generatedElement.src.name)?.x;
  generatedPresentation.dispose();
  const generatedBytes = await generatedEditor.save();
  const generatedReopened = await core.parse(generatedBytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const generatedActual = generatedReopened.slides[0].elements.find((element) =>
    element.name === generatedElement.src.name)?.x;
  check('生成保存把有效版式视觉物化到独立 PPTX',
    generatedActual === generatedExpected,
    `元素 ${generatedElement.src.name}，期望 x=${generatedExpected}，实际 x=${generatedActual}`);
  edit.disposeDoc(generatedDoc);
}

const textOf = (element) => element?.kind === 'shape' && element.text
  ? element.text.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')
  : '';
