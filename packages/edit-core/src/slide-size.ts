import type { EditDoc, SlideSizeState } from './types';

/** ST_SlideSizeCoordinate 的闭区间换算为 CSS px；写回前仍会取整到 EMU。 */
export const MIN_SLIDE_SIZE = 96;
export const MAX_SLIDE_SIZE = 5_376;

export function assertSlideSize(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value < MIN_SLIDE_SIZE || value > MAX_SLIDE_SIZE) {
    throw new Error(`${label} 必须是 ${MIN_SLIDE_SIZE}–${MAX_SLIDE_SIZE} 之间的有限数`);
  }
}

export function querySlideSize(doc: EditDoc): SlideSizeState {
  return {
    w: doc.meta.width,
    h: doc.meta.height,
    sourceW: doc.meta.sourceWidth,
    sourceH: doc.meta.sourceHeight,
    direct: doc.meta.width !== doc.meta.sourceWidth || doc.meta.height !== doc.meta.sourceHeight,
  };
}
