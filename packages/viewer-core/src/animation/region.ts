/** 相对元素边框的百分比窗口。整框是 0,0,100,100。 */

export interface ClipRegion {
  l: number;
  t: number;
  w: number;
  h: number;
}

export const FULL_REGION: ClipRegion = { l: 0, t: 0, w: 100, h: 100 };

/** 三位小数，避免关键帧在 16.666 和 16.667 之间来回跳。 */
export function percent(value: number): string {
  return `${Math.round(value * 1000) / 1000}%`;
}

export function isFull(region: ClipRegion): boolean {
  return region.l === 0 && region.t === 0 && region.w === 100 && region.h === 100;
}
