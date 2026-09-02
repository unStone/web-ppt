import type { EditDoc } from '../types';
import type { SpacePoint } from '../space';
import {
  arrangementTargets, translateElementInSlide,
} from './element-arrangement';
import type { ElementWorldBounds } from './element-arrangement';
import type { AlignEdge, AlignElementsCommand, CommandPatches, Patch } from './types';

const EDGES = new Set<AlignEdge>(['left', 'center', 'right', 'top', 'middle', 'bottom']);
const HORIZONTAL = new Set<AlignEdge>(['left', 'center', 'right']);

function unionBounds(bounds: readonly ElementWorldBounds[]): ElementWorldBounds {
  return {
    left: Math.min(...bounds.map((value) => value.left)),
    top: Math.min(...bounds.map((value) => value.top)),
    right: Math.max(...bounds.map((value) => value.right)),
    bottom: Math.max(...bounds.map((value) => value.bottom)),
  };
}

function edgeValue(bounds: ElementWorldBounds, edge: AlignEdge): number {
  if (edge === 'left') return bounds.left;
  if (edge === 'center') return (bounds.left + bounds.right) / 2;
  if (edge === 'right') return bounds.right;
  if (edge === 'top') return bounds.top;
  if (edge === 'middle') return (bounds.top + bounds.bottom) / 2;
  return bounds.bottom;
}

function worldDelta(item: ElementWorldBounds, target: ElementWorldBounds, edge: AlignEdge): SpacePoint {
  const value = edgeValue(target, edge) - edgeValue(item, edge);
  return HORIZONTAL.has(edge) ? { x: value, y: 0 } : { x: 0, y: value };
}

/** 一个命令直接产出全部位置 patch，避免宿主把六按钮能力错误拆成多段历史。 */
export function alignElementsPatches(
  doc: EditDoc,
  command: AlignElementsCommand,
  origin: string,
): CommandPatches {
  if (!EDGES.has(command.edge)) throw new Error(`未知对齐边：${String(command.edge)}`);
  const items = arrangementTargets(doc, command.ids, 1, 'AlignElements');
  const slideBounds = { left: 0, top: 0, right: doc.meta.width, bottom: doc.meta.height };
  const target = items.length === 1 ? slideBounds : unionBounds(items.map((item) => item.bounds));
  const forward: Patch[] = [];
  const inverse: Patch[] = [];
  for (const item of items) {
    const patches = translateElementInSlide(
      doc, item.id, worldDelta(item.bounds, target, command.edge), origin, 'AlignElements',
    );
    forward.push(...patches.forward);
    inverse.unshift(...patches.inverse);
  }
  return { forward, inverse };
}
