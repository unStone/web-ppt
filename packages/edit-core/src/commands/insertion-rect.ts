import { assertDataObject } from '../data-validation';

export interface InsertionRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const EMU_PER_PX = 9525;
// ECMA-376 的 long 范围更宽，但 PowerPoint 实际只接受 32 位 signed/positive coordinate。
const MIN_COORDINATE_EMU = -2147483648;
const MAX_COORDINATE_EMU = 2147483647;

export const pxToEmu = (value: number): number => Math.round(value * EMU_PER_PX);

const isCoordinate = (value: number): boolean => {
  const emu = pxToEmu(value);
  return Number.isSafeInteger(emu) && emu >= MIN_COORDINATE_EMU && emu <= MAX_COORDINATE_EMU;
};

const isPositiveCoordinate = (value: number): boolean => {
  const emu = pxToEmu(value);
  return Number.isSafeInteger(emu) && emu > 0 && emu <= MAX_COORDINATE_EMU;
};

const isNonNegativeCoordinate = (value: number): boolean => {
  const emu = pxToEmu(value);
  return Number.isSafeInteger(emu) && emu >= 0 && emu <= MAX_COORDINATE_EMU;
};

export function assertInsertionRect(value: unknown, label: string): asserts value is InsertionRect {
  assertDataObject(value, ['x', 'y', 'w', 'h'], label);
  const rect = value as InsertionRect;
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)
    || !isCoordinate(rect.x) || !isCoordinate(rect.y)
    || !Number.isFinite(rect.w) || rect.w <= 0 || !isPositiveCoordinate(rect.w)
    || !Number.isFinite(rect.h) || rect.h <= 0 || !isPositiveCoordinate(rect.h)) {
    throw new Error(`${label} 必须是 PowerPoint 可表示的有限坐标与有限正尺寸`);
  }
}

/** OOXML 允许线条的单轴尺寸为零；已有元素 frame 的约束不同于新增实体的正尺寸。 */
export function assertFrameRect(value: unknown, label: string): asserts value is InsertionRect {
  assertDataObject(value, ['x', 'y', 'w', 'h'], label);
  const rect = value as InsertionRect;
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)
    || !isCoordinate(rect.x) || !isCoordinate(rect.y)
    || !Number.isFinite(rect.w) || !isNonNegativeCoordinate(rect.w)
    || !Number.isFinite(rect.h) || !isNonNegativeCoordinate(rect.h)) {
    throw new Error(`${label} 必须是 PowerPoint 可表示的有限坐标与有限非负尺寸`);
  }
}
