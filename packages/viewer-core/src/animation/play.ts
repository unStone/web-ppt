import type { AnimStep } from '@web-ppt/core';
import { inwardGroupMask } from './clips';
import { framesFor, revealSequence } from './frames';
import type { ClipRegion } from './region';

const MASK_KEYS = ['maskImage', 'maskRepeat', 'maskPosition', 'maskSize', 'maskComposite'] as const;

/**
 * 段落 div 是整列排版框。短句居中时，揭开若相对这个框，条带会先切开字形两侧的空白。
 * 量到墨迹就用墨迹框。量不到时退回元素自身。
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

/**
 * foreignObject 里的 HTML 不吃祖先 `<g>` 的 clip-path / mask。
 * 文本要单独裁。HTML 百分比相对自身边框，fill-box 会让声明失效。
 */
function htmlClipFrames(frames: readonly Keyframe[]): Keyframe[] | null {
  const visual = (frame: Keyframe) => frame.clipPath !== undefined || frame.maskSize !== undefined;
  if (!frames.some(visual)) return null;
  return frames.map((frame) => {
    const next: Keyframe = {};
    if (frame.clipPath !== undefined) next.clipPath = String(frame.clipPath).replace(/ fill-box/g, '');
    for (const key of MASK_KEYS) if (frame[key] !== undefined) next[key] = frame[key];
    if (frame.maskSize !== undefined) {
      next.maskOrigin = 'border-box';
      next.maskClip = 'border-box';
    }
    if (frame.offset !== undefined) next.offset = frame.offset;
    return next;
  });
}

export interface PlayHandle {
  /** 由本句柄创建的动画；宿主需要精确回收时无需扫描整棵 DOM。 */
  readonly animations: readonly Animation[];
  cancel(): void;
  finished: Promise<void>;
}

const IRIS = new Set(['circle', 'diamond', 'plus']);

/**
 * shape() 带 fill-box 挂在形状组上会把整组藏掉。
 * 组上改用整框蒙版减去光圈；文字宿主仍播洞。
 */
function shapeGroupFrames(step: AnimStep, frames: readonly Keyframe[]): Keyframe[] {
  if (!IRIS.has(step.effect) || step.dir === 'out') return [...frames];
  if (!frames.some((frame) => String(frame.clipPath ?? '').startsWith('shape('))) return [...frames];
  const hidden = inwardGroupMask(step.effect, false);
  const shown = inwardGroupMask(step.effect, true);
  return step.kind === 'exit' ? [shown, hidden] : [hidden, shown];
}

/** 播放一批动画；返回可取消的句柄 */
export function playGroup(container: Element, group: AnimStep[]): PlayHandle {
  const anims: Animation[] = [];
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

    const base = framesFor(step);
    node.style.visibility = 'visible';
    if (step.kind === 'entrance') node.style.opacity = '';

    const distances = step.motionPath?.reduce<number[]>((values, [x, y], index, points) => {
      if (index === 0) values.push(0);
      else values.push(values[index - 1] + Math.hypot(x - points[index - 1][0], y - points[index - 1][1]));
      return values;
    }, []);
    const distance = distances?.[distances.length - 1] ?? 0;
    const motion: Keyframe[] | undefined = step.motionPath?.length
      ? step.motionPath.map(([dx, dy], index) => ({
        transform: `translate(${dx}px, ${dy}px)`,
        offset: distance > 0 ? distances![index] / distance : index / (step.motionPath!.length - 1),
      }))
      : undefined;
    const frames = motion ?? (step.kind === 'emphasis' ? [base.from, base.to] : revealSequence(step));

    try {
      const easing = motion ? 'linear'
        : step.effect === 'appear' && step.kind === 'entrance' ? 'steps(1, start)'
          : step.effect === 'appear' && step.kind === 'exit' ? 'steps(1, end)'
            : 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      const anim = node.animate(shapeGroupFrames(step, frames), {
        duration: step.durationMs,
        delay: start,
        easing,
        fill: 'both',
      });
      if (step.kind === 'exit') {
        anim.finished.then(() => { node.style.visibility = 'hidden'; }).catch(() => undefined);
      }
      anims.push(anim);
      const paragraphs = paragraphElements(node, step.paragraphRange);
      const hosts = paragraphs.length
        ? paragraphs
        : typeof node.querySelectorAll === 'function'
          ? [...node.querySelectorAll('foreignObject > :first-child')]
          : [];
      for (const host of hosts) {
        if (!(host instanceof HTMLElement)) continue;
        const local = paragraphs.length
          ? paragraphFrames(step, host, frames)
          : htmlClipFrames(frames);
        if (!local) continue;
        anims.push(host.animate(local, {
          duration: step.durationMs,
          delay: start,
          easing,
          fill: 'both',
        }));
      }
    } catch {
      Object.assign(node.style, (frames[frames.length - 1] ?? base.to) as Record<string, string>);
    }
  }

  return {
    animations: anims,
    cancel: () => anims.forEach((a) => { try { a.finish(); } catch { /* 已结束 */ } }),
    finished: Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => undefined),
  };
}

function paragraphFrames(
  step: AnimStep, host: HTMLElement, shapeFrames: readonly Keyframe[],
): Keyframe[] | null {
  if (step.kind === 'emphasis' || step.kind === 'motion') return htmlClipFrames(shapeFrames);
  const region = elementContentRegion(host);
  if (!region) return htmlClipFrames(shapeFrames);
  return htmlClipFrames(revealSequence(step, region));
}

export { framesFor } from './frames';
