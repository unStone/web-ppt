import type { Adj, GeomSpec } from '../index';
import { guideToken, presetGuideValues } from '../guides';
import { PRESET_HANDLE_DEFINITIONS } from './generated';
import type { RawPresetHandle, RawPresetHandleDefinition } from './generated';

export { PRESET_DEFINITION_NAMES } from './generated';

export interface PresetAdjustmentValue {
  readonly axis: 'x' | 'y' | 'radius' | 'angle';
  readonly name: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

export interface PresetAdjustmentHandle {
  readonly index: number;
  readonly kind: 'xy' | 'polar';
  readonly x: number;
  readonly y: number;
  readonly adjustments: readonly PresetAdjustmentValue[];
}

export interface PresetAdjustmentHit {
  readonly index: number;
  readonly distance: number;
}

export interface PresetAdjustmentPoint { readonly x: number; readonly y: number }

const MIN_ADJUSTMENT = -2147483648;
const MAX_ADJUSTMENT = 2147483647;
const EMU_PER_CSS_PX = 9525;

function assertFrame(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
    throw new Error('预设句柄 frame 必须是非负有限尺寸');
  }
}

function handleValues(
  definition: RawPresetHandleDefinition,
  adjustments: Readonly<Adj>,
  width: number,
  height: number,
): Record<string, number> {
  // a:ahLst 的约束可把百分比调节值与 ssd* 坐标混用；必须按 Office 的 EMU
  // 坐标空间求值，过早换成 px 会把 star24 等形状的上限缩小 9525 倍。
  return presetGuideValues(
    width * EMU_PER_CSS_PX, height * EMU_PER_CSS_PX,
    definition[0], definition[1], adjustments,
  );
}

function constraint(
  raw: RawPresetHandle,
  values: Readonly<Record<string, number>>,
  first: boolean,
): PresetAdjustmentValue | null {
  const offset = first ? 1 : 4;
  const name = raw[offset];
  if (!name) return null;
  const rawMin = raw[offset + 1];
  const rawMax = raw[offset + 2];
  const firstAxis = raw[0] === 'xy' ? 'x' : 'radius';
  const secondAxis = raw[0] === 'xy' ? 'y' : 'angle';
  let min = rawMin === null ? MIN_ADJUSTMENT : guideToken(rawMin, values);
  let max = rawMax === null ? MAX_ADJUSTMENT : guideToken(rawMax, values);
  if (min > max) [min, max] = [max, min];
  const current = Math.min(max, Math.max(min, values[name] ?? 0));
  return {
    axis: first ? firstAxis : secondAxis,
    name, value: current,
    min: Number.isFinite(min) ? min : MIN_ADJUSTMENT,
    max: Number.isFinite(max) ? max : MAX_ADJUSTMENT,
  };
}

function resolveHandle(
  raw: RawPresetHandle,
  definition: RawPresetHandleDefinition,
  adjustments: Readonly<Adj>,
  width: number,
  height: number,
  index: number,
): PresetAdjustmentHandle {
  const values = handleValues(definition, adjustments, width, height);
  const first = constraint(raw, values, true);
  const second = constraint(raw, values, false);
  return {
    index, kind: raw[0],
    x: guideToken(raw[7], values) / EMU_PER_CSS_PX,
    y: guideToken(raw[8], values) / EMU_PER_CSS_PX,
    adjustments: [first, second].filter((value): value is PresetAdjustmentValue => !!value),
  };
}

export function resolvePresetAdjustmentHandles(
  geometry: GeomSpec,
  width: number,
  height: number,
): readonly PresetAdjustmentHandle[] {
  assertFrame(width, height);
  const definition = PRESET_HANDLE_DEFINITIONS[geometry.preset];
  if (!definition) return [];
  return definition[2].map((raw, index) =>
    resolveHandle(raw, definition, geometry.adj, width, height, index));
}

export function clampPresetAdjustment(
  geometry: GeomSpec,
  width: number,
  height: number,
  name: string,
  value: number,
): number {
  if (typeof name !== 'string' || !name || !Number.isFinite(value)) {
    throw new Error('预设调节值名称和值无效');
  }
  const matches = resolvePresetAdjustmentHandles(geometry, width, height)
    .flatMap((handle) => handle.adjustments)
    .filter((adjustment) => adjustment.name === name);
  if (!matches.length) throw new Error(`预设 ${geometry.preset} 没有可拖动调节值 ${name}`);
  const min = Math.max(...matches.map((adjustment) => adjustment.min));
  const max = Math.min(...matches.map((adjustment) => adjustment.max));
  if (min > max) throw new Error(`预设 ${geometry.preset} 的调节约束互相冲突：${name}`);
  return Math.round(Math.min(max, Math.max(min, value)));
}

function distanceSquared(left: PresetAdjustmentPoint, right: PresetAdjustmentPoint): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function bestAdjustment(
  geometry: GeomSpec,
  definition: RawPresetHandleDefinition,
  raw: RawPresetHandle,
  index: number,
  adjustment: PresetAdjustmentValue,
  width: number,
  height: number,
  target: PresetAdjustmentPoint,
): number {
  if (adjustment.min === adjustment.max) return adjustment.min;
  const score = (candidate: number): number => {
    const adj = { ...geometry.adj, [adjustment.name]: candidate };
    return distanceSquared(resolveHandle(raw, definition, adj, width, height, index), target);
  };
  const samples = 72;
  const step = (adjustment.max - adjustment.min) / samples;
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample <= samples; sample++) {
    const value = adjustment.min + step * sample;
    const valueScore = score(value);
    if (valueScore < bestScore) [best, bestScore] = [sample, valueScore];
  }
  let low = adjustment.min + step * Math.max(0, best - 1);
  let high = adjustment.min + step * Math.min(samples, best + 1);
  for (let iteration = 0; iteration < 36; iteration++) {
    const left = low + (high - low) / 3;
    const right = high - (high - low) / 3;
    if (score(left) <= score(right)) high = right;
    else low = left;
  }
  return Math.min(adjustment.max, Math.max(adjustment.min, Math.round((low + high) / 2)));
}

export function dragPresetAdjustmentHandle(
  geometry: GeomSpec,
  width: number,
  height: number,
  handleIndex: number,
  target: PresetAdjustmentPoint,
): GeomSpec {
  assertFrame(width, height);
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    throw new Error('预设句柄目标必须是有限坐标');
  }
  const definition = PRESET_HANDLE_DEFINITIONS[geometry.preset];
  const raw = definition?.[2][handleIndex];
  if (!definition || !raw) throw new Error(`预设 ${geometry.preset} 不存在第 ${handleIndex} 个调节柄`);
  let result: GeomSpec = { preset: geometry.preset, adj: { ...geometry.adj } };
  for (let pass = 0; pass < 3; pass++) {
    const handle = resolveHandle(raw, definition, result.adj, width, height, handleIndex);
    for (const adjustment of handle.adjustments) {
      const value = bestAdjustment(
        result, definition, raw, handleIndex, adjustment, width, height, target,
      );
      result = { ...result, adj: { ...result.adj, [adjustment.name]: value } };
    }
  }
  return result;
}

export function hitTestPresetAdjustmentHandles(
  handles: readonly PresetAdjustmentHandle[],
  point: PresetAdjustmentPoint,
  tolerance: number,
): PresetAdjustmentHit | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
    || !Number.isFinite(tolerance) || tolerance < 0) throw new Error('句柄命中参数无效');
  let hit: PresetAdjustmentHit | null = null;
  for (const handle of handles) {
    const distance = Math.sqrt(distanceSquared(handle, point));
    if (distance <= tolerance && (!hit || distance < hit.distance)) hit = { index: handle.index, distance };
  }
  return hit;
}
