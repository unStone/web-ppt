import type { AnimStep } from '@web-ppt/core';
import {
  blindsClip, boxInClip, boxInMask, boxOutClip, checkerClip, circleClip, diamondClip,
  dissolveClip, plusClip, randomBarClip, splitClip, stripsClip, wheelClip, wheelSequence, wipeClip,
} from './clips';
import { FULL_REGION, isFull, type ClipRegion } from './region';

const OFFSET = 1.15;

export interface Keyframes {
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

function clipFrames(hidden: string, shown: string): Keyframes {
  return {
    from: { opacity: 1, clipPath: hidden },
    to: { opacity: 1, clipPath: shown },
  };
}

/** 入场关键帧。region 缺省整框；段落把墨迹百分比传进来。aspect 是像素宽高比。 */
export function entranceFrames(step: AnimStep, region: ClipRegion = FULL_REGION, aspect = 1): Keyframes {
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
      if (step.dir === 'in') {
        if (isFull(region)) return { from: boxInMask(false), to: boxInMask(true) };
        return clipFrames(boxInClip(false, region), boxInClip(true, region));
      }
      if (step.dir === 'out') return clipFrames(boxOutClip(false, region), boxOutClip(true, region));
      return {
        from: { opacity: 0, transform: 'scale(0.1)' },
        to: { opacity: 1, transform: 'scale(1)' },
      };
    case 'grow':
      return { from: { opacity: 0, transform: 'scale(0.2) rotate(-90deg)' }, to: { opacity: 1, transform: 'scale(1) rotate(0)' } };
    case 'spin':
      return { from: { opacity: 0, transform: 'rotate(-180deg) scale(0.4)' }, to: { opacity: 1, transform: 'rotate(0) scale(1)' } };
    case 'swivel':
      // SVG 不应用 rotateY / perspective，立体翻转会退化成整框淡入。
      // 绕竖直轴从侧面转到正面，看得见的就是横向从一条线拉开。
      return {
        from: { opacity: 1, transform: 'scaleX(0)' },
        to: { opacity: 1, transform: 'scaleX(1)' },
      };
    case 'float':
      return { from: { opacity: 0, transform: 'translateY(30%)' }, to: { opacity: 1, transform: 'translateY(0)' } };
    case 'bounce':
      return { from: { opacity: 0, transform: 'translateY(-60%)' }, to: { opacity: 1, transform: 'translateY(0)' } };
    case 'stretch': {
      const vertical = step.dir === 'vert' || step.dir === 'u' || step.dir === 'd';
      return {
        from: { opacity: 0, transform: vertical ? 'scaleY(0.05)' : 'scaleX(0.05)' },
        to: { opacity: 1, transform: vertical ? 'scaleY(1)' : 'scaleX(1)' },
      };
    }
    case 'blinds':
      return clipFrames(blindsClip(step.dir, false, region), blindsClip(step.dir, true, region));
    case 'checker':
      return clipFrames(checkerClip(step.dir, 'closed', region, aspect), checkerClip(step.dir, 'open', region, aspect));
    case 'randomBar':
      return clipFrames(randomBarClip(step.dir, false, region), randomBarClip(step.dir, true, region));
    case 'strips':
      return clipFrames(stripsClip(step.dir, false, region), stripsClip(step.dir, true, region));
    case 'circle':
      return clipFrames(
        circleClip(step.dir !== 'out', false, region, aspect),
        circleClip(step.dir !== 'out', true, region, aspect),
      );
    case 'diamond':
      return clipFrames(diamondClip(step.dir !== 'out', false, region), diamondClip(step.dir !== 'out', true, region));
    case 'plus':
      return clipFrames(plusClip(step.dir !== 'out', false, region), plusClip(step.dir !== 'out', true, region));
    case 'wipe':
      return clipFrames(wipeClip(step.dir, true), wipeClip(step.dir, false));
    case 'split':
      return clipFrames(splitClip(step.dir, false, region), splitClip(step.dir, true, region));
    case 'wheel':
      return clipFrames(wheelClip(step.dir, false, region, aspect), wheelClip(step.dir, true, region, aspect));
    case 'dissolve':
      return clipFrames(dissolveClip('closed', region), dissolveClip('open', region));
    case 'fade':
    case 'random':
    default:
      return { from: { opacity: 0 }, to: { opacity: 1 } };
  }
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

/**
 * 棋盘中点只放开偶数格。结束帧仍铺满，否则入场停住时一半形状留在中线上。
 * 退场把两端对调，中点仍放在中间。
 */
export function revealSequence(step: AnimStep, region: ClipRegion = FULL_REGION, aspect = 1): Keyframe[] {
  if (step.effect === 'wheel') {
    const clips = wheelSequence(step.dir, region, aspect);
    const ordered = step.kind === 'exit' ? [...clips].reverse() : clips;
    return ordered.map((clipPath, index) => ({
      opacity: 1,
      clipPath,
      offset: index / (ordered.length - 1),
    }));
  }
  const entrance = entranceFrames(step, region, aspect);
  const ordered = step.kind === 'exit' ? [entrance.to, entrance.from] : [entrance.from, entrance.to];
  if (step.effect !== 'checker' && step.effect !== 'dissolve') return ordered;
  const middle = step.effect === 'checker'
    ? checkerClip(step.dir, 'half', region, aspect)
    : dissolveClip('half', region);
  return [
    { ...ordered[0], offset: 0 },
    { opacity: 1, clipPath: middle, offset: 0.5 },
    { ...ordered[1], offset: 1 },
  ];
}

export function framesFor(step: AnimStep): Keyframes {
  if (step.kind === 'emphasis') return emphasisFrames(step);
  if (step.kind === 'motion') return { from: { opacity: 1 }, to: { opacity: 1 } };
  const sequence = revealSequence(step);
  const from = { ...sequence[0] };
  const to = { ...sequence[sequence.length - 1] };
  delete from.offset;
  delete to.offset;
  return { from, to };
}
