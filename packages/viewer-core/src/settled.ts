import type { AnimStep } from '@web-ppt/core';
import { framesFor } from './playback';

const SKIPPED_KEYFRAME_FIELD = new Set(['offset', 'easing', 'composite']);

/**
 * 一批点击结束时，元素上该留下的内联样式。
 *
 * 不倒放关键帧：播放层没有可逆时间轴，withPrev 和路径倒着播会对不齐。
 * 入场的结束帧就是 SVG 本来的样子，退场靠隐藏集，所以这两类不写样式。
 * 强调停在 fill 的结束帧上；路径停在采样折线的最后一点上。
 */
export function settledDeclaration(step: AnimStep): Record<string, string> | null {
  if (step.kind === 'entrance' || step.kind === 'exit') return null;
  if (step.kind === 'motion') {
    const path = step.motionPath;
    if (!path?.length) return null;
    const [x, y] = path[path.length - 1];
    return { transform: `translate(${x}px, ${y}px)` };
  }
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(framesFor(step).to)) {
    if (SKIPPED_KEYFRAME_FIELD.has(key) || value == null || typeof value === 'object') continue;
    style[key] = String(value);
  }
  return Object.keys(style).length ? style : null;
}
