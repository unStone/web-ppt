import type { TransitionType } from './types';

/**
 * OOXML 省略方向时的有效值。
 *
 * 把默认值放在统一 Schema 层，解析、编辑与播放才能看到同一种语义；
 * 否则同一份文件会出现“读取是空、预览向下、保存又采用另一默认值”的漂移。
 */
const DEFAULT_DIRECTIONS: Readonly<Partial<Record<TransitionType, string>>> = Object.freeze({
  push: 'l', pull: 'l', cover: 'l', wipe: 'l', split: 'horz-out', zoom: 'out',
  checker: 'horz', blinds: 'horz', comb: 'horz', randomBar: 'horz', strips: 'lu',
  vortex: 'l', ripple: 'center', glitter: 'l', warp: 'out', flythrough: 'in',
  shred: 'in', reveal: 'l', pan: 'l', doors: 'horz', window: 'horz', prism: 'l',
});

const PREFERRED_DIRECTIONS: Readonly<Partial<Record<TransitionType, string>>> = Object.freeze({
  ...DEFAULT_DIRECTIONS,
  switch: 'l', flip: 'l', ferris: 'l', gallery: 'l',
  conveyor: 'l',
});

export function transitionDefaultDirection(type: TransitionType): string | undefined {
  return DEFAULT_DIRECTIONS[type];
}

/** 新建/预览值的稳定首选项；不代表 OOXML 对可选属性声明了默认值。 */
export function transitionPreferredDirection(type: TransitionType): string | undefined {
  return PREFERRED_DIRECTIONS[type];
}
