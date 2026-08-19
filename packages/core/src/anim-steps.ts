import type { AnimStep } from './types';

/**
 * 动画步骤的分组与可见性推导。
 *
 * 放在 core 而不是播放层：这两个函数是纯粹对 `AnimStep[]` 的推导，不碰 DOM 也不碰时间轴，
 * 导出可打印 HTML 时同样要用它们把一页展开成多页。播放层继续原样再导出一份。
 */

/** 按点击批次分组：同一批（clickGroup）的动画一次点击一起播 */
export function groupSteps(steps: AnimStep[] | undefined): AnimStep[][] {
  if (!steps?.length) return [];
  const groups: AnimStep[][] = [];
  for (const s of steps) {
    const g = s.clickGroup ?? 0;
    (groups[g] ??= []).push(s);
  }
  return groups.filter(Boolean);
}

/** 第 upTo 批动画开始前，哪些元素应处于隐藏状态 */
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
