import type { Effects } from '@web-ppt/core';
import { assertDataObject, own } from './data-validation';
import { effectiveElement } from './projection';
import { assertDrawingColor, normalizeDrawingColor } from './shape-fill';
import type { EditDoc, ElementEffectsState, ElementId } from './types';

const EMU_PER_PX = 9525;
const MAX_COORDINATE = 2147483647 / EMU_PER_PX;

function assertCoordinate(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_COORDINATE) {
    throw new Error(`${label} 必须是 DrawingML 可写回的非负有限像素值`);
  }
}

function assertSignedCoordinate(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value < -MAX_COORDINATE || value > MAX_COORDINATE) {
    throw new Error(`${label} 必须是 DrawingML 可写回的有限像素值`);
  }
}

function coordinate(value: number): number {
  return Math.round(value * EMU_PER_PX) / EMU_PER_PX;
}

function normalizeShadow(shadow: NonNullable<Effects['shadow']>): NonNullable<Effects['shadow']> {
  const distanceUnits = Math.round(Math.hypot(shadow.dx, shadow.dy) * EMU_PER_PX);
  let directionUnits = Math.round(Math.atan2(shadow.dy, shadow.dx) * 180 / Math.PI * 60000);
  directionUnits = ((directionUnits % 21600000) + 21600000) % 21600000;
  const distance = distanceUnits / EMU_PER_PX;
  const radians = directionUnits / 60000 * Math.PI / 180;
  return {
    dx: distance * Math.cos(radians),
    dy: distance * Math.sin(radians),
    blur: coordinate(shadow.blur),
    color: normalizeDrawingColor(shadow.color),
    inner: shadow.inner === true,
  };
}

export function assertEffects(value: unknown, label: string): asserts value is Effects {
  assertDataObject(value, ['shadow', 'glow', 'softEdge', 'reflection'], label);
  const effects = value as Effects;
  for (const field of ['shadow', 'glow', 'softEdge', 'reflection'] as const) {
    if (own(effects, field) && effects[field] === undefined) {
      throw new Error(`${label}.${field} 不能显式写 undefined`);
    }
  }
  if (effects.shadow !== undefined) {
    assertDataObject(effects.shadow, ['dx', 'dy', 'blur', 'color', 'inner'], `${label}.shadow`);
    assertSignedCoordinate(effects.shadow.dx, `${label}.shadow.dx`);
    assertSignedCoordinate(effects.shadow.dy, `${label}.shadow.dy`);
    if (Math.hypot(effects.shadow.dx, effects.shadow.dy) > MAX_COORDINATE) {
      throw new Error(`${label}.shadow 的位移超出 DrawingML 范围`);
    }
    assertCoordinate(effects.shadow.blur, `${label}.shadow.blur`);
    assertDrawingColor(effects.shadow.color, `${label}.shadow.color`);
    if (effects.shadow.inner !== undefined && typeof effects.shadow.inner !== 'boolean') {
      throw new Error(`${label}.shadow.inner 必须是布尔值`);
    }
  }
  if (effects.glow !== undefined) {
    assertDataObject(effects.glow, ['radius', 'color'], `${label}.glow`);
    assertCoordinate(effects.glow.radius, `${label}.glow.radius`);
    assertDrawingColor(effects.glow.color, `${label}.glow.color`);
  }
  if (effects.softEdge !== undefined) assertCoordinate(effects.softEdge, `${label}.softEdge`);
  if (effects.reflection !== undefined) {
    assertDataObject(effects.reflection, ['alpha', 'size', 'distance'], `${label}.reflection`);
    for (const field of ['alpha', 'size'] as const) {
      const fieldValue = effects.reflection[field];
      if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)
        || fieldValue < 0 || fieldValue > 1) {
        throw new Error(`${label}.reflection.${field} 必须在 0–1 之间`);
      }
    }
    assertCoordinate(effects.reflection.distance, `${label}.reflection.distance`);
  }
}

/** 与 core 解析器及 OOXML 整数单位共用一份规范值，避免保存重开后制造脏状态。 */
export function normalizeEffects(effects: Effects): Effects {
  return {
    ...(effects.shadow ? { shadow: normalizeShadow(effects.shadow) } : {}),
    ...(effects.glow ? { glow: {
      radius: coordinate(effects.glow.radius), color: normalizeDrawingColor(effects.glow.color),
    } } : {}),
    ...(effects.softEdge !== undefined ? { softEdge: coordinate(effects.softEdge) } : {}),
    ...(effects.reflection ? { reflection: {
      alpha: Math.round(effects.reflection.alpha * 100000) / 100000,
      size: Math.round(effects.reflection.size * 100000) / 100000,
      distance: coordinate(effects.reflection.distance),
    } } : {}),
  };
}

export function queryElementEffects(doc: EditDoc, ids: readonly ElementId[]): ElementEffectsState {
  if (!ids.length) throw new Error('效果查询至少需要一个元素');
  const values = ids.map((id) => {
    const element = effectiveElement(doc, id);
    if (!['shape', 'image', 'group'].includes(element.kind)) {
      throw new Error(`元素不支持二维效果：${id}`);
    }
    return element.effects ?? {};
  });
  const signature = JSON.stringify(values[0]);
  return {
    value: structuredClone(values[0]),
    mixed: values.some((value) => JSON.stringify(value) !== signature),
    direct: ids.some((id) => own(doc.elements[id].ovr, 'effects')),
  };
}
