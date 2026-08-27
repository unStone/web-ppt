import { transitionPreferredDirection, type AnimStep, type Slide, type Transition } from '@web-ppt/core';

/**
 * 动画与切换的播放层。全部走 Web Animations API，
 * 不注入 CSS 关键帧，避免污染宿主页面样式。
 */

const OFFSET = 1.15; // 飞入类效果的起始偏移（相对元素自身尺寸）

interface Keyframes {
  from: Keyframe;
  to: Keyframe;
}

function flyOffset(dir: string | undefined): [number, number] {
  switch (dir) {
    case 'l': return [-100 * OFFSET, 0];
    case 'r': return [100 * OFFSET, 0];
    case 'u': return [0, -100 * OFFSET];
    case 'd': return [0, 100 * OFFSET];
    case 'lu': return [-100 * OFFSET, -100 * OFFSET];
    case 'ru': return [100 * OFFSET, -100 * OFFSET];
    case 'ld': return [-100 * OFFSET, 100 * OFFSET];
    case 'rd': return [100 * OFFSET, 100 * OFFSET];
    default: return [0, 100 * OFFSET];
  }
}

function wipeClip(dir: string | undefined, hidden: boolean): string {
  // inset(top right bottom left)：hidden 时把内容完全裁掉
  const full = hidden ? 100 : 0;
  switch (dir) {
    case 'l': return `inset(0 ${full}% 0 0)`;
    case 'r': return `inset(0 0 0 ${full}%)`;
    case 'u': return `inset(0 0 ${full}% 0)`;
    case 'horz': return `inset(0 ${full / 2}% 0 ${full / 2}%)`;
    case 'vert': return `inset(${full / 2}% 0 ${full / 2}% 0)`;
    default: return `inset(${full}% 0 0 0)`;
  }
}

/** 入场动画的关键帧 */
function entranceFrames(step: AnimStep): Keyframes {
  switch (step.effect) {
    case 'appear':
      return { from: { opacity: 0 }, to: { opacity: 1 } };
    case 'fly': {
      const [dx, dy] = flyOffset(step.dir);
      return {
        from: { opacity: 0, transform: `translate(${dx}%, ${dy}%)` },
        to: { opacity: 1, transform: 'translate(0, 0)' },
      };
    }
    case 'zoom':
      return {
        from: { opacity: 0, transform: step.dir === 'out' ? 'scale(1.6)' : 'scale(0.1)' },
        to: { opacity: 1, transform: 'scale(1)' },
      };
    case 'grow':
      return { from: { opacity: 0, transform: 'scale(0.2) rotate(-90deg)' }, to: { opacity: 1, transform: 'scale(1) rotate(0)' } };
    case 'spin':
      return { from: { opacity: 0, transform: 'rotate(-180deg) scale(0.4)' }, to: { opacity: 1, transform: 'rotate(0) scale(1)' } };
    case 'swivel':
      return { from: { opacity: 0, transform: 'rotateY(90deg)' }, to: { opacity: 1, transform: 'rotateY(0)' } };
    case 'float':
      return { from: { opacity: 0, transform: 'translateY(30%)' }, to: { opacity: 1, transform: 'translateY(0)' } };
    case 'bounce':
      return { from: { opacity: 0, transform: 'translateY(-60%)' }, to: { opacity: 1, transform: 'translateY(0)' } };
    case 'stretch':
      return { from: { opacity: 0, transform: 'scaleX(0.05)' }, to: { opacity: 1, transform: 'scaleX(1)' } };
    case 'wipe':
    case 'blinds':
    case 'split':
    case 'wheel':
      return {
        from: { opacity: 1, clipPath: wipeClip(step.dir, true) },
        to: { opacity: 1, clipPath: wipeClip(step.dir, false) },
      };
    case 'dissolve':
    case 'fade':
    case 'random':
    default:
      return { from: { opacity: 0 }, to: { opacity: 1 } };
  }
}

function exitFrames(step: AnimStep): Keyframes {
  const entr = entranceFrames({ ...step, kind: 'entrance' });
  return { from: entr.to, to: entr.from };
}

function emphasisFrames(step: AnimStep): Keyframes {
  switch (step.effect) {
    case 'spin':
      return { from: { transform: 'rotate(0)' }, to: { transform: 'rotate(360deg)' } };
    case 'grow':
      return { from: { transform: 'scale(1)' }, to: { transform: 'scale(1.25)' } };
    default:
      return { from: { opacity: 1 }, to: { opacity: 0.35 } };
  }
}

export function framesFor(step: AnimStep): Keyframes {
  if (step.kind === 'exit') return exitFrames(step);
  if (step.kind === 'emphasis') return emphasisFrames(step);
  // 路径动画的位移由 motionPath 铺关键帧；解不出路径时保持原样，不该退化成淡入
  if (step.kind === 'motion') return { from: { opacity: 1 }, to: { opacity: 1 } };
  return entranceFrames(step);
}

export interface PlayHandle {
  cancel(): void;
  finished: Promise<void>;
}

/** 播放一批动画；返回可取消的句柄 */
export function playGroup(container: Element, group: AnimStep[]): PlayHandle {
  const anims: Animation[] = [];
  let cursor = 0;

  for (const step of group) {
    const node = container.querySelector(`[data-el="${step.target}"]`) as HTMLElement | null;
    if (!node) continue;

    const start = step.trigger === 'afterPrev' ? cursor + step.delayMs : step.delayMs;
    if (step.trigger === 'afterPrev') cursor = start + step.durationMs;
    else cursor = Math.max(cursor, start + step.durationMs);

    const { from, to } = framesFor(step);
    node.style.visibility = 'visible';
    if (step.kind === 'entrance') node.style.opacity = '';

    // 运动路径给的是等距采样点，直接铺成多关键帧；
    // 用 offset-path 会更"正统"，但它在 <img> 加载的 SVG 与 foreignObject 里支持不一致
    const frames: Keyframe[] = step.motionPath?.length
      ? step.motionPath.map(([dx, dy]) => ({ transform: `translate(${dx}px, ${dy}px)` }))
      : [from, to];

    try {
      const anim = node.animate(frames, {
        duration: step.durationMs,
        delay: start,
        // 路径动画在 PowerPoint 里是匀速，不能套入场用的缓动
        easing: step.motionPath?.length ? 'linear' : 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        fill: 'both',
      });
      if (step.kind === 'exit') {
        anim.finished.then(() => { node.style.visibility = 'hidden'; }).catch(() => undefined);
      }
      anims.push(anim);
    } catch {
      // 浏览器不支持某个属性时直接落到终态
      Object.assign(node.style, (frames[frames.length - 1] ?? to) as Record<string, string>);
    }
  }

  return {
    cancel: () => anims.forEach((a) => { try { a.finish(); } catch { /* 已结束 */ } }),
    finished: Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => undefined),
  };
}

// ---------------- 切换 ----------------

export function transitionFrames(t: Transition, incoming: boolean): Keyframe[] {
  const d = t.dir ?? transitionPreferredDirection(t.type) ?? '';
  const shift = (x: string, y: string): string => `translate(${x}, ${y})`;
  const dirVec = (): [string, string] => {
    const vectors: Readonly<Record<string, [string, string]>> = {
      l: ['-100%', '0'], r: ['100%', '0'], u: ['0', '-100%'], d: ['0', '100%'],
      lu: ['-100%', '-100%'], ld: ['-100%', '100%'],
      ru: ['100%', '-100%'], rd: ['100%', '100%'],
    };
    return vectors[d] ?? vectors.d;
  };

  switch (t.type) {
    case 'cut':
      // cut 没有补间，但仍要让旧页在切点前可见；否则预览只会创建一条视觉空动画。
      return incoming ? [{ opacity: 1 }, { opacity: 1 }] : [
        { opacity: 1, offset: 0 }, { opacity: 1, offset: 0.49 },
        { opacity: 0, offset: 0.5 }, { opacity: 0, offset: 1 },
      ];
    case 'push':
    case 'pull': {
      const [x, y] = dirVec();
      const sign = t.type === 'pull' ? -1 : 1;
      const inv = (v: string): string => (v === '0' ? '0' : `${-parseFloat(v) * sign}%`);
      return incoming
        ? [{ transform: shift(sign > 0 ? x : inv(x), sign > 0 ? y : inv(y)) }, { transform: 'translate(0,0)' }]
        : [{ transform: 'translate(0,0)' }, { transform: shift(inv(x), inv(y)) }];
    }
    case 'cover': {
      const [x, y] = dirVec();
      return incoming
        ? [{ transform: shift(x, y) }, { transform: 'translate(0,0)' }]
        : [{ opacity: 1 }, { opacity: 1 }];
    }
    case 'wipe': {
      const clipHidden = wipeClip(d || 'd', true);
      const clipShown = wipeClip(d || 'd', false);
      return incoming ? [{ clipPath: clipHidden }, { clipPath: clipShown }] : [{ opacity: 1 }, { opacity: 1 }];
    }
    case 'split': {
      const vertical = d.startsWith('vert');
      const out = d.endsWith('out');
      const hidden = vertical ? 'inset(0 50% 0 50%)' : 'inset(50% 0 50% 0)';
      const shown = 'inset(0 0 0 0)';
      return incoming ? (out ? [{ clipPath: hidden }, { clipPath: shown }] : [{ clipPath: shown }, { clipPath: shown }]) : [{ clipPath: shown }, { clipPath: hidden }];
    }
    case 'zoom':
      return incoming
        ? [{ opacity: 0, transform: d === 'out' ? 'scale(1.4)' : 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }]
        : [{ opacity: 1 }, { opacity: 0 }];
    case 'wheel':
    case 'circle':
    case 'diamond':
    case 'plus':
    case 'wedge':
      return incoming
        ? [{ opacity: 0, transform: 'scale(0.7)' }, { opacity: 1, transform: 'scale(1)' }]
        : [{ opacity: 1 }, { opacity: 0 }];

    // ---- p14 扩展 ----
    // 这些效果原版是 GPU 网格变形（蜂巢、碎纸、涡流…），DOM 里没有对等物。
    // 取每种最有辨识度的那一维（旋转轴 / 缩放中心 / 裁剪形状）做近似，
    // 保证"不同的效果看起来确实不同"，不追求逐帧还原。
    case 'ripple':
      {
        const origins: Readonly<Record<string, string>> = {
          lu: '0% 0%', ld: '0% 100%', ru: '100% 0%', rd: '100% 100%', center: '50% 50%',
        };
        const origin = origins[d] ?? origins.center;
        return incoming
          ? [{ clipPath: `circle(0% at ${origin})` }, { clipPath: `circle(145% at ${origin})` }]
          : [{ opacity: 1 }, { opacity: 1 }];
      }
    case 'vortex': {
      const [x, y] = dirVec();
      const angle = d === 'r' || d === 'd' ? 180 : -180;
      return incoming
        ? [{ opacity: 0, transformOrigin: `${x === '0' ? '50%' : x.startsWith('-') ? '0%' : '100%'} ${y === '0' ? '50%' : y.startsWith('-') ? '0%' : '100%'}`, transform: `scale(0.2) rotate(${angle}deg)` }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 1 }, { opacity: 0 }];
    }
    case 'honeycomb':
      return incoming
        ? [{ opacity: 0, transform: 'scale(0.85) rotate(-6deg)' }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.1)' }];
    case 'glitter':
      return incoming
        ? [{ opacity: 0, clipPath: wipeClip(d || 'l', true) }, { opacity: 1, clipPath: wipeClip(d || 'l', false) }]
        : [{ opacity: 1 }, { opacity: 0 }];
    case 'shred': {
      const outward = d === 'out';
      return incoming
        ? [{ opacity: 0, transform: outward ? 'scale(1.35) rotate(5deg)' : 'scale(0.72) rotate(-5deg)' }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: outward ? 'scaleY(0.72)' : 'scaleY(1.2)' }];
    }
    case 'flash':
      // 闪白：拉高亮度再落回，比单纯淡入更贴近原效果
      return incoming
        ? [{ opacity: 0, filter: 'brightness(3)' }, { opacity: 1, filter: 'brightness(1)' }]
        : [{ opacity: 1, filter: 'brightness(1)' }, { opacity: 0, filter: 'brightness(3)' }];
    case 'reveal': {
      const [x, y] = dirVec();
      return incoming
        ? [{ opacity: 0, transform: shift(x, y) }, { opacity: 1, transform: 'translate(0,0)' }]
        : [{ opacity: 1 }, { opacity: 0 }];
    }
    case 'wheelReverse':
      return incoming
        ? [{ opacity: 0, transform: 'scale(1.3) rotate(20deg)' }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 1 }, { opacity: 0 }];
    case 'doors': {
      // 门从中间向两侧打开：新页由中缝向外展开
      const hidden = d === 'horz' ? 'inset(50% 0 50% 0)' : 'inset(0 50% 0 50%)';
      return incoming
        ? [{ clipPath: hidden }, { clipPath: 'inset(0 0 0 0)' }]
        : [{ opacity: 1 }, { opacity: 1 }];
    }
    case 'window': {
      const hidden = d === 'horz' ? 'inset(0 50% 0 50%)' : 'inset(50% 0 50% 0)';
      return incoming
        ? [{ clipPath: hidden }, { clipPath: 'inset(0 0 0 0)' }]
        : [{ opacity: 1 }, { opacity: 1 }];
    }
    case 'switch':
    case 'flip': {
      const sign = (t.type === 'flip' ? -1 : 1) * (d === 'r' ? -1 : 1);
      return incoming
        ? [{ opacity: 0, transform: `perspective(1400px) rotateY(${sign * -80}deg)` },
          { opacity: 1, transform: 'perspective(1400px) rotateY(0)' }]
        : [{ opacity: 1, transform: 'perspective(1400px) rotateY(0)' },
          { opacity: 0, transform: `perspective(1400px) rotateY(${sign * 80}deg)` }];
    }
    case 'prism': {
      const vertical = d === 'u' || d === 'd';
      const sign = d === 'r' || d === 'd' ? -1 : 1;
      const rotate = (degrees: number): string => vertical
        ? `rotateX(${degrees}deg)` : `rotateY(${degrees}deg)`;
      return incoming
        ? [{ opacity: 0, transform: `perspective(1400px) ${rotate(sign * -70)}` },
          { opacity: 1, transform: `perspective(1400px) ${rotate(0)}` }]
        : [{ opacity: 1, transform: `perspective(1400px) ${rotate(0)}` },
          { opacity: 0, transform: `perspective(1400px) ${rotate(sign * 70)}` }];
    }
    case 'ferris': {
      const sign = d === 'r' ? -1 : 1;
      return incoming
        ? [{ opacity: 0, transform: `perspective(1400px) rotateX(${sign * 70}deg)` },
          { opacity: 1, transform: 'perspective(1400px) rotateX(0)' }]
        : [{ opacity: 1, transform: 'perspective(1400px) rotateX(0)' },
          { opacity: 0, transform: `perspective(1400px) rotateX(${sign * -70}deg)` }];
    }
    case 'gallery':
    case 'conveyor': {
      const back = t.type === 'conveyor' ? 25 : 12;
      const from = d.includes('l') ? '-100%' : '100%';
      const to = d.includes('l') ? '100%' : '-100%';
      return incoming
        ? [{ transform: `perspective(1600px) translateX(${from}) rotateY(${back}deg)` },
          { transform: 'perspective(1600px) translateX(0) rotateY(0)' }]
        : [{ transform: 'perspective(1600px) translateX(0) rotateY(0)' },
          { transform: `perspective(1600px) translateX(${to}) rotateY(${-back}deg)` }];
    }
    case 'pan': {
      // 与 push 同构，只是 PowerPoint 里配的时长更长
      const [x, y] = dirVec();
      const inv = (v: string): string => (v === '0' ? '0' : `${-parseFloat(v)}%`);
      return incoming
        ? [{ transform: shift(x, y) }, { transform: 'translate(0,0)' }]
        : [{ transform: 'translate(0,0)' }, { transform: shift(inv(x), inv(y)) }];
    }
    case 'flythrough': {
      const fromScale = d === 'out' ? 2.2 : 0.15;
      const toScale = d === 'out' ? 0.15 : 2.2;
      return incoming
        ? [{ opacity: 0, transform: `perspective(1000px) scale(${fromScale})` }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `perspective(1000px) scale(${toScale})` }];
    }
    case 'warp': {
      const outward = d === 'out';
      return incoming
        ? [{ opacity: 0, transform: outward ? 'skewX(-18deg) scale(1.35)' : 'skewX(18deg) scale(0.65)' }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: outward ? 'skewX(18deg) scale(0.65)' : 'skewX(-18deg) scale(1.35)' }];
    }

    case 'blinds':
    case 'checker':
    case 'randomBar': {
      const hidden = wipeClip(d, true);
      return incoming
        ? [{ opacity: 0.2, clipPath: hidden }, { opacity: 1, clipPath: wipeClip(d, false) }]
        : [{ opacity: 1 }, { opacity: 0 }];
    }
    case 'comb': {
      const transform = d === 'vert' ? 'translateY(-100%)' : 'translateX(-100%)';
      return incoming
        ? [{ opacity: 0, transform }, { opacity: 1, transform: 'translate(0,0)' }]
        : [{ opacity: 1 }, { opacity: 0 }];
    }
    case 'strips': {
      const corners: Readonly<Record<string, string>> = {
        lu: '0% 0%', ld: '0% 100%', ru: '100% 0%', rd: '100% 100%',
      };
      const origin = corners[d] ?? corners.rd;
      return incoming
        ? [{ opacity: 0, clipPath: `circle(0% at ${origin})` }, { opacity: 1, clipPath: `circle(145% at ${origin})` }]
        : [{ opacity: 1 }, { opacity: 0 }];
    }
    case 'newsflash':
    case 'dissolve':
    case 'fade':
    case 'morph':
    default:
      return incoming ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
  }
}

/**
 * 等一组动画结束，但不无限等。
 *
 * 后台标签页的 document timeline 是暂停的，Animation.finished 永远不会 resolve；
 * 配合自动换片就会让旧图层一层层堆着不被移除。超时后按已到终态处理。
 */
function settle(jobs: Promise<unknown>[], durationMs: number): Promise<void> {
  const all = Promise.all(jobs.map((p) => p.catch(() => undefined))).then(() => undefined);
  if (typeof setTimeout !== 'function') return all;
  return Promise.race([all, new Promise<void>((r) => setTimeout(r, durationMs + 250))]);
}

/**
 * morph：按 data-el（形状 id）在前后两页之间配对，配上的元素做几何补间，
 * 其余淡入淡出。PowerPoint 的 morph 也是按形状 id 匹配的——morph 版面
 * 基本都由「复制上一页再改」得来，id 天然一致。
 *
 * 配对成功的旧元素立刻置 0，新元素全程不透明，看起来才是"同一个东西在动"，
 * 而不是两层叠化。option="byWord"/"byChar" 的细粒度拆分不做，一律按对象处理。
 */
export function morphPairs(
  outgoing: Element, incoming: Element,
): { node: HTMLElement; from: DOMRect; to: DOMRect }[] {
  const outMap = new Map<string, DOMRect>();
  outgoing.querySelectorAll('[data-el]').forEach((el) => {
    const r = el.getBoundingClientRect();
    // 无布局信息（Node / 未挂载）时不参与配对，退回淡化
    if (r.width > 0 || r.height > 0) outMap.set(el.getAttribute('data-el') ?? '', r);
  });
  const pairs: { node: HTMLElement; from: DOMRect; to: DOMRect }[] = [];
  incoming.querySelectorAll('[data-el]').forEach((el) => {
    const from = outMap.get(el.getAttribute('data-el') ?? '');
    if (!from) return;
    const to = el.getBoundingClientRect();
    if (to.width <= 0 && to.height <= 0) return;
    pairs.push({ node: el as HTMLElement, from, to });
  });
  return pairs;
}

export interface TransitionPlayHandle {
  readonly animations: readonly Animation[];
  readonly finished: Promise<void>;
  cancel(): void;
}

function transitionHandle(
  animations: Animation[], outgoing: HTMLElement | null, durationMs: number,
): TransitionPlayHandle {
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    for (const animation of animations) {
      try { animation.cancel(); } catch { /* timeline 已释放。 */ }
    }
    outgoing?.remove();
  };
  const finished = settle(animations.map((animation) => animation.finished), durationMs)
    .then(release);
  return { animations, finished, cancel: release };
}

function playMorphControlled(
  outgoing: HTMLElement | null, incoming: HTMLElement, t: Transition,
): TransitionPlayHandle {
  if (!outgoing) return transitionHandle([], null, t.durationMs);
  const opts: KeyframeAnimationOptions = { duration: t.durationMs, easing: 'ease-in-out', fill: 'both' };
  const pairs = morphPairs(outgoing, incoming);
  const matched = new Set(pairs.map((p) => p.node.getAttribute('data-el')));
  const animations: Animation[] = [];

  const run = (node: HTMLElement, frames: Keyframe[]): void => {
    try { animations.push(node.animate(frames, opts)); } catch { /* 不支持则跳过 */ }
  };

  for (const { node, from, to } of pairs) {
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const sx = to.width > 0 ? from.width / to.width : 1;
    const sy = to.height > 0 ? from.height / to.height : 1;
    run(node, [
      { transformOrigin: 'left top', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: 'left top', transform: 'none' },
    ]);
  }
  // 配对上的旧元素直接隐掉，避免与补间中的新元素形成双影
  outgoing.querySelectorAll('[data-el]').forEach((el) => {
    const dup = matched.has(el.getAttribute('data-el'));
    run(el as HTMLElement, dup ? [{ opacity: 0 }, { opacity: 0 }] : [{ opacity: 1 }, { opacity: 0 }]);
  });
  // 新页里没有对应旧元素的部分淡入；已配对的靠上面的补间，不参与整层淡化
  incoming.querySelectorAll('[data-el]').forEach((el) => {
    if (!matched.has(el.getAttribute('data-el'))) run(el as HTMLElement, [{ opacity: 0 }, { opacity: 1 }]);
  });

  return transitionHandle(animations, outgoing, t.durationMs);
}

/**
 * 播放切换：把旧内容截图式地留在下层，新内容在上层按效果进场。
 * outgoing 为旧内容节点（可为 null），incoming 为新内容节点。
 */
export function playTransitionControlled(
  outgoing: HTMLElement | null,
  incoming: HTMLElement,
  t: Transition | undefined,
): TransitionPlayHandle {
  if (!t || t.type === 'none') {
    outgoing?.remove();
    return transitionHandle([], null, 0);
  }
  // morph 不能整层动画：它要逐元素配对补间
  if (t.type === 'morph' && outgoing) return playMorphControlled(outgoing, incoming, t);

  const opts: KeyframeAnimationOptions = { duration: t.durationMs, easing: 'ease-in-out', fill: 'both' };
  const animations: Animation[] = [];
  try {
    animations.push(incoming.animate(transitionFrames(t, true), opts));
    if (outgoing) animations.push(outgoing.animate(transitionFrames(t, false), opts));
  } catch {
    // 第二层 animate 失败时，第一层可能已经创建；必须同步回收，不能留下 fill:both 残影。
    for (const animation of animations) {
      void animation.finished.catch(() => undefined);
      try { animation.cancel(); } catch { /* timeline 已释放。 */ }
    }
    outgoing?.remove();
    return transitionHandle([], null, 0);
  }
  return transitionHandle(animations, outgoing, t.durationMs);
}

export function playTransition(
  outgoing: HTMLElement | null,
  incoming: HTMLElement,
  t: Transition | undefined,
): Promise<void> {
  return playTransitionControlled(outgoing, incoming, t).finished;
}

/** 幻灯片是否配置了自动换片 */
export function autoAdvanceMs(slide: Slide): number | null {
  const ms = slide.transition?.advanceAfterMs;
  return ms !== undefined && ms >= 0 ? ms : null;
}
