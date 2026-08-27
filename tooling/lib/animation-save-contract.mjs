import { diffPackageBytes } from '../diff-package.mjs';
import { unzipSync, zipSync } from 'fflate';

const decoder = new TextDecoder();

const animationCarrier = (xml) => {
  const start = xml.indexOf('<mc:AlternateContent><mc:Choice Requires="p14"><p:timing');
  const end = start < 0 ? -1 : xml.indexOf('</mc:AlternateContent>', start);
  return start >= 0 && end >= 0 ? xml.slice(start, end + '</mc:AlternateContent>'.length) : '';
};

/** 从首次基线重建规范 timing，并只通过保存产物与重解析公开 Schema 取证。 */
export async function runAnimationSaveContract({ edit, core, load, check, saveArtifact }) {
  console.log('\n\x1b[36m▸ 元素动画保留型保存\x1b[0m');
  const input = load('sample-editor-animations.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'animation-save-' });
  const editor = new edit.Editor(doc);
  const [sourceSlide, plainSlide] = doc.slideOrder;
  const [plainA, plainB] = doc.slides[plainSlide].children;
  const motionPath = [
    ...Array.from({ length: 21 }, (_, index) => [index, 0]),
    [30, -2], [120, -60], [240, 30],
  ];
  const steps = [
    { target: plainA, kind: 'entrance', effect: 'appear', trigger: 'click', delayMs: 0, durationMs: 601 },
    { target: plainA, kind: 'entrance', effect: 'fade', trigger: 'click', delayMs: 0, durationMs: 602 },
    { target: plainA, kind: 'entrance', effect: 'fly', dir: 'l', trigger: 'click', delayMs: 0, durationMs: 610 },
    { target: plainA, kind: 'entrance', effect: 'fly', dir: 'r', trigger: 'click', delayMs: 0, durationMs: 620 },
    { target: plainA, kind: 'entrance', effect: 'fly', dir: 'u', trigger: 'click', delayMs: 0, durationMs: 630 },
    { target: plainA, kind: 'entrance', effect: 'fly', dir: 'd', trigger: 'click', delayMs: 0, durationMs: 650 },
    { target: plainA, kind: 'entrance', effect: 'wipe', dir: 'l', trigger: 'click', delayMs: 0, durationMs: 640 },
    { target: plainA, kind: 'entrance', effect: 'zoom', dir: 'in', trigger: 'click', delayMs: 0, durationMs: 660 },
    { target: plainA, kind: 'entrance', effect: 'zoom', dir: 'out', trigger: 'click', delayMs: 0, durationMs: 670 },
    { target: plainA, kind: 'entrance', effect: 'dissolve', trigger: 'click', delayMs: 0, durationMs: 680 },
    { target: plainB, kind: 'emphasis', effect: 'spin', trigger: 'click', delayMs: 80, durationMs: 900 },
    { target: plainB, kind: 'emphasis', effect: 'grow', trigger: 'withPrev', delayMs: 40, durationMs: 880 },
    { target: plainA, kind: 'motion', trigger: 'afterPrev', delayMs: 50, durationMs: 1200,
      motionPath },
    { target: plainB, kind: 'exit', effect: 'fade', trigger: 'click', delayMs: 0, durationMs: 500 },
  ];

  const preservePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const preserveDoc = edit.createDoc(preservePresentation, { idPrefix: 'animation-preserve-' });
  const preserveEditor = new edit.Editor(preserveDoc);
  const preserveSlide = preserveDoc.slideOrder[0];
  const preserveTarget = preserveDoc.slides[preserveSlide].children[1];
  const preservePart = preserveDoc.slides[preserveSlide].origin.part;
  const originalPreserveXml = decoder.decode(preservePresentation.package.parts[preservePart]);
  preserveEditor.exec({ type: 'SetName', id: preserveTarget, name: '同页非动画编辑' });
  const preserved = await preserveEditor.saveDetailed();
  const preservedXml = decoder.decode(preserved.package.parts[preservePart]);
  check('复杂来源页只改非动画属性时 timing/MCE 子树逐字直通',
    animationCarrier(originalPreserveXml)
      && animationCarrier(preservedXml) === animationCarrier(originalPreserveXml));
  preserveEditor.exec({ type: 'SetAnimations', slideId: preserveSlide, steps: [{
    target: preserveTarget, kind: 'entrance', effect: 'fade', trigger: 'click',
    delayMs: 10, durationMs: 700,
  }] });
  await preserveEditor.saveDetailed();
  preserveEditor.exec({ type: 'SetAnimations', slideId: preserveSlide, steps: null });
  preserveEditor.exec({ type: 'SetName', id: preserveTarget, name: null });
  const restoredComplex = await preserveEditor.saveDetailed();
  check('复杂来源显式替换后 null 从首次基线恢复原 part 字节',
    diffPackageBytes(input, restoredComplex.bytes).equal);
  edit.disposeDoc(preserveDoc);

  editor.exec({ type: 'SetAnimations', slideId: plainSlide, steps });
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('element-animations.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  check('动画编辑只修改目标 slide part', diff.added.length === 0 && diff.removed.length === 0
    && diff.changed.join('|') === 'ppt/slides/slide2.xml', diff.changed.join('|'));

  const xml = decoder.decode(saved.package.parts['ppt/slides/slide2.xml']);
  const timingAt = xml.indexOf('<p:timing');
  check('四类动画写为规范根时间树、触发节点与唯一 cTn id',
    timingAt > xml.indexOf('<p:clrMapOvr')
      && xml.includes('nodeType="tmRoot"') && xml.includes('nodeType="mainSeq"')
      && xml.includes('presetClass="entr"') && xml.includes('presetClass="emph"')
      && xml.includes('presetClass="path"') && xml.includes('presetClass="exit"')
      && xml.includes('nodeType="withEffect"') && xml.includes('nodeType="afterEffect"')
      && new Set([...xml.matchAll(/<p:cTn\b[^>]*\bid="(\d+)"/g)].map((match) => match[1])).size
        === [...xml.matchAll(/<p:cTn\b[^>]*\bid="(\d+)"/g)].length);
  check('入口/退出可见性、精确时长、方向与运动路径均有 OOXML 行为',
    xml.includes('val="visible"') && xml.includes('val="hidden"')
      && !xml.includes('filter="appear"') && xml.includes('filter="fade"')
      && xml.includes('filter="wipe(right)"') && xml.includes('dur="640"')
      && xml.includes('filter="slide(fromLeft)"') && xml.includes('filter="slide(fromRight)"')
      && xml.includes('filter="slide(fromTop)"') && xml.includes('filter="slide(fromBottom)"')
      && xml.includes('filter="box(in)"') && xml.includes('filter="box(out)"')
      && xml.includes('filter="dissolve"')
      && xml.includes('presetID="1"') && xml.includes('presetID="22"')
      && xml.includes('presetID="23"') && xml.includes('presetID="59"')
      && xml.includes('presetID="61"')
      && xml.includes('dur="900"') && xml.includes('dur="1200"')
      && xml.includes('<p:animMotion') && xml.includes('path="M 0 0 L'));
  const exitFragment = xml.slice(xml.indexOf('presetClass="exit"'));
  check('退出可见性只在效果时长结束后置为 hidden',
    /<p:set><p:cBhvr><p:cTn\b[^>]*dur="1"[^>]*><p:stCondLst><p:cond delay="500"\/><\/p:stCondLst>/.test(exitFragment));

  const reopenedPresentation = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedDoc = edit.createDoc(reopenedPresentation, { idPrefix: 'animation-reopen-' });
  const reopenedEditor = new edit.Editor(reopenedDoc);
  const reopened = edit.querySlideAnimations(reopenedDoc, [reopenedDoc.slideOrder[1]]);
  const [reopenedA, reopenedB] = reopenedDoc.slides[reopenedDoc.slideOrder[1]].children;
  const reopenedMotion = reopened.value.find((step) => step.kind === 'motion');
  const reopenedPath = reopenedMotion?.kind === 'motion' ? reopenedMotion.motionPath : [];
  const sameSteps = reopened.value.every((step, index) => {
    const inputStep = steps[index];
    if (!inputStep) return false;
    const target = inputStep.target === plainA ? reopenedA : reopenedB;
    return step.target === target && step.kind === inputStep.kind
      && step.trigger === inputStep.trigger && step.delayMs === inputStep.delayMs
      && step.durationMs === inputStep.durationMs
      && step.effect === inputStep.effect && step.dir === inputStep.dir;
  });
  check('保存重开后顺序、目标、类别、触发、时长与全部路径顶点一致',
    !reopened.sourceReadonly && reopened.value.length === steps.length && sameSteps
      && reopened.value.slice(2, 6).map((step) => step.dir).join('|') === 'l|r|u|d'
      && reopenedPath.length === motionPath.length
      && reopenedPath.every(([x, y], index) =>
        Math.abs(x - motionPath[index][0]) < 0.001 && Math.abs(y - motionPath[index][1]) < 0.001));

  const removedSourceTarget = reopenedEditor.exec({ type: 'RemoveElement', id: reopenedA });
  reopenedEditor.exec({ type: 'SetAnimations', slideId: reopenedDoc.slideOrder[1], steps: null });
  const afterNull = edit.querySlideAnimations(reopenedDoc, [reopenedDoc.slideOrder[1]]);
  const removedSourceSpid = removedSourceTarget.forward.find((patch) => patch.op === 'remove')
    ?.value.records[reopenedA].meta.origin.spid;
  const removedSourceSaved = await reopenedEditor.saveDetailed();
  const removedSourceXml = decoder.decode(removedSourceSaved.package.parts['ppt/slides/slide2.xml']);
  check('受支持来源 Remove→null 不会恢复已删除目标或悬空 spTgt',
    !afterNull.direct && afterNull.value.every((step) => step.target !== reopenedA)
      && !removedSourceXml.includes(`<p:spTgt spid="${removedSourceSpid}"`));
  edit.disposeDoc(reopenedDoc);

  const sourceBefore = presentation.package.parts['ppt/slides/slide1.xml'];
  check('未触碰复杂来源时间树保持原 part 字节',
    saved.package.parts['ppt/slides/slide1.xml'] === sourceBefore);
  const identity = await editor.saveDetailed();
  check('相同模型连续保存复用当前包 identity', identity.mode === 'identity' && identity.bytes === saved.bytes);
  editor.exec({ type: 'SetAnimations', slideId: plainSlide, steps: null });
  const reset = await editor.saveDetailed();
  check('连续保存后恢复来源从首次基线重建原包', diffPackageBytes(input, reset.bytes).equal);

  const sourceA = doc.slides[sourceSlide].children[0];
  editor.exec({ type: 'SetAnimations', slideId: sourceSlide, steps: [{
    target: sourceA, kind: 'entrance', effect: 'fade', trigger: 'click', delayMs: 20, durationMs: 700,
  }] });
  const replaced = await editor.saveDetailed();
  const replacedXml = decoder.decode(replaced.package.parts['ppt/slides/slide1.xml']);
  check('显式替换 MCE 分支内 tnLst 时保留载体、timing 根、build、extLst 与无关 MCE',
    replacedXml.includes('fixture:keep="timing"') && replacedXml.includes('{ANIMATION-KEEP}')
      && replacedXml.includes('fixture:keepBuild="yes"')
      && replacedXml.includes(`<p:bldP spid="${doc.elements[sourceA].src.id}" grpId="0" build="p"/>`)
      && replacedXml.includes('<fixture:payload value="keep"/>')
      && replacedXml.includes('<mc:AlternateContent') && !replacedXml.includes('<p:animClr')
      && [...replacedXml.matchAll(/<p:timing\b/g)].length === 2
      && [...replacedXml.matchAll(/presetClass="entr"/g)].length === 2);
  editor.exec({ type: 'SetAnimations', slideId: sourceSlide, steps: [] });
  const clearedSource = await editor.saveDetailed();
  const clearedSourceXml = decoder.decode(clearedSource.package.parts['ppt/slides/slide1.xml']);
  check('空时间线删除 tnLst 但保留 build 与 timing 的其他载荷',
    clearedSourceXml.includes('<p:timing') && !clearedSourceXml.includes('<p:tnLst')
      && [...clearedSourceXml.matchAll(/<p:timing\b/g)].length === 1
      && clearedSourceXml.includes('<p:bldLst') && clearedSourceXml.includes('{ANIMATION-KEEP}'));

  const deletePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const deleteDoc = edit.createDoc(deletePresentation, { idPrefix: 'animation-delete-' });
  const deleteEditor = new edit.Editor(deleteDoc);
  const [deleteSourceSlide, , , deleteUnsupportedSlide] = deleteDoc.slideOrder;
  const [deleteSourceA, deleteSourceB, deleteSourceGroup] = deleteDoc.slides[deleteSourceSlide].children;
  const deleteSourceSpid = deleteDoc.elements[deleteSourceA].meta.origin.spid;
  const deleteSourceGroupChild = deleteDoc.elements[deleteSourceGroup].children[0];
  const deleteSourceGroupChildSpid = deleteDoc.elements[deleteSourceGroupChild].meta.origin.spid;
  const deleteUnsupported = deleteDoc.slides[deleteUnsupportedSlide].children[0];
  const deleteUnsupportedSpid = deleteDoc.elements[deleteUnsupported].meta.origin.spid;
  deleteEditor.exec({ type: 'RemoveElement', id: deleteSourceA });
  deleteEditor.exec({ type: 'SetAnimations', slideId: deleteSourceSlide, steps: null });
  deleteEditor.exec({ type: 'RemoveElement', id: deleteSourceGroup });
  const deletedCopy = [...deleteEditor.exec({
    type: 'DuplicateSlide', id: deleteSourceSlide,
  }).createdSlides][0];
  deleteEditor.exec({ type: 'RemoveElement', id: deleteUnsupported });
  const deleted = await deleteEditor.saveDetailed();
  const deletedSourceXml = decoder.decode(deleted.package.parts['ppt/slides/slide1.xml']);
  const deletedCopyPart = deleteDoc.slides[deletedCopy].origin.part;
  const deletedCopyXml = decoder.decode(deleted.package.parts[deletedCopyPart]);
  const deletedUnsupportedXml = decoder.decode(deleted.package.parts['ppt/slides/slide4.xml']);
  const deletedSourceState = edit.querySlideAnimations(deleteDoc, [deleteSourceSlide]);
  check('sourceReadonly 删除保留无关 unsupported 行为并清理 tnLst/build 目标',
    !deletedSourceState.direct && deletedSourceState.value.length === 1
      && deletedSourceState.value[0].target === deleteSourceB
      && deletedSourceXml.includes('fixture:keepTarget="yes"')
      && !deletedSourceXml.includes('fixture:dropTarget="yes"')
      && !deletedSourceXml.includes('fixture:triggerOwner="yes"')
      && deletedSourceXml.includes('fixture:keepBuild="yes"')
      && !deletedSourceXml.includes(`<p:spTgt spid="${deleteSourceSpid}"`)
      && !deletedSourceXml.includes(`<p:bldP spid="${deleteSourceSpid}"`));
  check('unsupported-only 删除唯一目标后不留下悬空行为',
    !deletedUnsupportedXml.includes(`<p:spTgt spid="${deleteUnsupportedSpid}"`)
      && !deletedUnsupportedXml.includes('<p:animClr')
      && !deletedUnsupportedXml.includes('<p:tnLst'));
  check('删除含动画子元素的来源组后复制页不会遗留子元素 timing 引用',
    !deletedCopyXml.includes(`<p:spTgt spid="${deleteSourceGroupChildSpid}"`)
      && deletedCopyXml.includes('fixture:keepTarget="yes"')
      && !deletedCopyXml.includes('fixture:dropTarget="yes"')
      && !deletedCopyXml.includes('fixture:triggerOwner="yes"'));
  const deletedReopenPresentation = await core.parse(deleted.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const deletedReopenDoc = edit.createDoc(deletedReopenPresentation, { idPrefix: 'animation-delete-reopen-' });
  const deletedReopen = edit.querySlideAnimations(deletedReopenDoc, [deletedReopenDoc.slideOrder[0]]);
  check('删除保存重开后复杂来源只剩仍存在目标',
    deletedReopen.value.length === 1
      && deletedReopen.value[0].target === deletedReopenDoc.slides[deletedReopenDoc.slideOrder[0]].children[0]);
  edit.disposeDoc(deletedReopenDoc);
  edit.disposeDoc(deleteDoc);

  const stressParts = unzipSync(input);
  const stressPart = 'ppt/slides/slide2.xml';
  const stressSource = decoder.decode(stressParts[stressPart]);
  const stressTarget = Number(stressSource.match(/<p:sp><p:nvSpPr><p:cNvPr id="(\d+)"/)?.[1]);
  const stressEffects = Array.from({ length: 4000 }, (_, index) => {
    const id = 1000 + index * 3;
    return `<p:par><p:cTn id="${id}" presetID="10" presetClass="entr" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${id + 1}" dur="500" fill="hold"/><p:tgtEl><p:spTgt spid="${stressTarget}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>`;
  }).join('');
  const stressTiming = `<p:timing><p:tnLst>${stressEffects}</p:tnLst></p:timing>`;
  stressParts[stressPart] = new TextEncoder().encode(
    stressSource.replace('</p:sld>', `${stressTiming}</p:sld>`),
  );
  const stressPresentation = await core.parse(zipSync(stressParts), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const stressDoc = edit.createDoc(stressPresentation, { idPrefix: 'animation-delete-stress-' });
  const stressEditor = new edit.Editor(stressDoc);
  stressEditor.exec({ type: 'RemoveElement', id: stressDoc.slides[stressDoc.slideOrder[1]].children[0] });
  const stressStart = performance.now();
  const stressSaved = await stressEditor.saveDetailed();
  const stressElapsed = performance.now() - stressStart;
  const stressXml = decoder.decode(stressSaved.package.parts[stressPart]);
  check('大量点击动画目标删除保持线性预算且不留引用',
    stressElapsed < 500 && !stressXml.includes(`<p:spTgt spid="${stressTarget}"`),
    `${stressElapsed.toFixed(1)}ms`);
  edit.disposeDoc(stressDoc);

  const operationsPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const operationsDoc = edit.createDoc(operationsPresentation, { idPrefix: 'animation-operations-' });
  const operationsEditor = new edit.Editor(operationsDoc);
  const operationsSource = operationsDoc.slideOrder[0];
  const copiedSource = [...operationsEditor.exec({
    type: 'DuplicateSlide', id: operationsSource,
  }).createdSlides][0];
  const operationsPlain = operationsDoc.slideOrder[2];
  const operationsPlainTarget = operationsDoc.slides[operationsPlain].children[0];
  operationsEditor.exec({ type: 'SetAnimations', slideId: operationsPlain, steps: [{
    target: operationsPlainTarget, kind: 'entrance', effect: 'fade', trigger: 'click',
    delayMs: 0, durationMs: 500,
  }] });
  const copiedOverride = [...operationsEditor.exec({
    type: 'DuplicateSlide', id: operationsPlain,
  }).createdSlides][0];
  const addedSlide = [...operationsEditor.exec({
    type: 'AddSlide', layoutId: operationsDoc.layoutOrder[0], at: { after: operationsDoc.slideOrder.at(-1) },
  }).createdSlides][0];
  operationsEditor.exec({
    type: 'AddShape', slideId: addedSlide, preset: 'rect', rect: { x: 100, y: 100, w: 240, h: 120 },
  });
  const addedShape = operationsEditor.selection.kind === 'elements'
    ? operationsEditor.selection.ids[0] : null;
  operationsEditor.exec({ type: 'SetAnimations', slideId: addedSlide, steps: [{
    target: addedShape, kind: 'entrance', effect: 'wipe', dir: 'l', trigger: 'click',
    delayMs: 0, durationMs: 600,
  }] });
  const operationsSaved = await operationsEditor.saveDetailed();
  const operationsReopenPresentation = await core.parse(operationsSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const operationsReopenDoc = edit.createDoc(
    operationsReopenPresentation, { idPrefix: 'animation-operations-reopen-' },
  );
  const copiedSourceIndex = operationsDoc.slideOrder.indexOf(copiedSource);
  const copiedOverrideIndex = operationsDoc.slideOrder.indexOf(copiedOverride);
  const addedSlideIndex = operationsDoc.slideOrder.indexOf(addedSlide);
  const copiedSourceReopenId = operationsReopenDoc.slideOrder[copiedSourceIndex];
  const copiedOverrideReopenId = operationsReopenDoc.slideOrder[copiedOverrideIndex];
  const addedReopenId = operationsReopenDoc.slideOrder[addedSlideIndex];
  const copiedSourceState = edit.querySlideAnimations(operationsReopenDoc, [copiedSourceReopenId]);
  const copiedOverrideState = edit.querySlideAnimations(operationsReopenDoc, [copiedOverrideReopenId]);
  const addedState = edit.querySlideAnimations(operationsReopenDoc, [addedReopenId]);
  check('复制复杂来源/直接覆盖与新增页动画保存重开均重映射到各自元素',
    copiedSourceState.sourceReadonly && copiedSourceState.value.length === 3
      && copiedSourceState.value.every((step) =>
        operationsReopenDoc.slides[copiedSourceReopenId].children.includes(step.target))
      && !copiedOverrideState.sourceReadonly && copiedOverrideState.value.length === 1
      && operationsReopenDoc.slides[copiedOverrideReopenId].children.includes(copiedOverrideState.value[0].target)
      && !addedState.sourceReadonly && addedState.value.length === 1
      && operationsReopenDoc.slides[addedReopenId].children.includes(addedState.value[0].target));
  edit.disposeDoc(operationsReopenDoc);
  edit.disposeDoc(operationsDoc);

  const cleanPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const cleanDoc = edit.createDoc(cleanPresentation, { idPrefix: 'animation-clean-' });
  const cleanEditor = new edit.Editor(cleanDoc);
  cleanEditor.exec({ type: 'SetAnimations', slideId: cleanDoc.slideOrder[1], steps: [] });
  const cleanSave = await cleanEditor.saveDetailed();
  const cleanXml = decoder.decode(cleanSave.package.parts['ppt/slides/slide2.xml']);
  check('无其他载荷的空时间线不会生成空 timing', !cleanXml.includes('<p:timing'));
  edit.disposeDoc(cleanDoc);

  check('保存产物可交给统一 Office 门禁', artifact.endsWith('element-animations.pptx'));
  edit.disposeDoc(doc);
}
