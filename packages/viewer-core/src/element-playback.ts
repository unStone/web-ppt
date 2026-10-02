import type { AnimStep } from '@web-ppt/core';
import {
  blindsClip, boxInMask, boxOutClip, checkerboardClip, dissolveClip,
  irisClip, randomBarsClip, splitClip, stripsClip, wheelClip, type ClipRegion,
} from './reveal-clip';

/**
 * 元素动画播放层。全部走 Web Animations API，
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

function offSlideTransform(container: Element, node: Element, dir: string | undefined): string | null {
  const svg = container.querySelector('svg');
  if (!svg || typeof svg.getBoundingClientRect !== 'function'
    || typeof node.getBoundingClientRect !== 'function') return null;
  const slide = svg.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  if (slide.width < 1 || slide.height < 1 || box.width < 1 || box.height < 1) return null;
  const left = ((slide.left - box.right - 4) / box.width) * 100;
  const right = ((slide.right - box.left + 4) / box.width) * 100;
  const up = ((slide.top - box.bottom - 4) / box.height) * 100;
  const down = ((slide.bottom - box.top + 4) / box.height) * 100;
  const x = dir?.includes('l') ? left : dir?.includes('r') ? right : 0;
  const y = dir?.includes('u') ? up : dir?.includes('d') || !dir ? down : 0;
  return `translate(${x}%, ${y}%)`;
}

function scaleTransform(x: number, y: number): string {
  return x === y ? `scale(${x})` : `scale(${x}, ${y})`;
}

/**
 * foreignObject 里的 HTML 不吃祖先 `<g>` 的 clip-path / mask。
 * 文本要单独裁。HTML 百分比相对自身边框，fill-box 会让声明失效。
 */
const MASK_KEYS = ['maskImage', 'maskRepeat', 'maskPosition', 'maskSize'] as const;

/**
 * 段落 div 是整列排版框。短句居中时，盒状若相对这个框，上下两条通栏会先切开字形，
 * 左右边落在字外。PowerPoint 围的是这段字的墨迹框。量不到时退回元素自身。
 */
function elementContentRegion(host: HTMLElement): ClipRegion | null {
  const box = host.getBoundingClientRect?.();
  const createRange = host.ownerDocument?.createRange;
  if (!box || box.width < 1 || box.height < 1 || typeof createRange !== 'function') return null;
  const range = createRange.call(host.ownerDocument);
  range.selectNodeContents(host);
  const ink = range.getBoundingClientRect();
  if (ink.width < 1 || ink.height < 1) return null;
  const left = Math.min(100, Math.max(0, ((ink.left - box.left) / box.width) * 100));
  const top = Math.min(100, Math.max(0, ((ink.top - box.top) / box.height) * 100));
  const right = Math.min(100, Math.max(left, ((ink.right - box.left) / box.width) * 100));
  const bottom = Math.min(100, Math.max(top, ((ink.bottom - box.top) / box.height) * 100));
  const w = right - left;
  const h = bottom - top;
  if (w < 1 || h < 1) return null;
  return { l: left, t: top, w, h };
}

function paragraphElements(node: Element, range: AnimStep['paragraphRange']): Element[] {
  if (!range || typeof node.querySelectorAll !== 'function') return [];
  const marked: Element[] = [];
  for (const el of node.querySelectorAll('[data-p]')) {
    const index = Number(el.getAttribute('data-p'));
    if (Number.isInteger(index) && index >= range.start && index <= range.end) marked.push(el);
  }
  // 编辑器会写 data-p。查看器为了不把编辑标记带进播放 SVG，段落只是文本根节点的直接子 div。
  if (marked.length) return marked;
  const found: Element[] = [];
  for (const root of node.querySelectorAll('foreignObject > :first-child')) {
    const children = [...root.children].filter((el) => el.localName === 'div');
    for (let index = range.start; index <= range.end && index < children.length; index++) {
      found.push(children[index]);
    }
  }
  return found;
}

function paragraphClipFrames(
  step: AnimStep, host: HTMLElement, shapeFrames: readonly Keyframe[],
): Keyframe[] | null {
  if (step.kind !== 'emphasis' && step.kind !== 'motion'
    && step.effect === 'zoom' && (step.dir === 'in' || step.dir === 'out')) {
    const region = elementContentRegion(host);
    if (region) {
      const entrance = step.dir === 'in'
        ? {
            from: boxInMask(false, region),
            to: boxInMask(true, region),
          }
        : {
            from: { opacity: 1, clipPath: boxOutClip(false, region) },
            to: { opacity: 1, clipPath: boxOutClip(true, region) },
          };
      const pair = step.kind === 'exit' ? [entrance.to, entrance.from] : [entrance.from, entrance.to];
      return htmlClipFrames(pair);
    }
  }
  return htmlClipFrames(shapeFrames);
}

function htmlClipFrames(frames: readonly Keyframe[]): Keyframe[] | null {
  const visual = (frame: Keyframe) => frame.clipPath !== undefined || frame.maskSize !== undefined;
  if (!frames.some(visual)) return null;
  return frames.map((frame) => {
    const next: Keyframe = {};
    if (frame.clipPath !== undefined) next.clipPath = String(frame.clipPath).replace(/ fill-box/g, '');
    // HTML 不认 fill-box。蒙版百分比相对元素边框，和形状的 fill-box 是同一块区域。
    for (const key of MASK_KEYS) if (frame[key] !== undefined) next[key] = frame[key];
    if (frame.maskSize !== undefined) {
      next.maskOrigin = 'border-box';
      next.maskClip = 'border-box';
    }
    if (frame.offset !== undefined) next.offset = frame.offset;
    return next;
  });
}

export function wipeClip(dir: string | undefined, hidden: boolean): string {
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
      // in/out 来自 filter box(in)/box(out)。盒状是矩形揭开，字形保持原大。
      if (step.dir === 'in') return { from: boxInMask(false), to: boxInMask(true) };
      if (step.dir === 'out') {
        return {
          from: { opacity: 1, clipPath: boxOutClip(false) },
          to: { opacity: 1, clipPath: boxOutClip(true) },
        };
      }
      return {
        from: { opacity: 0, transform: scaleTransform(step.scale?.fromX ?? 0, step.scale?.fromY ?? 0) },
        to: { opacity: 1, transform: scaleTransform(step.scale?.toX ?? 1, step.scale?.toY ?? 1) },
      };
    case 'grow':
      return {
        from: { opacity: 1, transform: `${scaleTransform(step.scale?.fromX ?? 0, step.scale?.fromY ?? 0)} rotate(${step.rotation?.from ?? 0}deg)` },
        to: { opacity: 1, transform: `${scaleTransform(step.scale?.toX ?? 1, step.scale?.toY ?? 1)} rotate(${step.rotation?.to ?? 90}deg)` },
      };
    case 'spin':
      return { from: { opacity: 0, transform: 'rotate(-180deg) scale(0.4)' }, to: { opacity: 1, transform: 'rotate(0) scale(1)' } };
    case 'swivel':
      return { from: { opacity: 0, transform: 'rotateY(90deg)' }, to: { opacity: 1, transform: 'rotateY(0)' } };
    case 'float':
      return { from: { opacity: 0, transform: 'translateY(30%)' }, to: { opacity: 1, transform: 'translateY(0)' } };
    case 'bounce':
      return { from: { opacity: 0, transform: 'translateY(-60%)' }, to: { opacity: 1, transform: 'translateY(0)' } };
    case 'stretch':
      return {
        from: { opacity: 0, transform: step.scale
          ? scaleTransform(step.scale.fromX, step.scale.fromY)
          : step.dir === 'vert' ? 'scaleY(0.2)' : 'scaleX(0.2)' },
        to: { opacity: 1, transform: step.scale
          ? scaleTransform(step.scale.toX, step.scale.toY) : 'scale(1)' },
      };
    case 'blinds':
      return {
        from: blindsClip(step.dir, false),
        to: blindsClip(step.dir, true),
      };
    case 'checkerboard':
      return {
        from: checkerboardClip(step.dir, false),
        to: checkerboardClip(step.dir, true),
      };
    case 'randomBar':
      return {
        from: randomBarsClip(step.dir, false),
        to: randomBarsClip(step.dir, true),
      };
    case 'strips':
      return {
        from: stripsClip(step.dir, false),
        to: stripsClip(step.dir, true),
      };
    case 'circle':
    case 'diamond':
    case 'plus':
      return {
        from: irisClip(step.effect, step.dir, false),
        to: irisClip(step.effect, step.dir, true),
      };
    case 'wipe':
      return {
        from: { opacity: 1, clipPath: wipeClip(step.dir, true) },
        to: { opacity: 1, clipPath: wipeClip(step.dir, false) },
      };
    case 'split':
      return {
        from: splitClip(step.dir, false),
        to: splitClip(step.dir, true),
      };
    case 'wheel':
      return {
        from: wheelClip(step.dir, false),
        to: wheelClip(step.dir, true),
      };
    case 'dissolve':
      return {
        from: dissolveClip(false, step.target),
        to: dissolveClip(true, step.target),
      };
    case 'random':
      return entranceFrames({ ...step, effect: (['fly', 'wipe', 'zoom'] as const)[step.target % 3], dir: 'd' });
    case 'fade':
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
      return {
        from: { transform: scaleTransform(step.scale?.fromX ?? 1, step.scale?.fromY ?? 1) },
        to: { transform: scaleTransform(step.scale?.toX ?? 1.25, step.scale?.toY ?? 1.25) },
      };
    default:
      return { from: { opacity: 1 }, to: { opacity: 0.5 } };
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
  /** 由本句柄创建的动画；宿主需要精确回收时无需扫描整棵 DOM。 */
  readonly animations: readonly Animation[];
  cancel(): void;
  finished: Promise<void>;
}

/** 播放一批动画；返回可取消的句柄 */
export function playGroup(container: Element, group: AnimStep[]): PlayHandle {
  const anims: Animation[] = [];
  const exits: HTMLElement[] = [];
  let cancelled = false;
  let previousStart = 0;
  let previousEnd = 0;

  for (const step of group) {
    const start = step.trigger === 'afterPrev'
      ? previousEnd + step.delayMs
      : step.trigger === 'withPrev' ? previousStart + step.delayMs : step.delayMs;
    previousStart = start;
    previousEnd = start + step.durationMs;
    const node = container.querySelector(`[data-el="${step.target}"]`) as HTMLElement | null;
    if (!node) continue;
    if (step.kind === 'exit') exits.push(node);

    const { from, to } = framesFor(step);
    node.style.visibility = 'visible';
    if (step.kind === 'entrance') node.style.opacity = '';
    if (step.effect === 'fly' && (step.kind === 'entrance' || step.kind === 'exit')) {
      const transform = offSlideTransform(container, node, step.dir);
      if (transform) {
        if (step.kind === 'entrance') from.transform = transform;
        else to.transform = transform;
      }
    }

    // 顶点必须原样保留；累计弧长映射到 offset 才能同时得到匀速与尖角不变。
    // 不用 offset-path，因为它在 <img> SVG 与 foreignObject 里支持不一致。
    const distances = step.motionPath?.reduce<number[]>((values, [x, y], index, points) => {
      if (index === 0) values.push(0);
      else values.push(values[index - 1] + Math.hypot(x - points[index - 1][0], y - points[index - 1][1]));
      return values;
    }, []);
    const distance = distances?.[distances.length - 1] ?? 0;
    const frames: Keyframe[] = step.motionPath?.length
      ? step.motionPath.map(([dx, dy], index) => ({
        transform: `translate(${dx}px, ${dy}px)`,
        offset: distance > 0 ? distances![index] / distance : index / (step.motionPath!.length - 1),
      }))
      : step.effect === 'randomBar'
        ? Array.from({ length: 13 }, (_, index) => ({
          ...randomBarsClip(step.dir, step.kind === 'exit' ? 1 - index / 12 : index / 12),
          offset: index / 12,
        }))
        : step.effect === 'strips'
          ? Array.from({ length: 21 }, (_, index) => ({
            ...stripsClip(step.dir, step.kind === 'exit' ? 1 - index / 20 : index / 20),
            offset: index / 20,
          }))
          : step.effect === 'wheel'
            ? Array.from({ length: 73 }, (_, index) => ({
              ...wheelClip(step.dir, step.kind === 'exit' ? 1 - index / 72 : index / 72),
              offset: index / 72,
            }))
          : (step.effect === 'circle' || step.effect === 'diamond'
            || step.effect === 'plus' && step.dir !== 'in')
            ? Array.from({ length: 37 }, (_, index) => ({
              ...irisClip(step.effect as 'circle' | 'diamond' | 'plus', step.dir,
                step.kind === 'exit' ? 1 - index / 36 : index / 36),
              offset: index / 36,
            }))
        : step.effect === 'dissolve'
          ? Array.from({ length: 9 }, (_, index) => ({
            ...dissolveClip(step.kind === 'exit' ? 1 - index / 8 : index / 8, step.target),
            offset: index / 8,
          }))
        : step.effect === 'bounce' && step.kind === 'entrance'
          ? [
            { opacity: 0, transform: 'translateY(-60%)', offset: 0 },
            { opacity: 1, transform: 'translateY(10%)', offset: 0.5 },
            { opacity: 1, transform: 'translateY(-8%)', offset: 0.7 },
            { opacity: 1, transform: 'translateY(3%)', offset: 0.85 },
            { opacity: 1, transform: 'translateY(0)', offset: 1 },
          ]
      : [from, to];

    try {
      const easing = step.motionPath?.length || step.effect === 'randomBar'
        || step.effect === 'strips' || step.effect === 'wheel'
        || step.effect === 'circle' || step.effect === 'diamond' || step.effect === 'plus'
        || step.effect === 'dissolve' || step.effect === 'bounce' ? 'linear'
        : step.effect === 'appear' && step.kind === 'entrance' ? 'steps(1, start)'
          : step.effect === 'appear' && step.kind === 'exit' ? 'steps(1, end)'
            : 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      const anim = node.animate(frames, {
        duration: step.durationMs,
        delay: start,
        // 路径动画在 PowerPoint 里是匀速，不能套入场用的缓动
        easing,
        fill: 'both',
      });
      if (step.kind === 'exit') {
        anim.finished.then(() => {
          if (!cancelled) node.style.visibility = 'hidden';
        }).catch(() => undefined);
      }
      anims.push(anim);
      const textFrames = htmlClipFrames(frames);
      if (!textFrames || typeof node.querySelectorAll !== 'function') continue;
      const paragraphs = paragraphElements(node, step.paragraphRange);
      const hosts = paragraphs.length
        ? paragraphs
        : node.querySelectorAll('foreignObject > :first-child');
      for (const host of hosts) {
        if (!(host instanceof HTMLElement)) continue;
        const local = paragraphs.length ? paragraphClipFrames(step, host, frames) : textFrames;
        if (!local) continue;
        anims.push(host.animate(local, {
          duration: step.durationMs,
          delay: start,
          easing,
          fill: 'both',
        }));
      }
    } catch {
      // 浏览器不支持某个属性时直接落到终态
      Object.assign(node.style, (frames[frames.length - 1] ?? to) as Record<string, string>);
      if (step.kind === 'exit') node.style.visibility = 'hidden';
    }
  }

  return {
    animations: anims,
    cancel: () => {
      cancelled = true;
      anims.forEach((a) => { try { a.finish(); } catch { /* 已结束 */ } });
      for (const node of exits) node.style.visibility = 'hidden';
    },
    finished: Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => undefined),
  };
}
