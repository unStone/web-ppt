import { own } from '../data-validation';
import { assertVectorFill, normalizeVectorFill } from '../shape-fill';
import type { VectorFill } from '../shape-fill';
import type { EditDoc } from '../types';
import type {
  CommandPatches, SetBackgroundCommand, SetHiddenCommand, SlideBackgroundPatch, SlideHiddenPatch,
} from './types';

export function setBackgroundPatches(
  doc: EditDoc,
  command: SetBackgroundCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改页面背景');
  const record = doc.slides[command.id];
  if (!record) throw new Error(`找不到幻灯片：${String(command.id)}`);
  if (command.fill !== null) assertVectorFill(command.fill, 'SetBackground.fill');
  const path = ['slides', command.id, 'ovr', 'background'] as const;
  const hadOverride = own(record.ovr, 'background');
  const direct: VectorFill | undefined = hadOverride ? (() => {
    const fill = record.ovr.background;
    assertVectorFill(fill, `页面 ${command.id} 的背景覆盖`);
    return fill;
  })() : undefined;
  if (command.fill === null) {
    if (!hadOverride) return { forward: [], inverse: [] };
    return {
      forward: [{ op: 'del', path, origin }],
      inverse: [{ op: 'set', path, value: structuredClone(direct!), origin }],
    };
  }
  const value = normalizeVectorFill(command.fill);
  // 非 null 是用户要求建立直接值；即使视觉上等于来源，也不能吞掉这次语义选择。
  if (hadOverride && JSON.stringify(direct) === JSON.stringify(value)) {
    return { forward: [], inverse: [] };
  }
  const forward: SlideBackgroundPatch = {
    op: 'set', path, value: structuredClone(value), origin,
  };
  const inverse: SlideBackgroundPatch = hadOverride
    ? { op: 'set', path, value: structuredClone(direct!), origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}

export function setHiddenPatches(
  doc: EditDoc,
  command: SetHiddenCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改页面隐藏状态');
  const record = doc.slides[command.id];
  if (!record) throw new Error(`找不到幻灯片：${String(command.id)}`);
  if (command.v !== null && typeof command.v !== 'boolean') {
    throw new Error('SetHidden.v 必须是布尔值或 null');
  }
  const path = ['slides', command.id, 'ovr', 'hidden'] as const;
  const hadOverride = own(record.ovr, 'hidden');
  if (command.v === null) {
    if (!hadOverride) return { forward: [], inverse: [] };
    return {
      forward: [{ op: 'del', path, origin }],
      inverse: [{ op: 'set', path, value: record.ovr.hidden!, origin }],
    };
  }
  // false 同样是直接值；来源本来可见时也要保留用户明确覆盖。
  if (hadOverride && record.ovr.hidden === command.v) return { forward: [], inverse: [] };
  const forward: SlideHiddenPatch = { op: 'set', path, value: command.v, origin };
  const inverse: SlideHiddenPatch = hadOverride
    ? { op: 'set', path, value: record.ovr.hidden!, origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}
