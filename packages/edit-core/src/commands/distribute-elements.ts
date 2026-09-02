import type { EditDoc } from '../types';
import { arrangementTargets, translateElementInSlide } from './element-arrangement';
import type { CommandPatches, DistributeElementsCommand, Patch } from './types';

const AXES = new Set<DistributeElementsCommand['axis']>(['horizontal', 'vertical']);

/** 两端保持不动，中间对象按旋转后的世界 AABB 间隙等距排列。 */
export function distributeElementsPatches(
  doc: EditDoc,
  command: DistributeElementsCommand,
  origin: string,
): CommandPatches {
  if (!AXES.has(command.axis)) throw new Error(`未知分布轴：${String(command.axis)}`);
  const horizontal = command.axis === 'horizontal';
  const items = arrangementTargets(doc, command.ids, 3, 'DistributeElements')
    .sort((left, right) => {
      const primary = horizontal
        ? left.bounds.left - right.bounds.left : left.bounds.top - right.bounds.top;
      return primary || left.id.localeCompare(right.id);
    });
  const size = (item: typeof items[number]): number => horizontal
    ? item.bounds.right - item.bounds.left : item.bounds.bottom - item.bounds.top;
  const first = items[0];
  const last = items[items.length - 1];
  const span = horizontal
    ? last.bounds.right - first.bounds.left : last.bounds.bottom - first.bounds.top;
  const gap = (span - items.reduce((sum, item) => sum + size(item), 0)) / (items.length - 1);
  let cursor = (horizontal ? first.bounds.left : first.bounds.top) + size(first) + gap;
  const forward: Patch[] = [];
  const inverse: Patch[] = [];
  for (const item of items.slice(1, -1)) {
    const current = horizontal ? item.bounds.left : item.bounds.top;
    const patches = translateElementInSlide(
      doc, item.id, horizontal ? { x: cursor - current, y: 0 } : { x: 0, y: cursor - current },
      origin, 'DistributeElements',
    );
    forward.push(...patches.forward);
    inverse.unshift(...patches.inverse);
    cursor += size(item) + gap;
  }
  return { forward, inverse };
}
