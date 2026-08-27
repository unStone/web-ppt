import { own } from '../data-validation';
import { normalizeSlideAnimations } from '../slide-animation';
import type { EditDoc } from '../types';
import type { CommandPatches, SetAnimationsCommand, SlideAnimationsPatch } from './types';

export function setAnimationsPatches(
  doc: EditDoc,
  command: SetAnimationsCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改元素动画');
  const record = doc.slides[command.slideId];
  if (!record) throw new Error(`找不到幻灯片：${String(command.slideId)}`);
  const path = ['slides', command.slideId, 'ovr', 'animations'] as const;
  const hadOverride = own(record.ovr, 'animations');
  if (command.steps === null) {
    if (!hadOverride) return { forward: [], inverse: [] };
    return {
      forward: [{ op: 'del', path, origin }],
      inverse: [{
        op: 'set', path, value: structuredClone(record.ovr.animations!), origin,
      }],
    };
  }
  const value = normalizeSlideAnimations(doc, command.slideId, command.steps, 'SetAnimations.steps');
  if (hadOverride && JSON.stringify(record.ovr.animations) === JSON.stringify(value)) {
    return { forward: [], inverse: [] };
  }
  const forward: SlideAnimationsPatch = {
    op: 'set', path, value: structuredClone(value), origin,
  };
  const inverse: SlideAnimationsPatch = hadOverride
    ? { op: 'set', path, value: structuredClone(record.ovr.animations!), origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}
