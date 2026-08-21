import type { AnimStep, Slide, SlideElement } from './types';

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

/**
 * 静态渲染（不播动画）时该隐藏哪些元素。
 *
 * 取动画**终态**而非「全部可见」：一页里入场与退场的元素属于不同时刻，
 * 全画出来等于把几帧叠在一起。orcid-ooxml-strict 第 7 页就是这样——
 * 三段文字本该逐条替换，叠起来后一个字都读不出。
 *
 * 唯一的例外是收尾页：所有元素都退场时终态是一片空白，那还不如全画出来。
 */
export function staticHidden(slide: Slide): Set<number> {
  const groups = groupSteps(slide.animations);
  if (!groups.length) return new Set();
  const hidden = hiddenBefore(groups, groups.length);
  if (!hidden.size) return hidden;

  const ids: number[] = [];
  const walk = (els: SlideElement[]): void => {
    for (const el of els) {
      if (el.id !== undefined) ids.push(el.id);
      if (el.kind === 'group') walk(el.children);
    }
  };
  walk(slide.elements);
  // 有 id 的元素全被藏光 → 终态是空页，退回全部可见
  return ids.length && ids.every((id) => hidden.has(id)) ? new Set() : hidden;
}
