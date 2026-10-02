/** 真实浏览器检查元素动画与切换在起点、中途、终点的可见状态。 */
export async function runViewerAnimationBrowserContract({ Viewer, parse, load }) {
  const presentation = await parse(await load('showcase.pptx'), { lazy: false });
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  mount.style.cssText = 'width:1280px;height:720px';
  document.body.append(mount);
  let viewer;
  try {
    viewer = new Viewer(mount, presentation, {
      index: 6, animate: true, textMode: 'svg',
    });
    viewer.finishAnimations();
    viewer.prev();
    const exiting = mount.querySelector('[data-el="705"]');
    if (!exiting || exiting.style.visibility === 'hidden') {
      throw new Error('Chrome 退场前的元素未显示');
    }
    viewer.playNextAnimation();
    const exitAnimation = exiting.getAnimations()[0];
    if (!exitAnimation || exiting.style.visibility === 'hidden') {
      throw new Error('Chrome 退场效果开始时目标被提前隐藏');
    }
    exitAnimation.pause();
    exitAnimation.currentTime = 300;
    const midOpacity = Number(getComputedStyle(exiting).opacity);
    if (!(midOpacity > 0 && midOpacity < 1)
      || getComputedStyle(exiting).visibility !== 'visible') {
      throw new Error(`Chrome 退场中途不可见：opacity=${midOpacity}`);
    }
    exitAnimation.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (exiting.style.visibility !== 'hidden') {
      throw new Error('Chrome 退场结束后未隐藏目标');
    }
    viewer.destroy();
    viewer = null;

    const singleExit = {
      ...presentation.slides[6],
      animations: [{
        target: 705, effect: 'fade', kind: 'exit', trigger: 'click',
        clickGroup: 0, delayMs: 0, durationMs: 1000,
      }],
    };
    viewer = new Viewer(mount, { ...presentation, slides: [singleExit] }, {
      animate: true, textMode: 'svg',
    });
    viewer.playNextAnimation();
    const lastGroupTarget = mount.querySelector('[data-el="705"]');
    const activeExit = lastGroupTarget?.getAnimations()[0];
    if (!activeExit) throw new Error('Chrome 末批退场没有启动');
    activeExit.pause();
    activeExit.currentTime = 500;
    viewer.finishAnimations();
    if (lastGroupTarget.style.visibility !== 'hidden' || lastGroupTarget.getAnimations().length) {
      throw new Error('Chrome 完成本页动画后，最后一批仍停在中途');
    }
    viewer.destroy();
    viewer = null;

    const first = presentation.slides[6];
    const second = {
      ...presentation.slides[6],
      transition: { type: 'cut', durationMs: 1000 },
    };
    viewer = new Viewer(mount, { ...presentation, slides: [first, second] }, {
      animate: true, textMode: 'svg',
    });
    viewer.goTo(1);
    const [outgoing, incoming] = [...mount.children];
    const oldAnimation = outgoing?.getAnimations()[0];
    const newAnimation = incoming?.getAnimations()[0];
    if (!oldAnimation || !newAnimation) throw new Error('Chrome 切出没有创建双页动画');
    oldAnimation.pause();
    newAnimation.pause();
    oldAnimation.currentTime = 250;
    newAnimation.currentTime = 250;
    if (Number(getComputedStyle(outgoing).opacity) !== 1
      || Number(getComputedStyle(incoming).opacity) !== 0) {
      throw new Error('Chrome 切出前半段没有保留旧页');
    }
    oldAnimation.currentTime = 750;
    newAnimation.currentTime = 750;
    if (Number(getComputedStyle(outgoing).opacity) !== 0
      || Number(getComputedStyle(incoming).opacity) !== 1) {
      throw new Error('Chrome 切出后半段没有显示新页');
    }
    viewer.destroy();
    viewer = null;

    viewer = new Viewer(mount, { ...presentation, slides: [first, {
      ...second, transition: { type: 'fade', durationMs: 1000 },
    }] }, { animate: true, textMode: 'svg' });
    viewer.goTo(1);
    const oldTarget = mount.firstElementChild?.querySelector('[data-el="701"]');
    const newTarget = mount.lastElementChild?.querySelector('[data-el="701"]');
    viewer.playNextAnimation();
    if (!oldTarget || !newTarget || oldTarget.getAnimations().length !== 0
      || newTarget.getAnimations().length === 0) {
      throw new Error('Chrome 切换途中点击没有把元素动画交给新页');
    }
    viewer.goTo(0, 'backward');
    await Promise.resolve();
    if (mount.children.length !== 1 || viewer.index !== 0) {
      throw new Error('Chrome 连续切页后残留旧图层');
    }
    viewer.destroy();
    viewer = null;

    const moving = { ...first, animations: [{
      target: 706, kind: 'motion', effect: 'path', clickGroup: 0, trigger: 'click',
      delayMs: 0, durationMs: 1000, motionPath: [[0, 0], [100, 0]],
    }] };
    viewer = new Viewer(mount, { ...presentation, slides: [moving, {
      ...second, transition: { type: 'fade', durationMs: 1000 },
    }] }, { animate: true, textMode: 'svg' });
    viewer.playNextAnimation();
    viewer.goTo(1);
    const departing = mount.firstElementChild?.querySelector('[data-el="706"]');
    if (departing?.style.transform !== 'translate(100px, 0px)') {
      throw new Error(`Chrome 连续点击切页丢失旧页运动终态：${departing?.style.transform}`);
    }
  } finally {
    viewer?.destroy();
    presentation.dispose?.();
    mount.remove();
  }
  await runAnimationEffectsBrowserContract({ Viewer, parse, load });
}

async function runAnimationEffectsBrowserContract({ Viewer, parse, load }) {
  const presentation = await parse(await load('sample-animation-effects.pptx'), { lazy: false });
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  mount.style.cssText = 'width:1280px;height:720px';
  document.body.append(mount);
  let viewer;
  const clipped = new Set(['blinds', 'checkerboard', 'randomBar', 'strips',
    'circle', 'diamond', 'plus', 'split', 'wheel', 'dissolve']);
  try {
    for (const [page, slide] of presentation.slides.entries()) {
      viewer = new Viewer(mount, { ...presentation, slides: [slide] }, {
        animate: true, textMode: 'svg',
      });
      for (const [index, step] of (slide.animations ?? []).entries()) {
        const node = mount.querySelector(`[data-el="${step.target}"]`);
        if (!node) throw new Error(`动画固件第 ${page + 1} 页第 ${index + 1} 步缺少目标`);
        viewer.playNextAnimation();
        const animation = node.getAnimations()[0];
        if (!animation) throw new Error(`动画固件第 ${page + 1} 页第 ${index + 1} 步没有启动`);
        animation.pause();
        animation.currentTime = step.durationMs / 2;
        const style = getComputedStyle(node);
        const frames = animation.effect?.getKeyframes() ?? [];
        const keyframeCount = frames.length;
        const expectedCount = step.effect === 'randomBar' ? 13
          : step.effect === 'strips' ? 21 : step.effect === 'wheel' ? 73
            : step.effect === 'circle' || step.effect === 'diamond'
              || step.effect === 'plus' && step.dir !== 'in' ? 37
            : step.effect === 'dissolve' ? 9 : step.effect === 'bounce' ? 5 : null;
        if (expectedCount && keyframeCount !== expectedCount) {
          throw new Error(`动画固件第 ${page + 1} 页第 ${index + 1} 步缺少分段关键帧：${keyframeCount}`);
        }
        if (step.effect === 'fly' && step.kind === 'entrance' && step.dir === 'd') {
          const from = animation.effect?.getKeyframes()[0]?.transform;
          const travel = Number(String(from).split(',')[1]?.replace(/[^\d.-]/g, ''));
          if (!(travel > 200)) throw new Error(`飞入没有从幻灯片外开始：${from}`);
        }
        if (clipped.has(step.effect)) {
          const mask = frames[0]?.maskImage;
          if (!mask || !CSS.supports('mask-image', mask) || style.maskImage === 'none') {
            throw new Error(`动画固件第 ${page + 1} 页第 ${index + 1} 步蒙版无效：${mask}`);
          }
        }
        if (step.effect === 'randomBar'
          && String(frames[0]?.maskImage).split('linear-gradient').length !== 129) {
          throw new Error('Chrome 随机条没有独立的细条裁剪区域');
        }
        if (step.effect === 'plus' && step.dir === 'in'
          && (String(frames[0]?.maskImage).split('linear-gradient').length !== 5
            || String(frames[0]?.maskSize) !== '0% 0%, 0% 0%, 0% 0%, 0% 0%')) {
          throw new Error('Chrome 十字向内没有从四个独立角落开始');
        }
        animation.finish();
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (step.kind === 'exit' && node.style.visibility !== 'hidden') {
          throw new Error(`动画固件第 ${page + 1} 页第 ${index + 1} 步退场终态未隐藏`);
        }
        if (step.effect === 'grow' && step.rotation?.to === 90
          && node.style.transform !== 'scale(1) rotate(90deg)') {
          throw new Error(`Chrome 放大旋转终态未保留 90 度旋转：${node.style.transform}`);
        }
      }
      viewer.destroy();
      viewer = null;
    }
  } finally {
    viewer?.destroy();
    presentation.dispose?.();
    mount.remove();
  }
}
