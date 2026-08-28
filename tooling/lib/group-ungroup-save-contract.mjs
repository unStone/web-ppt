import { unzipSync } from 'fflate';

const decoder = new TextDecoder();

function namedHost(bytes, name, tag) {
  const slide = decoder.decode(unzipSync(bytes)['ppt/slides/slide1.xml']);
  const named = slide.indexOf(`name="${name}"`);
  const from = slide.lastIndexOf(`<${tag}>`, named);
  const to = slide.indexOf(`</${tag}>`, named);
  return from >= 0 && to >= 0 ? slide.slice(from, to + tag.length + 3) : '';
}

const byName = (doc, name) => Object.values(doc.elements).find((record) => record.src.name === name);

/** 保存验收分别物化新 grpSp 与来源 grpSp 展开，且观察未触碰宿主逐字节直通。 */
export async function runGroupUngroupSaveContract({ edit, core, load, check, saveArtifact }) {
  console.log('\n\x1b[36m▸ 组合与解组保留型保存\x1b[0m');
  const input = load('sample-editor-space.pptx');
  const groupedPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const groupedDoc = edit.createDoc(groupedPresentation, { idPrefix: 'group-save-' });
  const groupedEditor = new edit.Editor(groupedDoc);
  const groupTargets = ['space-plain', 'space-rotated-flipped'].map((name) => byName(groupedDoc, name));
  groupedEditor.exec({ type: 'Group', ids: groupTargets.map((record) => record.id) });
  const groupId = groupedEditor.selection.ids[0];
  const groupName = '保存组合及组级链接';
  groupedEditor.exec({ type: 'SetName', id: groupId, name: groupName });
  groupedEditor.exec({
    type: 'SetLink', id: groupId,
    target: { kind: 'external', href: 'https://example.com/group-kept' },
  });
  const groupedSaved = await groupedEditor.saveDetailed();
  saveArtifact('group-elements.pptx', groupedSaved.bytes);
  const groupedReopenedPresentation = await core.parse(groupedSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const groupedReopened = edit.createDoc(groupedReopenedPresentation, { idPrefix: 'group-save-open-' });
  const reopenedGroup = byName(groupedReopened, groupName);
  check('新组合保存为唯一 grpSp，孩子身份与顺序保留', reopenedGroup?.src.kind === 'group'
    && reopenedGroup.children?.map((id) => groupedReopened.elements[id].src.name).join(',')
      === 'space-plain,space-rotated-flipped'
    && Object.values(groupedReopened.elements)
      .filter((record) => record.src.name === 'space-plain').length === 1
    && Object.values(groupedReopened.elements)
      .filter((record) => record.src.name === 'space-rotated-flipped').length === 1);
  check('新组合的组级名称与超链接保存重开',
    !!reopenedGroup && edit.queryElementLink(groupedReopened, [reopenedGroup.id]).value?.href
      === 'https://example.com/group-kept');
  check('组合保存未触碰的 45° 兄弟宿主逐字节直通',
    namedHost(input, 'space-rotated-45', 'p:sp')
      === namedHost(groupedSaved.bytes, 'space-rotated-45', 'p:sp'));
  edit.disposeDoc(groupedReopened);
  edit.disposeDoc(groupedDoc);

  const ungroupedPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const ungroupedDoc = edit.createDoc(ungroupedPresentation, { idPrefix: 'ungroup-save-' });
  const ungroupedEditor = new edit.Editor(ungroupedDoc);
  const sourceGroup = byName(ungroupedDoc, 'space-outer-group');
  const sourceChild = ungroupedDoc.elements[sourceGroup.children[1]];
  ungroupedEditor.exec({ type: 'SetName', id: sourceGroup.id, name: '应随组合消失的名称' });
  ungroupedEditor.exec({
    type: 'SetLink', id: sourceGroup.id,
    target: { kind: 'external', href: 'https://example.com/group-only' },
  });
  ungroupedEditor.exec({ type: 'SetName', id: sourceChild.id, name: '解组后保留的孩子' });
  ungroupedEditor.exec({
    type: 'SetLink', id: sourceChild.id,
    target: { kind: 'external', href: 'https://example.com/child-kept' },
  });
  ungroupedEditor.exec({ type: 'Ungroup', id: sourceGroup.id });
  const ungroupedSaved = await ungroupedEditor.saveDetailed();
  saveArtifact('ungroup-elements.pptx', ungroupedSaved.bytes);
  const ungroupedReopenedPresentation = await core.parse(ungroupedSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const ungroupedReopened = edit.createDoc(ungroupedReopenedPresentation, {
    idPrefix: 'ungroup-save-open-',
  });
  const keptChild = byName(ungroupedReopened, '解组后保留的孩子');
  check('来源组合展开后组级名称/链接消失，孩子名称/链接保留',
    !byName(ungroupedReopened, 'space-outer-group')
      && !byName(ungroupedReopened, '应随组合消失的名称')
      && keptChild?.parent === ungroupedReopened.slideOrder[0]
      && edit.queryElementLink(ungroupedReopened, [keptChild.id]).value?.href
        === 'https://example.com/child-kept');
  check('解组保存未触碰的普通兄弟宿主逐字节直通',
    namedHost(input, 'space-plain', 'p:sp')
      === namedHost(ungroupedSaved.bytes, 'space-plain', 'p:sp'));
  edit.disposeDoc(ungroupedReopened);
  edit.disposeDoc(ungroupedDoc);

  const animationPresentation = await core.parse(load('sample-editor-animations.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const animationDoc = edit.createDoc(animationPresentation, { idPrefix: 'group-animation-' });
  const animationEditor = new edit.Editor(animationDoc);
  const animationSlide = animationDoc.slideOrder[1];
  const animationTargets = animationDoc.slides[animationSlide].children;
  animationEditor.exec({
    type: 'SetAnimations', slideId: animationSlide,
    steps: animationTargets.map((target, index) => ({
      target, kind: 'entrance', effect: 'fade', trigger: index ? 'afterPrev' : 'click',
      delayMs: 0, durationMs: 600 + index,
    })),
  });
  animationEditor.exec({ type: 'Group', ids: animationTargets });
  const animationGroup = animationEditor.selection.ids[0];
  const groupedAnimation = await animationEditor.saveDetailed();
  const groupedAnimationPresentation = await core.parse(groupedAnimation.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const groupedAnimationDoc = edit.createDoc(groupedAnimationPresentation, {
    idPrefix: 'group-animation-open-',
  });
  const groupedAnimationNames = edit.querySlideAnimations(
    groupedAnimationDoc, [groupedAnimationDoc.slideOrder[1]],
  ).value.map((step) => groupedAnimationDoc.elements[step.target].src.name);
  check('组合不改孩子 spid，动画目标保存重开仍指向组内原元素',
    groupedAnimationNames.join(',') === 'plain-a,plain-b'
      && groupedAnimationNames.every((name) => !!byName(groupedAnimationDoc, name)));
  edit.disposeDoc(groupedAnimationDoc);
  animationEditor.exec({ type: 'Ungroup', id: animationGroup });
  const ungroupedAnimation = await animationEditor.saveDetailed();
  const ungroupedAnimationPresentation = await core.parse(ungroupedAnimation.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const ungroupedAnimationDoc = edit.createDoc(ungroupedAnimationPresentation, {
    idPrefix: 'ungroup-animation-open-',
  });
  const ungroupedAnimationNames = edit.querySlideAnimations(
    ungroupedAnimationDoc, [ungroupedAnimationDoc.slideOrder[1]],
  ).value.map((step) => ungroupedAnimationDoc.elements[step.target].src.name);
  check('解组只移除组对象，孩子动画目标保存重开继续保留',
    ungroupedAnimationNames.join(',') === 'plain-a,plain-b');
  edit.disposeDoc(ungroupedAnimationDoc);
  edit.disposeDoc(animationDoc);
}
