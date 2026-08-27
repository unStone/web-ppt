const TYPES = [
  'none', 'fade', 'cut', 'push', 'pull', 'cover', 'wipe', 'split', 'zoom', 'dissolve',
  'checker', 'blinds', 'comb', 'wheel', 'circle', 'diamond', 'plus', 'wedge', 'newsflash',
  'randomBar', 'strips', 'vortex', 'switch', 'flip', 'ripple', 'honeycomb', 'glitter',
  'warp', 'flythrough', 'flash', 'shred', 'reveal', 'wheelReverse', 'ferris', 'gallery',
  'conveyor', 'pan', 'doors', 'window', 'prism', 'morph',
];
const rejected = (fn) => { try { fn(); return false; } catch { return true; } };

/** 只通过发布入口验证页面切换的命令、查询、历史与纯数据边界。 */
export async function runTransitionContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 页面切换命令与查询\x1b[0m');
  const input = load('sample-editor-transitions.pptx');
  if (!check('找到 41 页确定性切换固件', !!input)) return;
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'transition-' });
  const editor = new edit.Editor(doc);
  const [none, fade, cut] = doc.slideOrder;

  check('发布入口公开 40 种效果加 none 的稳定目录',
    Object.isFrozen(edit.SLIDE_TRANSITION_TYPES)
      && edit.SLIDE_TRANSITION_TYPES.join('|') === TYPES.join('|')
      && new Set(edit.SLIDE_TRANSITION_TYPES).size === 41);
  check('方向目录只公开当前效果可保存的规范值',
    edit.transitionDirections('push').join('|') === 'l|r|u|d'
      && edit.transitionDirections('pull').join('|') === 'l|r|u|d|lu|ld|ru|rd'
      && edit.transitionDirections('cover').join('|') === 'l|r|u|d|lu|ld|ru|rd'
      && edit.transitionDirections('split').join('|') === 'horz-in|horz-out|vert-in|vert-out'
      && edit.transitionDirections('vortex').join('|') === 'l|r|u|d'
      && edit.transitionDirections('switch').join('|') === 'l|r'
      && edit.transitionDirections('flip').join('|') === 'l|r'
      && edit.transitionDirections('ripple').join('|') === 'lu|ld|ru|rd|center'
      && edit.transitionDirections('warp').join('|') === 'in|out'
      && edit.transitionDirections('shred').join('|') === 'in|out'
      && edit.transitionDirections('reveal').join('|') === 'l|r'
      && edit.transitionDirections('ferris').join('|') === 'l|r'
      && edit.transitionDirections('prism').join('|') === 'l|r|u|d'
      && edit.transitionDirections('morph').length === 0);
  check('省略方向采用稳定首选项，none 可独立承载自动换片',
    edit.normalizeSlideTransition({ type: 'push' }).dir === 'l'
      && edit.normalizeSlideTransition({ type: 'split' }).dir === 'horz-out'
      && edit.normalizeSlideTransition({ type: 'zoom' }).dir === 'out'
      && edit.normalizeSlideTransition({ type: 'none', advanceAfterMs: 2300 }).advanceAfterMs === 2300);

  const initial = edit.querySlideTransition(doc, [none, fade]);
  check('多页查询区分有效值、来源、混合态和直接覆盖',
    initial.value === null && initial.source === null && initial.mixed && initial.sourceMixed
      && !initial.direct);

  const beforeOther = editor.toSlide(cut);
  const changed = editor.exec({
    type: 'SetTransition', id: none,
    t: { type: 'ripple', durationMs: 1400, advanceAfterMs: 3200 },
  });
  const effective = editor.toSlide(none).transition;
  check('SetTransition 只产生一个稀疏双向 patch 并精确失效目标页',
    changed.forward.length === 1 && changed.inverse.length === 1
      && changed.forward[0].path.join('/') === `slides/${none}/ovr/transition`
      && changed.dirtySlides.size === 1 && changed.dirtySlides.has(none)
      && changed.renderSlides.size === 0
      && editor.toSlide(cut) === beforeOther);
  check('有效投影立即得到规范化切换且来源保持不变',
    effective.type === 'ripple' && effective.durationMs === 1400
      && effective.advanceAfterMs === 3200 && doc.slides[none].src.transition === undefined);
  const direct = edit.querySlideTransition(doc, [none]);
  check('查询返回结构化克隆且标记直接覆盖', direct.direct && !direct.mixed
    && direct.value.type === 'ripple' && direct.source === null
    && direct.value !== doc.slides[none].ovr.transition);

  editor.exec({ type: 'SetTransition', id: fade, t: { type: 'push', dir: 'r' } });
  check('省略时长采用 750ms 易用默认值',
    editor.toSlide(fade).transition.type === 'push'
      && editor.toSlide(fade).transition.durationMs === 750);
  editor.exec({ type: 'SetTransition', id: fade, t: { type: 'none' } });
  check('none 是显式关闭而不是恢复来源',
    editor.toSlide(fade).transition.type === 'none'
      && editor.toSlide(fade).transition.durationMs === 0
      && edit.querySlideTransition(doc, [fade]).direct);
  editor.undo();
  check('撤销恢复前一个直接切换值', editor.toSlide(fade).transition.type === 'push');
  editor.undo();
  check('再次撤销恢复来源切换', editor.toSlide(fade).transition.type === 'fade'
    && !edit.querySlideTransition(doc, [fade]).direct);
  editor.redo();
  check('重做保持规范化结果', editor.toSlide(fade).transition.type === 'push');
  editor.exec({ type: 'SetTransition', id: fade, t: null });
  check('null 删除覆盖并恢复来源', editor.toSlide(fade).transition.type === 'fade'
    && !edit.querySlideTransition(doc, [fade]).direct);

  const stable = JSON.stringify(doc.slides[none].ovr);
  const history = editor.history.undoCount;
  check('非法类型、方向、时长、自动换片、morph 粒度与未知字段全部原子拒绝',
    rejected(() => editor.exec({ type: 'SetTransition', id: none, t: { type: 'missing' } }))
      && rejected(() => editor.exec({ type: 'SetTransition', id: none, t: { type: 'fade', dir: 'l' } }))
      && rejected(() => editor.exec({ type: 'SetTransition', id: none, t: { type: 'push', dir: 'side' } }))
      && rejected(() => editor.exec({ type: 'SetTransition', id: none, t: { type: 'reveal', dir: 'u' } }))
      && rejected(() => editor.exec({ type: 'SetTransition', id: none, t: { type: 'fade', durationMs: 79 } }))
      && rejected(() => editor.exec({ type: 'SetTransition', id: none, t: { type: 'fade', durationMs: NaN } }))
      && rejected(() => editor.exec({ type: 'SetTransition', id: none, t: { type: 'fade', advanceAfterMs: -1 } }))
      && rejected(() => editor.exec({ type: 'SetTransition', id: none, t: { type: 'fade', morphBy: 'byWord' } }))
      && rejected(() => editor.exec({ type: 'SetTransition', id: none, t: { type: 'morph', morphBy: 'bad' } }))
      && rejected(() => editor.exec({ type: 'SetTransition', id: none, t: { type: 'fade', extra: true } }))
      && rejected(() => editor.exec({ type: 'SetTransition', id: 'missing', t: { type: 'fade' } }))
      && JSON.stringify(doc.slides[none].ovr) === stable && editor.history.undoCount === history);
  const inherited = Object.create({ type: 'fade' });
  check('嵌套切换值也必须是纯数据对象',
    rejected(() => editor.exec({ type: 'SetTransition', id: none, t: inherited })));
  check('删除页与切换修改不能在同一事务形成顺序依赖', rejected(() => editor.exec(
    { type: 'SetTransition', id: cut, t: { type: 'fade' } },
    { type: 'RemoveSlide', id: cut },
  )));
  check('空查询与未知页明确拒绝',
    rejected(() => edit.querySlideTransition(doc, []))
      && rejected(() => edit.querySlideTransition(doc, ['missing'])));

  const recoveryPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveryDoc = edit.createDoc(recoveryPresentation, { idPrefix: 'transition-recovery-' });
  const recoveryEditor = new edit.Editor(recoveryDoc);
  const recoveryFrames = [];
  const stopRecovery = recoveryEditor.subscribeRecovery((frame) => recoveryFrames.push(frame));
  const recoverySlide = recoveryDoc.slideOrder[1];
  recoveryEditor.exec({
    type: 'SetTransition', id: recoverySlide,
    t: { type: 'morph', durationMs: 1350, morphBy: 'byChar', advanceAfterMs: 4200 },
  });
  stopRecovery();
  const restoredPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const restoredDoc = edit.createDoc(restoredPresentation, { idPrefix: 'transition-recovery-' });
  const restoredEditor = new edit.Editor(restoredDoc, {
    recoveryFrames: JSON.parse(JSON.stringify(recoveryFrames)),
  });
  const restored = restoredEditor.toSlide(restoredDoc.slideOrder[1]).transition;
  check('切换恢复帧可 JSON 持久化并精确回放规范值',
    recoveryFrames.length === 1 && restoredEditor.isDirty()
      && restored.type === 'morph' && restored.durationMs === 1350
      && restored.morphBy === 'byChar' && restored.advanceAfterMs === 4200);
  edit.disposeDoc(recoveryDoc);
  edit.disposeDoc(restoredDoc);

  const readonlyPresentation = await core.parse(input, { lazy: false });
  const readonlyDoc = edit.createDoc(readonlyPresentation, { idPrefix: 'transition-readonly-' });
  const readonlyEditor = new edit.Editor(readonlyDoc);
  check('二进制 PPT 只读边界拒绝切换修改', rejected(() => readonlyEditor.exec({
    type: 'SetTransition', id: readonlyDoc.slideOrder[0], t: { type: 'fade' },
  })));
  edit.disposeDoc(readonlyDoc);
  edit.disposeDoc(doc);
}
