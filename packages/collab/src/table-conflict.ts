import { tableGridIdentities } from '@web-ppt/edit-core';
import type { EditDoc, Patch, TableGridEntryPatch } from '@web-ppt/edit-core';
import { compareStamp } from './message';
import type { CollaborationSession } from './state';
import type { CollabStamp } from './types';

type Dimension = 'row' | 'column';

interface Tombstone {
  readonly elementId: string;
  readonly dimension: Dimension;
  readonly field: 'tableRemovedRows' | 'tableRemovedColumns';
  readonly id: string;
  readonly patch: TableGridEntryPatch;
}

interface DimensionState {
  readonly all: readonly string[];
  readonly removed: Set<string>;
  readonly stamps: Map<string, CollabStamp>;
}

interface TableState {
  readonly rows: DimensionState;
  readonly columns: DimensionState;
}

export interface RebasedTablePatches {
  readonly accepted: Patch[];
  readonly recorded: Patch[];
}

function tombstone(patch: Patch): Tombstone | null {
  if (patch.path.length !== 5 || patch.path[0] !== 'elements' || patch.path[2] !== 'ovr'
    || !['tableRemovedRows', 'tableRemovedColumns'].includes(String(patch.path[3]))) return null;
  const field = patch.path[3] as Tombstone['field'];
  return {
    elementId: patch.path[1],
    dimension: field === 'tableRemovedRows' ? 'row' : 'column',
    field,
    id: patch.path[4],
    patch: patch as TableGridEntryPatch,
  };
}

function initialStamp(
  session: CollaborationSession, elementId: string, field: Tombstone['field'], id: string,
): CollabStamp {
  const key = JSON.stringify(['elements', elementId, 'ovr', field, id]);
  return session.registers.get(key)?.stamp ?? { clock: 0, replicaId: '' };
}

function stateFor(
  doc: EditDoc, session: CollaborationSession, states: Map<string, TableState>, elementId: string,
): TableState {
  const cached = states.get(elementId);
  if (cached) return cached;
  const record = doc.elements[elementId];
  if (!record || record.src.kind !== 'table') throw new Error(`协同表格不存在：${elementId}`);
  const identities = tableGridIdentities(doc, elementId);
  const build = (
    dimension: Dimension, all: readonly string[], field: Tombstone['field'],
  ): DimensionState => {
    const source = dimension === 'row' ? record.ovr.tableRemovedRows : record.ovr.tableRemovedColumns;
    const removed = new Set(Object.keys(source ?? {}));
    return {
      all,
      removed,
      stamps: new Map([...removed].map((id) => [id, initialStamp(session, elementId, field, id)])),
    };
  };
  const state = {
    rows: build('row', identities.rows, 'tableRemovedRows'),
    columns: build('column', identities.columns, 'tableRemovedColumns'),
  };
  states.set(elementId, state);
  return state;
}

function restorePatch(target: Tombstone, id: string): TableGridEntryPatch {
  return {
    op: 'del', path: ['elements', target.elementId, 'ovr', target.field, id],
    origin: target.patch.origin,
  };
}

function oldestRemoval(state: DimensionState): string {
  return [...state.removed].sort((left, right) => {
    const order = compareStamp(state.stamps.get(left)!, state.stamps.get(right)!);
    return order || (left < right ? -1 : left > right ? 1 : 0);
  })[0];
}

/** tombstone 只控制可见性；字段继续独立收敛，撤销后才能恢复同一身份的完整状态。 */
export function rebaseTablePatches(
  doc: EditDoc, session: CollaborationSession, stamp: CollabStamp, patches: readonly Patch[],
): RebasedTablePatches {
  const accepted: Patch[] = [];
  const recorded: Patch[] = [];
  const states = new Map<string, TableState>();
  const append = (patch: Patch, derived = false): void => {
    accepted.push(patch);
    if (derived) recorded.push(patch);
  };
  for (const patch of patches) {
    const removal = tombstone(patch);
    if (removal) {
      const table = stateFor(doc, session, states, removal.elementId);
      const dimension = removal.dimension === 'row' ? table.rows : table.columns;
      if (patch.op === 'del') {
        dimension.removed.delete(removal.id);
        dimension.stamps.delete(removal.id);
        append(patch);
        continue;
      }
      dimension.removed.add(removal.id);
      dimension.stamps.set(removal.id, stamp);
      if (dimension.removed.size >= dimension.all.length) {
        const restored = oldestRemoval(dimension);
        dimension.removed.delete(restored);
        dimension.stamps.delete(restored);
        const restore = restorePatch(removal, restored);
        append(restore, true);
        if (restored === removal.id) continue;
      }
      append(patch);
      continue;
    }
    append(patch);
  }
  return { accepted, recorded };
}
