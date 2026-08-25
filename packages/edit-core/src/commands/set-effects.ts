import { own } from '../data-validation';
import { assertEffects, normalizeEffects } from '../shape-effects';
import type { EditDoc } from '../types';
import type { CommandPatches, ElementEffectsPatch, SetEffectsCommand } from './types';

export function setEffectsPatches(
  doc: EditDoc,
  command: SetEffectsCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改二维效果');
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if (!['shape', 'image', 'group'].includes(record.src.kind) || record.meta.editable !== 'full') {
    throw new Error(`元素不支持二维效果：${command.id}`);
  }
  if (record.meta.locked) throw new Error(`元素已锁定：${command.id}`);
  if (command.effects !== null) assertEffects(command.effects, 'SetEffects.effects');
  const value = command.effects === null ? null : normalizeEffects(command.effects);
  const path = ['elements', command.id, 'ovr', 'effects'] as const;
  const hadOverride = own(record.ovr, 'effects');
  if (value === null) {
    if (!hadOverride) return { forward: [], inverse: [] };
    return {
      forward: [{ op: 'del', path, origin }],
      inverse: [{ op: 'set', path, value: structuredClone(record.ovr.effects ?? {}), origin }],
    };
  }
  const before = hadOverride ? record.ovr.effects ?? {} : record.src.effects ?? {};
  // 即便当前有效值相同，首次直设仍要写覆盖；否则 {} 无法屏蔽未来的主题效果变化。
  if (hadOverride && JSON.stringify(before) === JSON.stringify(value)) {
    return { forward: [], inverse: [] };
  }
  const forward: ElementEffectsPatch = { op: 'set', path, value: structuredClone(value), origin };
  const inverse: ElementEffectsPatch = hadOverride
    ? { op: 'set', path, value: structuredClone(record.ovr.effects ?? {}), origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}
