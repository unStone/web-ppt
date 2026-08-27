import type { AnimEffect, AnimStep } from '@web-ppt/core';
import { assertDataArray, assertDataObject, own } from './data-validation';
import type {
  EditAnimationStep, EditDoc, ElementId, SlideAnimationState, SlideId, SlideRecord,
} from './types';
import {
  ANIMATION_EFFECTS, animationDefaultDirection, animationDirections,
  animationEffectSpec, animationEffectsForKind,
} from './animation-catalog';

export { ANIMATION_EFFECTS, animationDirections, animationEffectsForKind };

const EFFECT_SET = new Set<string>(ANIMATION_EFFECTS);
const STEP_FIELDS = [
  'target', 'kind', 'effect', 'dir', 'trigger', 'delayMs', 'durationMs', 'motionPath',
] as const;
const TRIGGERS = new Set(['click', 'withPrev', 'afterPrev']);
const KINDS = new Set(['entrance', 'exit', 'emphasis', 'motion']);

function integerInRange(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${label} 必须是 ${min}–${max} 的整数`);
  }
  return Number(value);
}

function point(value: unknown, label: string): readonly [number, number] {
  assertDataArray(value, label);
  if (value.length !== 2 || value.some((coordinate) =>
    typeof coordinate !== 'number' || !Number.isFinite(coordinate) || Math.abs(coordinate) > 1_000_000)) {
    throw new Error(`${label} 必须是两个范围内的有限坐标`);
  }
  return [Number(value[0]), Number(value[1])];
}

/** 模型保留用户顶点；匀速属于播放时间映射，不能靠改写几何来实现。 */
function normalizeMotionPath(value: unknown, label: string): readonly (readonly [number, number])[] {
  assertDataArray(value, label);
  if (value.length < 2 || value.length > 256) throw new Error(`${label} 必须包含 2–256 个点`);
  const points = value.map((candidate, index) => point(candidate, `${label}[${index}]`));
  if (points[0][0] !== 0 || points[0][1] !== 0) throw new Error(`${label} 必须从 [0, 0] 开始`);
  const lengths = [0];
  for (let index = 1; index < points.length; index++) {
    lengths.push(lengths[index - 1]
      + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]));
  }
  const total = lengths[lengths.length - 1];
  if (!(total > 0)) throw new Error(`${label} 必须包含有效位移`);
  return points;
}

function assertTarget(doc: EditDoc, slideId: SlideId, target: unknown, label: string): ElementId {
  if (typeof target !== 'string' || !target || !doc.elements[target]) {
    throw new Error(`${label} 指向不存在的元素`);
  }
  const record = doc.elements[target];
  if (record.meta.editable === 'none') throw new Error(`${label} 指向不可无歧义写回的元素`);
  let parent: SlideId | ElementId = record.parent;
  const seen = new Set<ElementId>([target]);
  while (!doc.slides[parent]) {
    if (seen.has(parent as ElementId) || !doc.elements[parent]) {
      throw new Error(`${label} 的元素父链无效`);
    }
    seen.add(parent as ElementId);
    parent = doc.elements[parent].parent;
  }
  if (parent !== slideId) throw new Error(`${label} 不能跨页面`);
  const slidePart = doc.slides[slideId].origin?.part;
  const origin = record.meta.origin;
  if (doc.meta.source === 'pptx' && (!slidePart || origin?.part !== slidePart)) {
    throw new Error(`${label} 必须指向当前页面可写元素`);
  }
  return target;
}

function normalizeStep(
  doc: EditDoc, slideId: SlideId, value: unknown, label: string,
): EditAnimationStep {
  assertDataObject(value, STEP_FIELDS, label);
  const input = value as Partial<EditAnimationStep> & Record<string, unknown>;
  const target = assertTarget(doc, slideId, input.target, `${label}.target`);
  if (typeof input.kind !== 'string' || !KINDS.has(input.kind)) {
    throw new Error(`${label}.kind 不是已支持的动画类别`);
  }
  if (typeof input.trigger !== 'string' || !TRIGGERS.has(input.trigger)) {
    throw new Error(`${label}.trigger 不是已支持的触发方式`);
  }
  const trigger = input.trigger as EditAnimationStep['trigger'];
  const delayMs = integerInRange(input.delayMs, 0, 300_000, `${label}.delayMs`);
  const durationMs = integerInRange(input.durationMs, 60, 10_000, `${label}.durationMs`);
  if (input.kind === 'motion') {
    if (own(input, 'effect') || own(input, 'dir') || !own(input, 'motionPath')) {
      throw new Error(`${label} 的 motion 只能携带运动路径`);
    }
    return {
      target, kind: 'motion', trigger, delayMs, durationMs,
      motionPath: normalizeMotionPath(input.motionPath, `${label}.motionPath`),
    };
  }
  if (own(input, 'motionPath') || typeof input.effect !== 'string' || !EFFECT_SET.has(input.effect)) {
    throw new Error(`${label} 的视觉动画必须携带已支持效果且不能携带路径`);
  }
  const effect = input.effect as AnimEffect;
  const kind = input.kind as 'entrance' | 'exit' | 'emphasis';
  if (!animationEffectSpec(effect).kinds.includes(kind)) {
    throw new Error(`${label} 的 ${effect} 不能用于 ${kind}`);
  }
  const directions = animationDirections(effect);
  if (input.dir !== undefined
    && (typeof input.dir !== 'string' || !directions.includes(input.dir))) {
    throw new Error(`${label}.dir 与 ${effect} 不相容`);
  }
  const dir = input.dir as string | undefined ?? animationDefaultDirection(effect);
  return {
    target, kind, effect, trigger, delayMs, durationMs,
    ...(dir !== undefined ? { dir } : {}),
  } as EditAnimationStep;
}

export function normalizeSlideAnimations(
  doc: EditDoc, slideId: SlideId, value: unknown, label = '页面动画',
): readonly EditAnimationStep[] {
  if (!doc.slides[slideId]) throw new Error(`找不到幻灯片：${String(slideId)}`);
  assertDataArray(value, label);
  if (value.length > 1000) throw new Error(`${label} 最多包含 1000 步`);
  const normalized = value.map((candidate, index) =>
    normalizeStep(doc, slideId, candidate, `${label}[${index}]`));
  if (normalized[0] && normalized[0].trigger !== 'click') {
    throw new Error(`${label} 的第一步必须由 click 启动`);
  }
  return normalized;
}

/** 来源解析结果映射失败时仍原样投影；查询用 sourceReadonly 告知产品不要冒充完整可编辑。 */
export function sourceAnimationSteps(
  doc: EditDoc, slideId: SlideId, steps: readonly AnimStep[] | undefined,
): { steps: readonly EditAnimationStep[]; readonly: boolean } {
  if (!steps?.length) return { steps: [], readonly: false };
  const record = doc.slides[slideId];
  const ids = new Map<number, ElementId>();
  const visit = (id: ElementId): void => {
    const element = doc.elements[id];
    if (!element) return;
    if (element.meta.origin?.part === record.origin?.part || doc.meta.source !== 'pptx') {
      const spid = element.meta.origin?.spid ?? element.src.id;
      if (spid !== undefined) {
        if (!ids.has(spid)) ids.set(spid, id);
        else ids.delete(spid);
      }
    }
    for (const child of element.children ?? []) visit(child);
  };
  for (const id of record.children) visit(id);
  const mapped: EditAnimationStep[] = [];
  let readonly = false;
  for (const step of steps) {
    const target = ids.get(step.target);
    if (!target) { readonly = true; continue; }
    const input = step.kind === 'motion' ? {
      target, kind: 'motion', trigger: step.trigger, delayMs: Math.round(step.delayMs),
      durationMs: Math.round(step.durationMs), motionPath: step.motionPath,
    } : {
      target, kind: step.kind, effect: step.effect, trigger: step.trigger,
      delayMs: Math.round(step.delayMs), durationMs: Math.round(step.durationMs),
      ...(step.dir !== undefined ? { dir: step.dir } : {}),
    };
    try { mapped.push(normalizeStep(doc, slideId, input, '来源动画')); }
    catch { readonly = true; }
  }
  if (mapped[0] && mapped[0].trigger !== 'click') return { steps: [], readonly: true };
  return { steps: mapped, readonly };
}

export function projectAnimationSteps(
  doc: EditDoc, steps: readonly EditAnimationStep[],
): AnimStep[] | undefined {
  if (!steps.length) return undefined;
  let clickGroup = -1;
  return steps.map((step): AnimStep => {
    if (step.trigger === 'click' || clickGroup < 0) clickGroup++;
    const element = doc.elements[step.target];
    if (!element) throw new Error(`动画目标不存在：${step.target}`);
    const target = element.meta.origin?.spid ?? element.src.id;
    if (target === undefined) throw new Error(`动画目标缺少可投影 spid：${step.target}`);
    return step.kind === 'motion' ? {
      target, kind: 'motion', effect: 'appear', trigger: step.trigger,
      delayMs: step.delayMs, durationMs: step.durationMs,
      motionPath: step.motionPath.map(([x, y]) => [x, y]), clickGroup,
    } : {
      target, kind: step.kind, effect: step.effect, trigger: step.trigger,
      delayMs: step.delayMs, durationMs: step.durationMs,
      ...(step.dir !== undefined ? { dir: step.dir } : {}), clickGroup,
    };
  });
}

function records(doc: EditDoc, ids: readonly SlideId[]): SlideRecord[] {
  if (!ids.length) throw new Error('元素动画查询至少需要一个页面');
  return ids.map((id) => {
    const record = doc.slides[id];
    if (!record) throw new Error(`找不到幻灯片：${id}`);
    return record;
  });
}

const clone = (steps: readonly EditAnimationStep[]): readonly EditAnimationStep[] => structuredClone(steps);

export function querySlideAnimations(doc: EditDoc, ids: readonly SlideId[]): SlideAnimationState {
  const selected = records(doc, ids);
  const sources = selected.map((record) => record.sourceAnimations ?? []);
  const values = selected.map((record, index) =>
    own(record.ovr, 'animations') ? record.ovr.animations! : sources[index]);
  const valueSignature = JSON.stringify(values[0]);
  const sourceSignature = JSON.stringify(sources[0]);
  return {
    value: clone(values[0]), source: clone(sources[0]),
    mixed: values.some((value) => JSON.stringify(value) !== valueSignature),
    sourceMixed: sources.some((value) => JSON.stringify(value) !== sourceSignature),
    direct: selected.some((record) => own(record.ovr, 'animations')),
    sourceReadonly: selected.some((record) => record.sourceAnimationsReadonly === true),
  };
}

export function assertStoredSlideAnimations(
  doc: EditDoc, slideId: SlideId, value: unknown, label: string,
): asserts value is readonly EditAnimationStep[] {
  const normalized = normalizeSlideAnimations(doc, slideId, value, label);
  if (JSON.stringify(normalized) !== JSON.stringify(value)) {
    throw new Error(`${label} 必须是规范化元素动画时间线`);
  }
}
