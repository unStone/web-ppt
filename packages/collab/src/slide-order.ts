import type { Patch, SlideTreePatch } from '@web-ppt/edit-core';
import { compareStamp } from './message';
import { slideMove } from './state';
import type { SlideMove } from './state';

export function desiredSlideOrder(
  base: readonly string[], members: ReadonlySet<string>, moves: ReadonlyMap<string, SlideMove>,
): string[] {
  const desired = base.filter((id) => members.has(id));
  desired.push(...[...members].filter((id) => !desired.includes(id)).sort());
  const orderedMoves = [...moves.entries()].sort((left, right) =>
    compareStamp(left[1].stamp, right[1].stamp)
    || left[1].ordinal - right[1].ordinal
    || (left[0] < right[0] ? -1 : left[0] === right[0] ? 0 : 1));
  for (const [id, move] of orderedMoves) {
    const from = desired.indexOf(id);
    if (from < 0) continue;
    desired.splice(from, 1);
    const anchor = move.after === null ? -1 : desired.indexOf(move.after);
    desired.splice(anchor < 0 && move.after !== null ? desired.length : anchor + 1, 0, id);
  }
  return desired;
}

function movePatches(currentInput: readonly string[], desired: readonly string[]): Patch[] {
  const current = [...currentInput];
  const patches: Patch[] = [];
  for (let index = 0; index < desired.length; index++) {
    const id = desired[index];
    const after = desired[index - 1] ?? null;
    const at = current.indexOf(id);
    const previous = at > 0 ? current[at - 1] : null;
    if (previous === after) continue;
    current.splice(at, 1);
    const anchor = after === null ? -1 : current.indexOf(after);
    current.splice(anchor + 1, 0, id);
    patches.push({ op: 'move', path: ['slideOrder', id], value: { after }, origin: 'collab-order' });
  }
  return patches;
}

/** 把页序 intent 与本消息的增删页一起物化，确保一次 external recovery 就是最终顺序。 */
export function materializeSlideOrder(
  currentOrder: readonly string[], desired: readonly string[], patches: readonly Patch[],
): Patch[] {
  const insertions = new Map<string, SlideTreePatch>();
  const removals: SlideTreePatch[] = [];
  const other: Patch[] = [];
  for (const patch of patches) {
    if (slideMove(patch)) continue;
    if (patch.path.length === 2 && patch.path[0] === 'slides'
      && (patch.op === 'insert' || patch.op === 'remove')) {
      const tree = structuredClone(patch) as SlideTreePatch;
      if (tree.op === 'insert') insertions.set(tree.path[1], tree);
      else removals.push(tree);
    } else other.push(patch);
  }
  const removed = new Set(removals.map((patch) => patch.path[1]));
  const currentExisting = currentOrder.filter((id) => !removed.has(id));
  const desiredExisting = desired.filter((id) => !insertions.has(id));
  const moves = movePatches(currentExisting, desiredExisting);

  const orderedInsertions: SlideTreePatch[] = [];
  for (let index = 0; index < desired.length; index++) {
    const id = desired[index];
    const insertion = insertions.get(id);
    if (!insertion) continue;
    orderedInsertions.push({
      ...insertion,
      value: { ...insertion.value, after: desired[index - 1] ?? null },
    });
  }
  return [...removals, ...moves, ...orderedInsertions, ...other];
}
