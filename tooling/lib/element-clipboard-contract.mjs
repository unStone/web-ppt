import { createHash } from 'node:crypto';
import { runClipboardMaterializationContract } from './element-clipboard-materialization-contract.mjs';
import { makePng } from './ooxml.mjs';

function worldBounds(edit, doc, ids) {
  const points = ids.flatMap((id) => {
    const element = edit.effectiveElement(doc, id);
    return [
      { x: 0, y: 0 }, { x: element.w, y: 0 },
      { x: element.w, y: element.h }, { x: 0, y: element.h },
    ].map((point) => edit.elementFrameToSlidePoint(doc, id, point));
  });
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
  };
}

/** 首个 tracer bullet 只经过发布的载荷、命令、投影、选区与历史 seam。 */
export async function runElementClipboardContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 元素复制剪切粘贴\x1b[0m');
  if (!check('edit-core 发布元素剪贴板 seam', typeof edit.copyElements === 'function')) return;
  const bytes = load('sample-editor-space.pptx');
  if (!check('找到元素剪贴板基础固件', !!bytes)) return;
  const presentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'clipboard-basic-' });
  const editor = new edit.Editor(doc);
  const byName = (name) => Object.values(doc.elements).find((record) => record.src.name === name);
  const plain = byName('space-plain');
  const group = byName('space-outer-group');
  if (!check('基础固件含普通元素与嵌套组合根', !!plain && !!group?.children?.length)) return;

  let nestedRootsRejected = false;
  try { edit.copyElements(doc, [group.id, group.children[0]]); } catch (error) {
    nestedRootsRejected = /祖先与其后代/.test(String(error));
  }
  check('复制 seam 拒绝重复表达同一子树的嵌套根', nestedRootsRejected);

  const payload = edit.copyElements(doc, [plain.id, group.id]);
  const json = JSON.stringify(payload);
  const slideId = edit.slideOfElement(doc, plain.id);
  const beforeChildren = [...doc.slides[slideId].children];
  check('剪贴板载荷版本化、纯 JSON 且不泄漏会话身份',
    payload.format === 'web-ppt-elements' && payload.version === 1
      && JSON.parse(json).roots.length === 2 && !json.includes(doc.identity.prefix));

  const pasted = editor.exec({
    type: 'PasteElements', payload: JSON.parse(json), at: { parentId: slideId, x: 500, y: 300 },
  });
  const selection = editor.selection;
  const pastedIds = selection.kind === 'elements' ? [...selection.ids] : [];
  const pastedBounds = worldBounds(edit, doc, pastedIds);
  check('粘贴分配新身份、保持组合层级并以视觉并集左上角落位',
    pastedIds.length === 2 && pastedIds.every((id) => !beforeChildren.includes(id))
      && pastedIds.every((id) => doc.slides[slideId].children.includes(id))
      && pastedIds.some((id) => doc.elements[id].children?.length === group.children.length)
      && Math.abs(pastedBounds.left - 500) < 1e-6 && Math.abs(pastedBounds.top - 300) < 1e-6
      && pasted.forward.length === 2 && editor.history.undoCount === 1 && editor.isDirty());

  editor.undo();
  check('撤销粘贴原子移除全部新树并恢复原选区与干净状态',
    pastedIds.every((id) => !doc.elements[id] && !doc.slides[slideId].children.includes(id))
      && editor.selection.kind === 'none' && editor.history.undoCount === 0
      && editor.history.redoCount === 1 && !editor.isDirty());
  editor.redo();
  check('重做粘贴恢复同一身份、层级、位置和选区',
    pastedIds.every((id) => !!doc.elements[id] && doc.slides[slideId].children.includes(id))
      && editor.selection.kind === 'elements' && editor.selection.ids.join(',') === pastedIds.join(',')
      && Math.abs(worldBounds(edit, doc, pastedIds).left - 500) < 1e-6);
  const pastedGroupId = pastedIds.find((id) => doc.elements[id].src.kind === 'group');
  const editedChildId = doc.elements[pastedGroupId].children[0];
  const editedChildX = edit.effectiveElement(doc, editedChildId).x + 33;
  editor.exec({ type: 'SetXfrm', id: editedChildId, x: editedChildX });
  editor.exec({ type: 'RemoveElement', id: doc.elements[pastedGroupId].children[1] });
  const repeatedPayload = edit.copyElements(doc, pastedIds);
  editor.exec({
    type: 'PasteElements', payload: repeatedPayload, at: { parentId: slideId, x: 700, y: 450 },
  });
  const repeatedSelection = editor.selection;
  const repeatedIds = repeatedSelection.kind === 'elements' ? [...repeatedSelection.ids] : [];
  const repeatedGroupId = repeatedIds.find((id) => doc.elements[id].src.kind === 'group');
  const repeatedChildId = doc.elements[repeatedGroupId].children[0];
  check('未保存的新树可立即再次复制并保留关系、层级与新身份',
    repeatedIds.length === pastedIds.length
      && repeatedIds.every((id) => !pastedIds.includes(id) && !!doc.elements[id])
      && repeatedIds.some((id) => doc.elements[id].children?.length === group.children.length - 1)
      && Math.abs(worldBounds(edit, doc, repeatedIds).left - 700) < 1e-6);
  check('二次复制把未保存后代编辑物化进新插入片段',
    Math.abs(edit.effectiveElement(doc, repeatedChildId).x - editedChildX) < 1e-6);
  const saved = await editor.save();
  const reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
  const reopenedDoc = edit.createDoc(reopened, { idPrefix: 'clipboard-basic-reopen-' });
  const pastedByName = Object.values(reopenedDoc.elements)
    .filter((record) => record.src.name === plain.src.name || record.src.name === group.src.name);
  const reopenedPasted = pastedByName.slice(-2).map((record) => record.id);
  check('保存重开保留粘贴元素树与视觉落点',
    pastedByName.length === 6 && reopenedPasted.length === 2
      && Math.abs(worldBounds(edit, reopenedDoc, reopenedPasted).left - 700) < 1e-6
      && pastedByName.some((record) => record.src.kind === 'group'
        && record.children?.length === group.children.length));
  const reopenedEditedGroups = pastedByName.filter((record) => record.src.kind === 'group')
    .filter((record) => record.children?.some((id) =>
      Math.abs(edit.effectiveElement(reopenedDoc, id).x - editedChildX) < 1e-6));
  const reopenedGroupSizes = pastedByName.filter((record) => record.src.kind === 'group')
    .map((record) => record.children?.length ?? 0).sort();
  check('后代编辑与删除经二次复制保存重开不回退或复活',
    reopenedEditedGroups.length >= 2 && reopenedGroupSizes.join(',') === '1,1,2');
  edit.disposeDoc(reopenedDoc);

  const readonlyPresentation = await core.parse(bytes, { edit: true, lazy: false, assets: 'defer' });
  const readonlyDoc = edit.createDoc(readonlyPresentation, { idPrefix: 'clipboard-readonly-' });
  const readonlyEditor = new edit.Editor(readonlyDoc);
  const readonlyIdentity = readonlyDoc.identity.nextElement;
  let readonlyRejected = false;
  try {
    readonlyEditor.exec({
      type: 'PasteElements', payload,
      at: { parentId: readonlyDoc.slideOrder[0], x: 10, y: 10 },
    });
  } catch (error) { readonlyRejected = /只读/.test(String(error)); }
  check('只读文档在身份分配与历史之前拒绝粘贴',
    readonlyRejected && readonlyDoc.identity.nextElement === readonlyIdentity
      && readonlyEditor.history.undoCount === 0);
  edit.disposeDoc(readonlyDoc);
  edit.disposeDoc(doc);

  const flipPresentation = await core.parse(load('sample-editor-space.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const flipDoc = edit.createDoc(flipPresentation, { idPrefix: 'clipboard-flip-' });
  const flipEditor = new edit.Editor(flipDoc);
  const flipPlain = Object.values(flipDoc.elements).find((record) => record.src.name === 'space-plain');
  const flippedGroup = Object.values(flipDoc.elements).find((record) => record.src.name === 'space-outer-group');
  const flipPayload = edit.copyElements(flipDoc, [flipPlain.id]);
  flipEditor.exec({
    type: 'PasteElements', payload: flipPayload,
    at: { parentId: flippedGroup.id, x: 760, y: 420 },
  });
  const flippedId = flipEditor.selection.kind === 'elements' ? flipEditor.selection.ids[0] : null;
  check('粘入翻转组以根 flip 补偿手性并保持世界视觉落点',
    !!flippedId && flipDoc.elements[flippedId].parent === flippedGroup.id
      && flipDoc.elements[flippedId].ovr.flipH === !flipPlain.src.flipH
      && Math.abs(worldBounds(edit, flipDoc, [flippedId]).left - 760) < 1e-6
      && Math.abs(worldBounds(edit, flipDoc, [flippedId]).top - 420) < 1e-6);
  const flipSaved = await flipEditor.save();
  const flipReopened = await core.parse(flipSaved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const flipReopenedDoc = edit.createDoc(flipReopened, { idPrefix: 'clipboard-flip-reopen-' });
  const reopenedFlippedGroup = Object.values(flipReopenedDoc.elements)
    .find((record) => record.src.name === 'space-outer-group');
  const reopenedFlipped = Object.values(flipReopenedDoc.elements)
    .find((record) => record.src.name === 'space-plain' && record.parent === reopenedFlippedGroup?.id);
  const reopenedFlipBounds = reopenedFlipped ? worldBounds(edit, flipReopenedDoc, [reopenedFlipped.id]) : null;
  check('翻转组内粘贴保存重开仍保持手性与视觉落点',
    !!reopenedFlipped && reopenedFlipped.src.flipH === !flipPlain.src.flipH
      && Math.abs(reopenedFlipBounds.left - 760) < 2e-4
      && Math.abs(reopenedFlipBounds.top - 420) < 2e-4,
    JSON.stringify({ flipH: reopenedFlipped?.src.flipH, bounds: reopenedFlipBounds }));
  edit.disposeDoc(flipReopenedDoc);
  edit.disposeDoc(flipDoc);

  const groupPresentation = await core.parse(load('sample-editor-layer.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const groupDoc = edit.createDoc(groupPresentation, { idPrefix: 'clipboard-group-' });
  const groupEditor = new edit.Editor(groupDoc);
  const targetGroup = Object.values(groupDoc.elements).find((record) => record.src.name === 'layer-group');
  const childA = Object.values(groupDoc.elements).find((record) => record.src.name === 'layer-child-a');
  const childB = Object.values(groupDoc.elements).find((record) => record.src.name === 'layer-child-b');
  const topLevel = Object.values(groupDoc.elements).find((record) => record.src.name === 'layer-back');
  if (!check('组合坐标固件含嵌套根与可写目标组', !!targetGroup && !!childA && !!childB && !!topLevel)) return;
  const nestedPayload = edit.copyElements(groupDoc, [childA.id, childB.id]);
  groupEditor.exec({
    type: 'PasteElements', payload: nestedPayload,
    at: { parentId: groupDoc.slideOrder[0], x: 500, y: 430 },
  });
  const unnestedIds = groupEditor.selection.kind === 'elements' ? [...groupEditor.selection.ids] : [];
  const topPayload = edit.copyElements(groupDoc, [topLevel.id]);
  groupEditor.exec({
    type: 'PasteElements', payload: topPayload,
    at: { parentId: targetGroup.id, x: 100, y: 520 },
  });
  const regroupedIds = groupEditor.selection.kind === 'elements' ? [...groupEditor.selection.ids] : [];
  groupEditor.exec({
    type: 'PasteElements', payload: topPayload,
    at: { parentId: groupDoc.slideOrder[1], x: 60, y: 70 },
  });
  const crossPageIds = groupEditor.selection.kind === 'elements' ? [...groupEditor.selection.ids] : [];
  check('嵌套根出组与顶层根入组都按幻灯片视觉坐标落位',
    unnestedIds.length === 2 && unnestedIds.every((id) => groupDoc.elements[id].parent === groupDoc.slideOrder[0])
      && Math.abs(worldBounds(edit, groupDoc, unnestedIds).left - 500) < 1e-6
      && Math.abs(worldBounds(edit, groupDoc, unnestedIds).top - 430) < 1e-6
      && regroupedIds.length === 1 && groupDoc.elements[regroupedIds[0]].parent === targetGroup.id
      && Math.abs(worldBounds(edit, groupDoc, regroupedIds).left - 100) < 1e-6
      && Math.abs(worldBounds(edit, groupDoc, regroupedIds).top - 520) < 1e-6);
  check('跨页粘贴改用目标 slide part 并保持视觉落点',
    crossPageIds.length === 1 && groupDoc.elements[crossPageIds[0]].parent === groupDoc.slideOrder[1]
      && Math.abs(worldBounds(edit, groupDoc, crossPageIds).left - 60) < 1e-6
      && Math.abs(worldBounds(edit, groupDoc, crossPageIds).top - 70) < 1e-6);
  const groupSaved = await groupEditor.save();
  const groupReopened = await core.parse(groupSaved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const groupReopenedDoc = edit.createDoc(groupReopened, { idPrefix: 'clipboard-group-reopen-' });
  const reopenedGroup = Object.values(groupReopenedDoc.elements)
    .find((record) => record.src.name === 'layer-group');
  const regrouped = Object.values(groupReopenedDoc.elements)
    .find((record) => record.src.name === 'layer-back' && record.parent === reopenedGroup?.id);
  check('组合内外粘贴保存重开保持宿主层级',
    !!reopenedGroup && !!regrouped
      && Object.values(groupReopenedDoc.elements).filter((record) => record.src.name === 'layer-child-a').length === 2
      && Object.values(groupReopenedDoc.elements).filter((record) => record.src.name === 'layer-child-b').length === 2);
  check('跨页粘贴保存重开仍属于目标页',
    Object.values(groupReopenedDoc.elements).some((record) =>
      record.src.name === 'layer-back' && record.parent === groupReopenedDoc.slideOrder[1]));
  edit.disposeDoc(groupReopenedDoc);
  edit.disposeDoc(groupDoc);
  await runClipboardMaterializationContract({ edit, core, load, check });

  const complexPresentation = await core.parse(load('sample-smartart.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const complexDoc = edit.createDoc(complexPresentation, { idPrefix: 'clipboard-complex-' });
  const complexEditor = new edit.Editor(complexDoc);
  const smartArt = Object.values(complexDoc.elements)
    .find((record) => record.src.name === 'SmartArt' && record.parent === complexDoc.slideOrder[0]);
  if (!check('复杂关系固件含可复制 SmartArt 根', !!smartArt)) return;
  const complexPayload = edit.copyElements(complexDoc, [smartArt.id]);
  const complexRelations = complexPayload.ooxml.roots[complexPayload.roots[0]].relationships ?? [];
  check('同包复杂对象载荷记录递归 OPC 闭包而不内联未知格式',
    complexRelations.length >= 4 && complexRelations.every((relationship) =>
      /^[0-9a-f]{64}$/.test(relationship.packageTarget?.rootHash ?? '')
        && /^[0-9a-f]{64}$/.test(relationship.packageTarget?.closureHash ?? '')
        && !JSON.stringify(relationship.packageTarget).includes('ppt/'))
      && complexPayload.resources.length === 0);
  complexEditor.exec({
    type: 'PasteElements', payload: complexPayload,
    at: { parentId: complexDoc.slideOrder[0], x: 120, y: 100 },
  });
  const insertedComplex = complexEditor.selection.kind === 'elements'
    ? [...complexEditor.selection.ids] : [];
  const repeatedComplexPayload = edit.copyElements(complexDoc, insertedComplex);
  complexEditor.exec({
    type: 'PasteElements', payload: repeatedComplexPayload,
    at: { parentId: complexDoc.slideOrder[0], x: 360, y: 100 },
  });
  const complexSaved = await complexEditor.save();
  const complexReopened = await core.parse(complexSaved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const complexReopenedDoc = edit.createDoc(complexReopened, { idPrefix: 'clipboard-complex-reopen-' });
  check('同文档复杂对象复制保存重开仍解析为完整 SmartArt',
    Object.values(complexReopenedDoc.elements).filter((record) =>
      record.src.name === 'SmartArt' && record.parent === complexReopenedDoc.slideOrder[0]).length === 3);
  edit.disposeDoc(complexReopenedDoc);

  const rejectPresentation = await core.parse(load('sample-editor-layer.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const rejectDoc = edit.createDoc(rejectPresentation, { idPrefix: 'clipboard-complex-reject-' });
  const rejectEditor = new edit.Editor(rejectDoc);
  const rejectIdentity = rejectDoc.identity.nextElement;
  const rejectCount = Object.keys(rejectDoc.elements).length;
  let rejectedComplex = false;
  try {
    rejectEditor.exec({
      type: 'PasteElements', payload: complexPayload,
      at: { parentId: rejectDoc.slideOrder[0], x: 100, y: 100 },
    });
  } catch (error) {
    rejectedComplex = /OPC 闭包/.test(String(error));
  }
  check('跨文档复杂对象在分配身份与落模前原子拒绝',
    rejectedComplex && rejectDoc.identity.nextElement === rejectIdentity
      && Object.keys(rejectDoc.elements).length === rejectCount && rejectEditor.history.undoCount === 0);
  edit.disposeDoc(rejectDoc);
  edit.disposeDoc(complexDoc);

  const mediaPresentation = await core.parse(load('sample-editor-delete.pptx'), {
    edit: true, keepPackage: true, lazy: false,
  });
  const linkPresentation = await core.parse(load('sample-editor-layer.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const destinationPresentation = await core.parse(load('sample-editor-layer.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const mediaDoc = edit.createDoc(mediaPresentation, { idPrefix: 'clipboard-media-' });
  const linkDoc = edit.createDoc(linkPresentation, { idPrefix: 'clipboard-link-' });
  const destinationDoc = edit.createDoc(destinationPresentation, { idPrefix: 'clipboard-destination-' });
  const picture = Object.values(mediaDoc.elements).find((record) => record.src.name === 'delete-picture');
  const link = Object.values(linkDoc.elements).find((record) => record.src.name === 'layer-link');
  if (!check('关系闭包固件含图片与外部超链接', !!picture && !!link)) return;
  const mediaPayload = edit.copyElements(mediaDoc, [picture.id]);
  const linkPayload = edit.copyElements(linkDoc, [link.id]);
  const resource = mediaPayload.resources[0];
  const expectedHash = createHash('sha256').update(mediaDoc.package.parts['ppt/media/image1.png']).digest('hex');
  check('图片载荷内联规范化资源并记录根级关系闭包',
    mediaPayload.resources.length === 1 && /^[0-9a-f]{64}$/.test(resource?.hash ?? '')
      && resource?.hash === expectedHash
      && resource?.mime === 'image/png' && /^[A-Za-z0-9+/]+={0,2}$/.test(resource?.bytes ?? '')
      && mediaPayload.ooxml.roots[mediaPayload.roots[0]].relationships?.length === 1
      && !JSON.stringify(mediaPayload).includes('blob:')
      && JSON.stringify(mediaPayload).includes(`web-ppt-resource:${resource.hash}`));
  check('外部超链接只携带关系、不复制伪资源',
    linkPayload.resources.length === 0
      && linkPayload.ooxml.roots[linkPayload.roots[0]].relationships?.[0]?.target
        === 'https://example.com/layer');
  edit.disposeDoc(mediaDoc);
  edit.disposeDoc(linkDoc);

  const destinationEditor = new edit.Editor(destinationDoc);
  const destinationSlide = destinationDoc.slideOrder[0];
  const stressPayload = (count) => {
    const value = JSON.parse(JSON.stringify(mediaPayload));
    const root = value.roots[0];
    const baseRelationship = value.ooxml.roots[root].relationships[0];
    for (let index = 0; index < count; index++) {
      const bytes = makePng(1, 1, () => [index & 255, index >>> 8, 255 - (index & 255)]);
      const hash = createHash('sha256').update(bytes).digest('hex');
      value.resources.push({
        hash, mime: 'image/png', extension: 'png', bytes: Buffer.from(bytes).toString('base64'),
      });
      value.ooxml.roots[root].relationships.push({
        sourceId: `rStress${index}`, type: baseRelationship.type, resourceHash: hash,
      });
    }
    return value;
  };
  const resourcePayloadSizes = [64, 128, 256].map((count) => JSON.stringify(stressPayload(count)).length);
  const manyResources = stressPayload(256);
  destinationEditor.exec({
    type: 'PasteElements', payload: manyResources,
    at: { parentId: destinationSlide, x: 5, y: 5 },
  });
  const stressRoot = destinationEditor.selection.kind === 'elements'
    ? destinationDoc.elements[destinationEditor.selection.ids[0]] : null;
  check('多资源载荷按线性结构完整准备且大小线性增长',
    stressRoot?.meta.insertion?.resources?.length === 257
      && resourcePayloadSizes[1] < resourcePayloadSizes[0] * 2.2
      && resourcePayloadSizes[2] < resourcePayloadSizes[1] * 2.2);
  destinationEditor.undo();
  const malformed = JSON.parse(JSON.stringify(mediaPayload));
  malformed.resources[0].hash = '0'.repeat(64);
  const identityBeforeReject = destinationDoc.identity.nextElement;
  const countBeforeReject = Object.keys(destinationDoc.elements).length;
  let malformedRejected = false;
  try {
    destinationEditor.exec({
      type: 'PasteElements', payload: malformed,
      at: { parentId: destinationSlide, x: 10, y: 10 },
    });
  } catch (error) {
    malformedRejected = /哈希不匹配/.test(String(error));
  }
  check('非法媒体哈希在身份分配和模型修改前原子拒绝',
    malformedRejected && destinationDoc.identity.nextElement === identityBeforeReject
      && Object.keys(destinationDoc.elements).length === countBeforeReject
      && destinationEditor.history.undoCount === 0);

  const duplicateSpid = JSON.parse(JSON.stringify(payload));
  const duplicateRoot = duplicateSpid.roots.find((root) => duplicateSpid.records[root].children.length);
  const duplicateChild = duplicateSpid.records[duplicateRoot].children[0];
  duplicateSpid.records[duplicateChild].meta.sourceSpid = duplicateSpid.records[duplicateRoot].meta.sourceSpid;
  const duplicateIdentity = destinationDoc.identity.nextElement;
  let duplicateRejected = false;
  try {
    destinationEditor.exec({
      type: 'PasteElements', payload: duplicateSpid,
      at: { parentId: destinationSlide, x: 20, y: 20 },
    });
  } catch (error) { duplicateRejected = /spid 重复/.test(String(error)); }
  check('重复来源身份在分配 EditDoc id 前原子拒绝',
    duplicateRejected && destinationDoc.identity.nextElement === duplicateIdentity
      && destinationEditor.history.undoCount === 0);

  const mixedSource = JSON.parse(JSON.stringify(mediaPayload));
  mixedSource.records[mixedSource.roots[0]].meta.copyBatchId = 'f'.repeat(32);
  const mixedIdentity = destinationDoc.identity.nextElement;
  let mixedRejected = false;
  try {
    destinationEditor.exec({
      type: 'PasteElements', payload: mixedSource,
      at: { parentId: destinationSlide, x: 30, y: 30 },
    });
  } catch (error) { mixedRejected = /记录无效/.test(String(error)); }
  check('跨复制来源拼接载荷在分配身份前原子拒绝',
    mixedRejected && destinationDoc.identity.nextElement === mixedIdentity
      && destinationEditor.history.undoCount === 0);

  const lateFailure = JSON.parse(JSON.stringify(payload));
  lateFailure.records[lateFailure.roots[0]].meta.geom = { invalid: () => undefined };
  const lateIdentity = destinationDoc.identity.nextElement;
  let lateRejected = false;
  try {
    destinationEditor.exec({
      type: 'PasteElements', payload: lateFailure,
      at: { parentId: destinationSlide, x: 40, y: 40 },
    });
  } catch { lateRejected = true; }
  check('构造树阶段的晚失败也回滚身份分配与历史',
    lateRejected && destinationDoc.identity.nextElement === lateIdentity
      && destinationEditor.history.undoCount === 0);
  destinationEditor.exec({
    type: 'PasteElements', payload: JSON.parse(JSON.stringify(mediaPayload)),
    at: { parentId: destinationSlide, x: 760, y: 80 },
  });
  const insertedMedia = destinationEditor.selection.kind === 'elements'
    ? [...destinationEditor.selection.ids] : [];
  const repeatedMediaPayload = edit.copyElements(destinationDoc, insertedMedia);
  check('新粘贴图片再次复制只携带一份按哈希去重的线性资源',
    repeatedMediaPayload.resources.length === 1
      && repeatedMediaPayload.resources[0].hash === mediaPayload.resources[0].hash
      && !JSON.stringify(repeatedMediaPayload).includes('data:image'));
  destinationEditor.exec({
    type: 'PasteElements', payload: repeatedMediaPayload,
    at: { parentId: destinationSlide, x: 760, y: 230 },
  });
  destinationEditor.exec({
    type: 'PasteElements', payload: JSON.parse(JSON.stringify(linkPayload)),
    at: { parentId: destinationSlide, x: 760, y: 390 },
  });
  const relationshipSaved = await destinationEditor.save();
  const relationshipReopened = await core.parse(relationshipSaved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const relationshipDoc = edit.createDoc(relationshipReopened, { idPrefix: 'clipboard-rel-reopen-' });
  const mediaParts = Object.keys(relationshipDoc.package.parts).filter((part) => part.startsWith('ppt/media/'));
  const copiedPictures = Object.values(relationshipDoc.elements)
    .filter((record) => record.src.name === 'delete-picture' && record.src.kind === 'image');
  const copiedLinks = Object.values(relationshipDoc.elements)
    .filter((record) => record.src.name === 'layer-link' && record.src.link === 'https://example.com/layer');
  check('跨文档保存重建关系并按内容哈希去重媒体',
    mediaParts.length === 1 && copiedPictures.length === 2 && copiedLinks.length === 2);
  edit.disposeDoc(relationshipDoc);

  destinationEditor.undo();
  destinationEditor.undo();
  destinationEditor.undo();
  const undoneSaved = await destinationEditor.save();
  const undonePresentation = await core.parse(undoneSaved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const undoneDoc = edit.createDoc(undonePresentation, { idPrefix: 'clipboard-rel-undone-' });
  check('保存后撤销再保存会清除会话媒体并恢复关系基线',
    !Object.keys(undoneDoc.package.parts).some((part) => part.startsWith('ppt/media/'))
      && !Object.values(undoneDoc.elements).some((record) => record.src.name === 'delete-picture')
      && Object.values(undoneDoc.elements).filter((record) =>
        record.src.name === 'layer-link' && record.src.link === 'https://example.com/layer').length === 1);
  edit.disposeDoc(undoneDoc);

  destinationEditor.redo();
  destinationEditor.redo();
  destinationEditor.redo();
  const redoneSaved = await destinationEditor.save();
  const redonePresentation = await core.parse(redoneSaved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const redoneDoc = edit.createDoc(redonePresentation, { idPrefix: 'clipboard-rel-redone-' });
  check('撤销后的重做保存可重建同一去重资源与全部关系',
    Object.keys(redoneDoc.package.parts).filter((part) => part.startsWith('ppt/media/')).length === 1
      && Object.values(redoneDoc.elements).filter((record) => record.src.name === 'delete-picture').length === 2
      && Object.values(redoneDoc.elements).filter((record) =>
        record.src.name === 'layer-link' && record.src.link === 'https://example.com/layer').length === 2);
  edit.disposeDoc(redoneDoc);
  edit.disposeDoc(destinationDoc);
  edit.disposeDoc(linkDoc);
  edit.disposeDoc(mediaDoc);
}
