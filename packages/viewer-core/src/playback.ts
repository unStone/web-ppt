import type { AnimStep, Slide, Transition } from 'web-ppt';

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
  return entranceFrames(step);
}

/** 把动画按点击批次分组 */
export function groupSteps(steps: AnimStep[] | undefined): AnimStep[][] {
  if (!steps?.length) return [];
  const groups: AnimStep[][] = [];
  for (const s of steps) {
    const g = s.clickGroup ?? 0;
    (groups[g] ??= []).push(s);
  }
  return groups.filter(Boolean);
}

/** 一批动画开始前，哪些元素应处于隐藏状态 */
export function hiddenBefore(groups: AnimStep[][], upTo: number): Set<number> {
  const hidden = new Set<number>();
  // 入场动画未播放前隐藏
  for (let g = upTo; g < groups.length; g++) {
    for (const s of groups[g]) if (s.kind === 'entrance') hidden.add(s.target);
  }
  // 已播放的退场动画保持隐藏
  for (let g = 0; g < upTo; g++) {
    for (const s of groups[g]) if (s.kind === 'exit') hidden.add(s.target);
  }
  // 后续还有入场的元素不应因为早前的退场而被永久隐藏
  for (let g = upTo; g < groups.length; g++) {
    for (const s of groups[g]) if (s.kind === 'entrance') hidden.add(s.target);
  }
  return hidden;
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

    try {
      const anim = node.animate([from, to], {
        duration: step.durationMs,
        delay: start,
        easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        fill: 'both',
      });
      if (step.kind === 'exit') {
        anim.finished.then(() => { node.style.visibility = 'hidden'; }).catch(() => undefined);
      }
      anims.push(anim);
    } catch {
      // 浏览器不支持某个属性时直接落到终态
      Object.assign(node.style, to as Record<string, string>);
    }
  }

  return {
    cancel: () => anims.forEach((a) => { try { a.finish(); } catch { /* 已结束 */ } }),
    finished: Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => undefined),
  };
}

// ---------------- 切换 ----------------

function transitionFrames(t: Transition, incoming: boolean): Keyframe[] {
  const d = t.dir ?? '';
  const shift = (x: string, y: string): string => `translate(${x}, ${y})`;
  const dirVec = (): [string, string] =>
    d.includes('l') ? ['-100%', '0'] : d.includes('r') ? ['100%', '0']
    : d.includes('u') ? ['0', '-100%'] : ['0', '100%'];

  switch (t.type) {
    case 'cut':
      return incoming ? [{ opacity: 1 }, { opacity: 1 }] : [{ opacity: 0 }, { opacity: 0 }];
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
    case 'blinds':
    case 'checker':
    case 'comb':
    case 'randomBar':
    case 'strips':
    case 'newsflash':
    case 'dissolve':
    case 'fade':
    default:
      return incoming ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
  }
}

/**
 * 播放切换：把旧内容截图式地留在下层，新内容在上层按效果进场。
 * outgoing 为旧内容节点（可为 null），incoming 为新内容节点。
 */
export function playTransition(
  outgoing: HTMLElement | null,
  incoming: HTMLElement,
  t: Transition | undefined,
): Promise<void> {
  if (!t || t.type === 'none') {
    outgoing?.remove();
    return Promise.resolve();
  }
  const opts: KeyframeAnimationOptions = { duration: t.durationMs, easing: 'ease-in-out', fill: 'both' };
  const jobs: Promise<unknown>[] = [];
  try {
    jobs.push(incoming.animate(transitionFrames(t, true), opts).finished);
    if (outgoing) jobs.push(outgoing.animate(transitionFrames(t, false), opts).finished);
  } catch {
    outgoing?.remove();
    return Promise.resolve();
  }
  return Promise.all(jobs.map((p) => p.catch(() => undefined))).then(() => {
    outgoing?.remove();
  });
}

/** 幻灯片是否配置了自动换片 */
export function autoAdvanceMs(slide: Slide): number | null {
  const ms = slide.transition?.advanceAfterMs;
  return ms !== undefined && ms > 0 ? ms : null;
}
