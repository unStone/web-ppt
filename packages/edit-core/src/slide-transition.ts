import { transitionPreferredDirection, type Transition, type TransitionType } from '@web-ppt/core';
import { assertDataObject, own } from './data-validation';
import type { EditDoc, SlideId, SlideRecord, SlideTransitionState } from './types';

/** 顺序是公开契约；宿主可以稳定地分组或持久化最近使用项。 */
export const SLIDE_TRANSITION_TYPES = Object.freeze([
  'none', 'fade', 'cut', 'push', 'pull', 'cover', 'wipe', 'split', 'zoom', 'dissolve',
  'checker', 'blinds', 'comb', 'wheel', 'circle', 'diamond', 'plus', 'wedge', 'newsflash',
  'randomBar', 'strips', 'vortex', 'switch', 'flip', 'ripple', 'honeycomb', 'glitter',
  'warp', 'flythrough', 'flash', 'shred', 'reveal', 'wheelReverse', 'ferris', 'gallery',
  'conveyor', 'pan', 'doors', 'window', 'prism', 'morph',
] as const satisfies readonly TransitionType[]);

const TYPE_SET = new Set<string>(SLIDE_TRANSITION_TYPES);
const SIDE = Object.freeze(['l', 'r', 'u', 'd'] as const);
const EIGHT = Object.freeze(['l', 'r', 'u', 'd', 'lu', 'ld', 'ru', 'rd'] as const);
const HORIZONTAL = Object.freeze(['l', 'r'] as const);
const AXIS = Object.freeze(['horz', 'vert'] as const);
const IN_OUT = Object.freeze(['in', 'out'] as const);
const SPLIT = Object.freeze(['horz-in', 'horz-out', 'vert-in', 'vert-out'] as const);
const DIAGONAL = Object.freeze(['lu', 'ld', 'ru', 'rd'] as const);
const CORNER_CENTER = Object.freeze(['lu', 'ld', 'ru', 'rd', 'center'] as const);
const NONE = Object.freeze([] as const);

const DIRECTIONS: Readonly<Partial<Record<TransitionType, readonly string[]>>> = Object.freeze({
  push: SIDE, wipe: SIDE, vortex: SIDE, glitter: SIDE, pan: SIDE, prism: SIDE,
  pull: EIGHT, cover: EIGHT,
  switch: HORIZONTAL, flip: HORIZONTAL, ferris: HORIZONTAL,
  gallery: HORIZONTAL, conveyor: HORIZONTAL, reveal: HORIZONTAL,
  checker: AXIS, blinds: AXIS, comb: AXIS, randomBar: AXIS, doors: AXIS, window: AXIS,
  zoom: IN_OUT, warp: IN_OUT, flythrough: IN_OUT, shred: IN_OUT,
  split: SPLIT, strips: DIAGONAL,
  ripple: CORNER_CENTER,
});

export function transitionDirections(type: TransitionType): readonly string[] {
  if (!TYPE_SET.has(type)) throw new Error(`未知页面切换类型：${String(type)}`);
  return DIRECTIONS[type] ?? NONE;
}

export type SlideTransitionInput = {
  readonly type: TransitionType;
  /** none 省略；其余省略时采用 750ms。 */
  readonly durationMs?: number;
  readonly dir?: string;
  /** SetTransition 省略时保留当前页面计时；显式传值才更新。 */
  readonly advanceAfterMs?: number;
  readonly morphBy?: Transition['morphBy'];
};

function integerInRange(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${label} 必须是 ${min}–${max} 的整数`);
  }
  return Number(value);
}

/** 命令与恢复 Patch 共用一处严格归一化，避免合法性在不同入口漂移。 */
export function normalizeSlideTransition(value: unknown, label = '页面切换'): Transition {
  assertDataObject(value, ['type', 'durationMs', 'dir', 'advanceAfterMs', 'morphBy'], label);
  const input = value as Partial<SlideTransitionInput>;
  if (typeof input.type !== 'string' || !TYPE_SET.has(input.type)) {
    throw new Error(`${label}.type 不是已支持的页面切换类型`);
  }
  const type = input.type as TransitionType;
  const directions = transitionDirections(type);
  if (input.dir !== undefined
    && (typeof input.dir !== 'string' || !directions.includes(input.dir))) {
    throw new Error(`${label}.dir 与 ${type} 不相容`);
  }
  if (input.morphBy !== undefined
    && (type !== 'morph' || !['byObject', 'byWord', 'byChar'].includes(input.morphBy))) {
    throw new Error(`${label}.morphBy 只适用于 morph`);
  }
  if (type === 'none') {
    if ((input.durationMs !== undefined && input.durationMs !== 0)
      || input.dir !== undefined || input.morphBy !== undefined) {
      throw new Error(`${label} 的 none 不能携带播放参数`);
    }
    const advanceAfterMs = input.advanceAfterMs === undefined
      ? undefined : integerInRange(input.advanceAfterMs, 0, 0xffffffff, `${label}.advanceAfterMs`);
    return { type, durationMs: 0, ...(advanceAfterMs !== undefined ? { advanceAfterMs } : {}) };
  }
  const durationMs = input.durationMs === undefined
    ? 750 : integerInRange(input.durationMs, 80, 5000, `${label}.durationMs`);
  const dir = input.dir ?? transitionPreferredDirection(type);
  const advanceAfterMs = input.advanceAfterMs === undefined
    ? undefined : integerInRange(input.advanceAfterMs, 0, 0xffffffff, `${label}.advanceAfterMs`);
  return {
    type, durationMs,
    ...(dir !== undefined ? { dir } : {}),
    ...(advanceAfterMs !== undefined ? { advanceAfterMs } : {}),
    ...(type === 'morph' ? { morphBy: input.morphBy ?? 'byObject' } : {}),
  };
}

/** 模型/Patch 必须已经归一化，不能在回放时悄悄补默认值。 */
export function assertStoredSlideTransition(value: unknown, label: string): asserts value is Transition {
  const normalized = normalizeSlideTransition(value, label);
  if (JSON.stringify(normalized) !== JSON.stringify(value)) {
    throw new Error(`${label} 必须是规范化页面切换值`);
  }
}

function records(doc: EditDoc, ids: readonly SlideId[]) {
  if (!ids.length) throw new Error('页面切换查询至少需要一个页面');
  return ids.map((id) => {
    const record = doc.slides[id];
    if (!record) throw new Error(`找不到幻灯片：${id}`);
    return record;
  });
}

const clone = (value: Transition | undefined): Transition | null =>
  value ? structuredClone(value) : null;

/** 换版式只改变继承来源；查询元数据不应为此重投影整页元素。 */
function sourceTransition(doc: EditDoc, record: SlideRecord): Transition | undefined {
  if (!record.sourceDirectTransition && record.layoutId !== record.sourceLayoutId) {
    return record.layoutId ? doc.layouts[record.layoutId]?.transition : undefined;
  }
  return record.src.transition;
}

export function querySlideTransition(doc: EditDoc, ids: readonly SlideId[]): SlideTransitionState {
  const selected = records(doc, ids);
  const sources = selected.map((record) => sourceTransition(doc, record));
  const values = selected.map((record, index) =>
    own(record.ovr, 'transition') ? record.ovr.transition : sources[index]);
  const valueSignature = JSON.stringify(values[0] ?? null);
  const sourceSignature = JSON.stringify(sources[0] ?? null);
  return {
    value: clone(values[0]), source: clone(sources[0]),
    mixed: values.some((value) => JSON.stringify(value ?? null) !== valueSignature),
    sourceMixed: sources.some((value) => JSON.stringify(value ?? null) !== sourceSignature),
    direct: selected.some((record) => own(record.ovr, 'transition')),
  };
}
