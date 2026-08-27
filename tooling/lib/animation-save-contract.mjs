import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();

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
      && [...clearedSourceXml.matchAll(/<p:timing\b/g)].length === 2
      && clearedSourceXml.includes('<p:bldLst') && clearedSourceXml.includes('{ANIMATION-KEEP}'));

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
