const rejected = (fn) => { try { fn(); return false; } catch { return true; } };

/** 只通过发布入口锁定稳定身份、命令、投影与历史，不读取保存器内部结构。 */
export async function runAnimationEditContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 元素动画命令与查询\x1b[0m');
  const input = load('sample-editor-animations.pptx');
  if (!check('找到确定性元素动画固件', !!input)) return;
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'animation-' });
  const editor = new edit.Editor(doc);
  const [sourceSlide, plainSlide, perfSlide, unsupportedOnlySlide, noncanonicalSlide] = doc.slideOrder;
  const [sourceA, sourceB] = doc.slides[sourceSlide].children;
  const [plainA, plainB] = doc.slides[plainSlide].children;

  check('公开效果目录按类别只暴露可安全保存组合',
    edit.ANIMATION_EFFECTS.join('|') === 'appear|fade|fly|wipe|zoom|dissolve|spin|grow'
      && edit.animationEffectsForKind('entrance').join('|') === 'appear|fade|fly|wipe|zoom|dissolve'
      && edit.animationEffectsForKind('emphasis').join('|') === 'spin|grow'
      && edit.animationDirections('fly').join('|') === 'l|r|u|d');

  const source = edit.querySlideAnimations(doc, [sourceSlide]);
  check('来源数值 spid 在编辑模型边界映射为稳定 ElementId',
    source.value.length === 3 && source.source.length === 3 && !source.direct && source.sourceReadonly
      && source.value[0].target === sourceA && source.value[1].target === sourceB
      && source.value[2].target === sourceA
      && source.value[0].effect === 'fly' && source.value[0].trigger === 'click'
      && source.value[1].kind === 'emphasis' && source.value[1].effect === 'spin'
      && source.value[1].trigger === 'withPrev'
      && source.value[2].kind === 'motion' && source.value[2].motionPath.length === 3);
  const unsupportedOnly = edit.querySlideAnimations(doc, [unsupportedOnlySlide]);
  check('仅含未支持行为的来源时间树返回空可编辑子集并明确只读',
    unsupportedOnly.value.length === 0 && unsupportedOnly.source.length === 0
      && unsupportedOnly.sourceReadonly && !unsupportedOnly.direct);
  const noncanonical = edit.querySlideAnimations(doc, [noncanonicalSlide]);
  check('可识别但不可由 writer 等价重建的条件和值必须标记来源只读',
    noncanonical.value.length === 1 && noncanonical.value[0].effect === 'spin'
      && noncanonical.sourceReadonly && !noncanonical.direct, JSON.stringify(noncanonical));
  const mixed = edit.querySlideAnimations(doc, [sourceSlide, plainSlide]);
  check('多页查询公开 effective/source 的 mixed 与 sourceMixed',
    mixed.mixed && mixed.sourceMixed && !mixed.direct && mixed.sourceReadonly);

  editor.exec({ type: 'SetAnimations', slideId: plainSlide, steps: [{
    target: plainA, kind: 'entrance', effect: 'fly', trigger: 'click', delayMs: 0, durationMs: 500,
  }] });
  check('省略方向时查询、预览与保存共用显式默认方向',
    edit.querySlideAnimations(doc, [plainSlide]).value[0].dir === 'd');
  editor.undo();

  const beforeSource = editor.toSlide(sourceSlide);
  const steps = [
    { target: plainA, kind: 'entrance', effect: 'wipe', dir: 'l', trigger: 'click', delayMs: 0, durationMs: 640 },
    { target: plainB, kind: 'emphasis', effect: 'spin', trigger: 'withPrev', delayMs: 80, durationMs: 900 },
    { target: plainA, kind: 'motion', trigger: 'afterPrev', delayMs: 50, durationMs: 1200,
      motionPath: [[0, 0], [120, -60], [240, 30]] },
    { target: plainB, kind: 'exit', effect: 'fade', trigger: 'click', delayMs: 0, durationMs: 500 },
  ];
  const changed = editor.exec({ type: 'SetAnimations', slideId: plainSlide, steps });
  const projected = editor.toSlide(plainSlide).animations;
  check('SetAnimations 只产生一个稀疏双向 patch 并精确失效目标页',
    changed.forward.length === 1 && changed.inverse.length === 1
      && changed.forward[0].path.join('/') === `slides/${plainSlide}/ovr/animations`
      && changed.dirtySlides.size === 1 && changed.dirtySlides.has(plainSlide)
      && changed.renderSlides.size === 0 && editor.toSlide(sourceSlide) === beforeSource);
  check('有效投影只在边界恢复数值 spid并推导点击分组',
    projected.length === 4
      && projected[0].target === doc.elements[plainA].src.id
      && projected[1].target === doc.elements[plainB].src.id
      && projected[0].clickGroup === 0 && projected[1].clickGroup === 0
      && projected[2].clickGroup === 0 && projected[3].clickGroup === 1
      && projected[2].motionPath.length === 3);
  const direct = edit.querySlideAnimations(doc, [plainSlide]);
  check('查询返回结构化克隆和直接覆盖，来源保持空时间线',
    direct.direct && direct.source.length === 0 && direct.value.length === 4
      && direct.value !== doc.slides[plainSlide].ovr.animations);

  editor.undo();
  check('撤销恢复无动画来源', !editor.toSlide(plainSlide).animations
    && !edit.querySlideAnimations(doc, [plainSlide]).direct);
  editor.redo();
  check('重做恢复规范化时间线', editor.toSlide(plainSlide).animations.length === 4);
  editor.exec({ type: 'SetAnimations', slideId: plainSlide, steps: [] });
  check('空数组明确删除动画而不是恢复来源',
    editor.toSlide(plainSlide).animations === undefined
      && edit.querySlideAnimations(doc, [plainSlide]).direct);
  editor.exec({ type: 'SetAnimations', slideId: plainSlide, steps: null });
  check('null 删除覆盖并恢复来源', !edit.querySlideAnimations(doc, [plainSlide]).direct);

  editor.exec({ type: 'SetAnimations', slideId: plainSlide, steps });
  const removed = editor.exec({ type: 'RemoveElement', id: plainA });
  check('删除动画目标会在同一事务清理整棵子树引用',
    removed.forward.length === 2 && removed.inverse.length === 2
      && edit.querySlideAnimations(doc, [plainSlide]).value.length === 2
      && edit.querySlideAnimations(doc, [plainSlide]).value.every((step) => step.target !== plainA));
  editor.undo();
  check('一次撤销同时恢复元素和原时间线', !!doc.elements[plainA]
    && edit.querySlideAnimations(doc, [plainSlide]).value.length === 4);

  const duplicated = editor.exec({ type: 'DuplicateSlide', id: sourceSlide });
  const duplicateSlide = [...duplicated.createdSlides][0];
  const duplicateChildren = new Set(doc.slides[duplicateSlide].children);
  const duplicateAnimations = edit.querySlideAnimations(doc, [duplicateSlide]);
  check('复制页把来源动画重定向到副本稳定元素身份',
    duplicateAnimations.value.length === 3
      && duplicateAnimations.value.every((step) => duplicateChildren.has(step.target))
      && duplicateAnimations.value.every((step) => !doc.slides[sourceSlide].children.includes(step.target)));

  const stable = JSON.stringify(doc.slides[plainSlide].ovr);
  const history = editor.history.undoCount;
  const editableBefore = doc.elements[plainB].meta.editable;
  doc.elements[plainB].meta.editable = 'none';
  const rejectedReadonlyTarget = rejected(() => editor.exec({
    type: 'SetAnimations', slideId: plainSlide, steps: [{ ...steps[0], target: plainB }],
  }));
  if (!rejectedReadonlyTarget) editor.undo();
  check('不可无歧义写回的元素不能成为动画目标',
    rejectedReadonlyTarget
      && JSON.stringify(doc.slides[plainSlide].ovr) === stable
      && editor.history.undoCount === history);
  doc.elements[plainB].meta.editable = editableBefore;
  const rejectedOrphanTrigger = rejected(() => editor.exec({
    type: 'SetAnimations', slideId: plainSlide,
    steps: [{ ...steps[0], trigger: 'withPrev' }],
  }));
  if (!rejectedOrphanTrigger) editor.undo();
  check('时间线第一步必须由点击启动', rejectedOrphanTrigger
    && JSON.stringify(doc.slides[plainSlide].ovr) === stable
    && editor.history.undoCount === history);
  const rejectedKindEffect = rejected(() => editor.exec({
    type: 'SetAnimations', slideId: plainSlide,
    steps: [{ ...steps[0], kind: 'emphasis', effect: 'fly' }],
  }));
  if (!rejectedKindEffect) editor.undo();
  check('动画类别与效果必须属于可保存组合', rejectedKindEffect
    && JSON.stringify(doc.slides[plainSlide].ovr) === stable
    && editor.history.undoCount === history);
  check('非法目标、组合、方向、时长、路径和未知字段全部原子拒绝',
    rejected(() => editor.exec({ type: 'SetAnimations', slideId: 'missing', steps }))
      && rejected(() => editor.exec({ type: 'SetAnimations', slideId: plainSlide,
        steps: [{ ...steps[0], target: sourceA }] }))
      && rejected(() => editor.exec({ type: 'SetAnimations', slideId: plainSlide,
        steps: [{ ...steps[0], dir: 'side' }] }))
      && rejected(() => editor.exec({ type: 'SetAnimations', slideId: plainSlide,
        steps: [{ ...steps[0], durationMs: 59 }] }))
      && rejected(() => editor.exec({ type: 'SetAnimations', slideId: plainSlide,
        steps: [{ ...steps[0], extra: true }] }))
      && rejected(() => editor.exec({ type: 'SetAnimations', slideId: plainSlide,
        steps: [{ ...steps[2], motionPath: [[1, 0], [2, 0]] }] }))
      && rejected(() => edit.querySlideAnimations(doc, []))
      && JSON.stringify(doc.slides[plainSlide].ovr) === stable
      && editor.history.undoCount === history);

  const perfTargets = doc.slides[perfSlide].children;
  const perfSteps = perfTargets.map((target, index) => ({
    target, kind: 'entrance', effect: 'fade', trigger: index ? 'withPrev' : 'click',
    delayMs: index, durationMs: 500,
  }));
  const start = performance.now();
  editor.exec({ type: 'SetAnimations', slideId: perfSlide, steps: perfSteps });
  const elapsed = performance.now() - start;
  check('60 元素时间线提交守住 16ms headless 预算', elapsed < 16, `${elapsed.toFixed(3)}ms`);

  const recoveryPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveryDoc = edit.createDoc(recoveryPresentation, { idPrefix: 'animation-recovery-' });
  const recoveryEditor = new edit.Editor(recoveryDoc);
  const recoverySlide = recoveryDoc.slideOrder[2];
  const recoverySteps = recoveryDoc.slides[recoverySlide].children.slice(0, 3).map((target, index) => ({
    target, kind: 'entrance', effect: 'fade', trigger: index ? 'withPrev' : 'click',
    delayMs: index, durationMs: 500,
  }));
  const recoveryFrames = [];
  const stopRecovery = recoveryEditor.subscribeRecovery((frame) => recoveryFrames.push(frame));
  recoveryEditor.exec({ type: 'SetAnimations', slideId: recoverySlide, steps: recoverySteps });
  stopRecovery();
  const restoredPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const restoredDoc = edit.createDoc(restoredPresentation, { idPrefix: 'animation-recovery-' });
  const restored = new edit.Editor(restoredDoc, {
    recoveryFrames: JSON.parse(JSON.stringify(recoveryFrames)),
  });
  check('动画 Patch 可 JSON 持久化并以稳定身份恢复',
    restored.toSlide(restoredDoc.slideOrder[2]).animations.length === 3);
  edit.disposeDoc(recoveryDoc);
  edit.disposeDoc(restoredDoc);

  edit.disposeDoc(doc);
}
