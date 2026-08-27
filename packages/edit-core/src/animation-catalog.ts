import type { AnimEffect } from '@web-ppt/core';

export type EditableVisualAnimationKind = 'entrance' | 'exit' | 'emphasis';

interface AnimationEffectSpec {
  readonly kinds: readonly EditableVisualAnimationKind[];
  readonly directions: readonly string[];
  readonly defaultDirection?: string;
  /** PowerPoint MsoAnimEffect；只收录有规范编码和实际保存证据的效果。 */
  readonly preset: number;
  readonly filter?: string | Readonly<Record<string, string>>;
}

const ENTRANCE_EXIT = Object.freeze(['entrance', 'exit'] as const);
const EMPHASIS = Object.freeze(['emphasis'] as const);
const NONE = Object.freeze([] as const);

/** 编辑目录宁可小而可信；来源中的其他效果仍由 core 播放并原样直通。 */
export const ANIMATION_EFFECTS = Object.freeze([
  'appear', 'fade', 'fly', 'wipe', 'zoom', 'dissolve', 'spin', 'grow',
] as const satisfies readonly AnimEffect[]);

type EditableAnimationEffect = typeof ANIMATION_EFFECTS[number];

const EFFECTS: Readonly<Record<EditableAnimationEffect, AnimationEffectSpec>> = Object.freeze({
  appear: { kinds: ENTRANCE_EXIT, directions: NONE, preset: 1 },
  fade: { kinds: ENTRANCE_EXIT, directions: NONE, preset: 10, filter: 'fade' },
  fly: {
    kinds: ENTRANCE_EXIT,
    directions: Object.freeze(['l', 'r', 'u', 'd']),
    defaultDirection: 'd',
    preset: 2,
    filter: Object.freeze({
      l: 'slide(fromLeft)', r: 'slide(fromRight)',
      u: 'slide(fromTop)', d: 'slide(fromBottom)',
    }),
  },
  wipe: {
    kinds: ENTRANCE_EXIT,
    directions: Object.freeze(['l', 'r', 'u', 'd']),
    defaultDirection: 'd',
    preset: 22,
    // filter 描述推进方向，公开 dir 描述内容出现的来源方向，两者相反。
    filter: Object.freeze({ l: 'wipe(right)', r: 'wipe(left)', u: 'wipe(down)', d: 'wipe(up)' }),
  },
  zoom: {
    kinds: ENTRANCE_EXIT,
    directions: Object.freeze(['in', 'out']),
    defaultDirection: 'in',
    preset: 23,
    filter: Object.freeze({ in: 'box(in)', out: 'box(out)' }),
  },
  dissolve: { kinds: ENTRANCE_EXIT, directions: NONE, preset: 9, filter: 'dissolve' },
  spin: { kinds: EMPHASIS, directions: NONE, preset: 61 },
  grow: { kinds: EMPHASIS, directions: NONE, preset: 59 },
});

export function animationEffectSpec(effect: AnimEffect): AnimationEffectSpec {
  const spec = EFFECTS[effect as EditableAnimationEffect];
  if (!spec) throw new Error(`未知或不可安全保存的元素动画效果：${String(effect)}`);
  return spec;
}

export function animationEffectsForKind(
  kind: EditableVisualAnimationKind,
): readonly AnimEffect[] {
  return ANIMATION_EFFECTS.filter((effect) => EFFECTS[effect].kinds.includes(kind));
}

export function animationDirections(effect: AnimEffect): readonly string[] {
  return animationEffectSpec(effect).directions;
}

export function animationDefaultDirection(effect: AnimEffect): string | undefined {
  return animationEffectSpec(effect).defaultDirection;
}

export function animationFilter(effect: AnimEffect, dir: string | undefined): string | undefined {
  const filter = animationEffectSpec(effect).filter;
  if (!filter || typeof filter === 'string') return filter;
  const direction = dir ?? animationEffectSpec(effect).defaultDirection;
  return direction ? filter[direction] : undefined;
}
