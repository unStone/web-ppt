/**
 * 动画统一验收的浏览器侧驱动。
 *
 * 真实 Chrome 里用 Web Animations 的 `currentTime` 把每一步动画精确寻址到
 * 固定时间点，读计算样式与 painted 几何（getBoundingClientRect）做断言——
 * 在「关键帧声明对」之外再验「浏览器渲染出的中间态对」。seek 后无 rAF
 * 时序依赖，结果确定性成立。
 *
 * 断言分三档，全部动画效果与切换共用同一套驱动：
 * 1. 端点（t=0 / t=1）：计算样式 == framesFor / transitionFrames 声明的
 *    from / to（经探针元素归一化，两边走同一套序列化）；
 * 2. 中点（t=0.5）：线性多关键帧效果断言精确中间帧（opacity / maskSize /
 *    clipPath / transform 与 KeyframeEffect.getKeyframes 逐字段比对）；
 *    贝塞尔双关键帧效果断言标量通道严格处于两端点之间、transform 不同于
 *    任一端点；
 * 3. 几何：fly / grow / stretch / motionPath 等的包围盒在中间态的真实位置。
 *
 * 由 tooling/test-animation-acceptance.mjs 打包进 Chrome 调用。
 */

export const TRANSITION_TYPES = [
  'none',
  'fade',
  'cut',
  'push',
  'pull',
  'cover',
  'wipe',
  'split',
  'zoom',
  'dissolve',
  'checker',
  'blinds',
  'comb',
  'wheel',
  'circle',
  'diamond',
  'plus',
  'wedge',
  'newsflash',
  'randomBar',
  'strips',
  'vortex',
  'switch',
  'flip',
  'ripple',
  'honeycomb',
  'glitter',
  'warp',
  'flythrough',
  'flash',
  'shred',
  'reveal',
  'wheelReverse',
  'ferris',
  'gallery',
  'conveyor',
  'pan',
  'doors',
  'window',
  'prism',
  'morph',
];

export function createAnimationAcceptance(api) {
  const { parse, renderSlideToSvg, framesFor, playGroup, playTransitionControlled, transitionFrames, settledDeclaration } = api;
  let decks = new Map();
  let deckName = null;
  let container = null;
  let slideIndex = -1;
  let baseSamples = new Map();
  let lastHandle = null;
  let lastNode = null;
  let lastStep = null;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:200px;height:100px';
  document.body.appendChild(probe);
  // 切换层的百分比 transform（translate(-100%) 等）按 1280×720 的层尺寸解析，
  // 必须用同尺寸探针归一化，不能用小探针
  const probeLayer = document.createElement('div');
  probeLayer.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1280px;height:720px';
  document.body.appendChild(probeLayer);
  // 关键帧对象的 offset / easing / composite 是动画元数据；CSS 的 offset 是
  // motion path 简写属性，喂进探针只会产出无关值
  const KEYFRAME_META = new Set(['offset', 'easing', 'composite']);

  /** 把声明值喂给探针元素再读计算样式：两端走同一套序列化，字符串比较才有意义 */
  const normalize = (declared, layer = false) => {
    const host = layer ? probeLayer : probe;
    const out = {};
    for (const [key, value] of Object.entries(declared ?? {})) {
      if (value == null || KEYFRAME_META.has(key)) continue;
      host.style[key] = String(value);
      out[key] = getComputedStyle(host)[key];
    }
    for (const key of Object.keys(out)) host.style[key] = '';
    return out;
  };

  const sampleOf = (node) => {
    const cs = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      opacity: cs.opacity,
      transform: cs.transform,
      clipPath: cs.clipPath,
      maskSize: cs.maskSize ?? '',
      visibility: cs.visibility,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    };
  };

  /** 0.5 处的期望值：先找精确命中 offset=0.5 的关键帧，再对相邻两帧做数值插值 */
  const midpointExpectation = (keyframes) => {
    const frames = keyframes.filter((k) => k.offset !== undefined || k.offset === 0);
    const exact = frames.find((k) => Math.abs(k.offset - 0.5) < 1e-9);
    if (exact) return exact;
    const hi = frames.findIndex((k) => k.offset > 0.5);
    if (hi <= 0) return null;
    const lo = frames[hi - 1];
    const mix = (0.5 - lo.offset) / (frames[hi].offset - lo.offset);
    const out = {};
    for (const key of ['opacity', 'maskSize']) {
      const a = parseFloat(lo[key]),
        b = parseFloat(frames[hi][key]);
      if (Number.isFinite(a) && Number.isFinite(b)) out[key] = String(a + (b - a) * mix);
    }
    return out;
  };

  return {
    /** 解析一份文稿（deck 名区分效果固件与 showcase，二者并存）并清点视觉步骤 */
    async openDeck(name, bytes) {
      const pres = await parse(new Uint8Array(bytes), { lazy: false });
      decks.set(name, pres);
      const steps = [];
      pres.slides.forEach((slide, index) => {
        for (const step of slide.animations ?? []) {
          if (!step.mediaCommand)
            steps.push({
              slide: index,
              target: step.target,
              kind: step.kind,
              effect: step.effect,
              dir: step.dir,
              durationMs: step.durationMs,
              pathEnd: step.motionPath?.[step.motionPath.length - 1] ?? null,
            });
        }
      });
      return { slides: pres.slides.length, steps, transitions: pres.slides.filter((s) => s.transition).length };
    },

    /** 渲染指定文稿的第 i 页并记录每步的未动画基准（计算样式与 painted 几何） */
    mountSlide(name, i) {
      lastHandle?.cancel();
      lastHandle = null;
      container?.remove();
      deckName = name;
      const pres = decks.get(name);
      slideIndex = i;
      container = document.createElement('div');
      container.style.cssText = 'position:relative;width:1280px;height:720px;overflow:hidden;background:#fff';
      container.innerHTML = renderSlideToSvg(pres, pres.slides[i]);
      document.body.appendChild(container);
      baseSamples = new Map();
      for (const step of pres.slides[i].animations ?? []) {
        const node = container.querySelector(`[data-el="${step.target}"]`);
        if (node) baseSamples.set(step.target, sampleOf(node));
      }
      return [...baseSamples.keys()];
    },

    /** 对当前页 target 号步骤 seek 到 t∈[0,1]，返回断言所需的全部原始数据 */
    sampleStep(target, t) {
      lastHandle?.cancel();
      const pres = decks.get(deckName);
      const step = pres.slides[slideIndex].animations.find((a) => a.target === target);
      const node = container.querySelector(`[data-el="${target}"]`);
      if (!step || !node) return { missing: target };
      lastNode = node;
      lastStep = step;
      lastHandle = playGroup(container, [step]);
      const anim = lastHandle.animations[0];
      if (!anim) return { noAnimation: target };
      anim.pause();
      anim.currentTime = step.delayMs + t * step.durationMs;
      const declared = framesFor(step);
      const t0 = t === 0,
        t1 = t === 1;
      // 百分比 transform（fly/fly-bounce 的 translateY(±60%)）按元素自身尺寸解析，
      // 探针必须与元素同尺寸，归一化值才能和计算样式可比
      const base = baseSamples.get(target);
      if (base) {
        probe.style.width = `${base.rect.w}px`;
        probe.style.height = `${base.rect.h}px`;
      }
      // fly 的离场位移在播放时动态求解（offSlideTransform），不属于静态声明；
      // 它的 t=0 端点只断言 opacity，位移由几何断言覆盖
      const dynamicTransform = step.effect === 'fly';
      const want = t0
        ? step.effect === 'appear' && step.kind === 'entrance'
          ? normalize(declared.to)
          : normalize(declared.from)
        : t1
          ? normalize(declared.to)
          : null;
      if (dynamicTransform && want) delete want.transform;
      const keyframes = anim.effect?.getKeyframes?.() ?? [];
      const settled = t1 && step.kind === 'emphasis' ? settledDeclaration(step) : null;
      return {
        target,
        effect: step.effect,
        kind: step.kind,
        dir: step.dir,
        got: sampleOf(node),
        want,
        base,
        animationCount: lastHandle.animations.length,
        keyframeCount: keyframes.length,
        midWant: t === 0.5 && keyframes.length > 2 ? normalize(midpointExpectation(keyframes)) : null,
        settled: settled ? normalize(settled) : null,
        linear:
          !!step.motionPath?.length
          || ['randomBar', 'strips', 'wheel', 'circle', 'diamond', 'plus', 'dissolve', 'bounce', 'swivel'].includes(step.effect),
      };
    },

    /** 合成切换：两个实底容器叠加，seek 后返回两层的计算样式与期望。
     *  帧与动画必须用同一个 transition 对象（horz-out 由各引擎自行解释方向）。 */
    sampleTransition(type, dir, t) {
      lastHandle?.cancel();
      const outgoing = document.createElement('div');
      const incoming = document.createElement('div');
      for (const [el, color] of [
        [outgoing, '#c0504d'],
        [incoming, '#4f6228'],
      ]) {
        el.style.cssText = `position:absolute;inset:0;width:1280px;height:720px;background:${color}`;
        container.appendChild(el);
      }
      const transition = { type, dir, durationMs: 600 };
      const inFrames = transitionFrames(transition, true);
      const outFrames = transitionFrames(transition, false);
      // 层内容用真实渲染的页面：morph 的逐元素配对需要 data-el 节点，
      // 纯色容器会让 morph 退化成无动画
      const pres = decks.get(deckName);
      const slideA = pres.slides[Math.max(0, slideIndex - 1) % pres.slides.length];
      const slideB = pres.slides[slideIndex % pres.slides.length];
      outgoing.innerHTML = renderSlideToSvg(pres, slideA);
      incoming.innerHTML = renderSlideToSvg(pres, slideB);
      lastHandle = playTransitionControlled(outgoing, incoming, transition);
      const inAnim = lastHandle.animations[0];
      const outAnim = lastHandle.animations[1];
      if (!inAnim) {
        outgoing.remove();
        incoming.remove();
        return { type, dir, skip: true };
      }
      // morph 逐元素配对补间：层本身不动，活动发生在 data-el 子元素上，
      // 且句柄里的全部动画（每个配对一个）都要 seek
      if (type === 'morph') {
        for (const animation of lastHandle.animations) {
          animation.pause();
          animation.currentTime = t * 600;
        }
        const opacitySum = [...outgoing.querySelectorAll('[data-el]'), ...incoming.querySelectorAll('[data-el]')].reduce(
          (sum, el) => sum + parseFloat(getComputedStyle(el).opacity),
          0,
        );
        const result = { type, dir, morph: true, opacitySum, animationCount: lastHandle.animations.length };
        outgoing.remove();
        incoming.remove();
        return result;
      }
      inAnim.pause();
      inAnim.currentTime = t * 600;
      if (outAnim) {
        outAnim.pause();
        outAnim.currentTime = t * 600;
      }
      // 切换关键帧可能是阶梯式多帧（cut 在 0.5 翻页）：端点取首末帧，
      // 中点优先取精确命中 offset=0.5 的帧
      const inKeyframes = inAnim.effect?.getKeyframes?.() ?? inFrames;
      const exactMid = inKeyframes.find((k) => k.offset !== undefined && Math.abs(k.offset - 0.5) < 1e-9);
      const result = {
        type,
        dir,
        incoming: sampleOf(incoming),
        outgoing: outgoing.isConnected ? sampleOf(outgoing) : null,
        wantIn0: normalize(inKeyframes[0], true),
        wantIn1: normalize(inKeyframes[inKeyframes.length - 1], true),
        midWantIn: t === 0.5 && exactMid ? normalize(exactMid, true) : null,
        wantOut1: normalize(outFrames[outFrames.length - 1], true),
        animationCount: lastHandle.animations.length,
        rect: incoming.getBoundingClientRect().toJSON(),
      };
      outgoing.remove();
      incoming.remove();
      return result;
    },

    /** 截图取证用的复寻址：把最近一次步骤重新 seek 到 t 并返回采样 */
    seekLast(t) {
      const anim = lastHandle?.animations?.[0];
      if (!anim || !lastNode || !lastStep) return null;
      anim.pause();
      anim.currentTime = lastStep.delayMs + t * lastStep.durationMs;
      return sampleOf(lastNode);
    },

    close() {
      lastHandle?.cancel();
      container?.remove();
      probe.remove();
      for (const pres of decks.values()) pres.dispose?.();
      decks = new Map();
    },
  };
}
