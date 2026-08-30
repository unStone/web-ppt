import type { EditDoc, Patch } from '@web-ppt/edit-core';
import { hierarchyRecords } from './hierarchy-conflict';
import { compareStamp, pathKey } from './message';
import type { SeenMap } from './seen';
import type { CollabMessage, CollabStamp } from './types';

const XFRM_FIELDS = ['x', 'y', 'w', 'h', 'rot', 'flipH', 'flipV'] as const;
export const hierarchyKey = (id: string): string => `hierarchy:${JSON.stringify(id)}`;

export type Register = { readonly stamp: CollabStamp; readonly kind: 'field' | 'hierarchy' };
export type Lifecycle = { readonly stamp: CollabStamp; readonly state: 'present' | 'removed' };
export type SlideMove = {
  readonly stamp: CollabStamp;
  readonly after: string | null;
  readonly ordinal: number;
};
export interface DeferredPatch {
  readonly message: CollabMessage;
  readonly patch: Patch;
  readonly ordinal: number;
}

export interface CollaborationSession {
  readonly documentId: string;
  readonly replicaId: string;
  readonly replicaSlot: number;
  readonly registers: Map<string, Register>;
  readonly elementLifecycles: Map<string, Lifecycle>;
  readonly slideLifecycles: Map<string, Lifecycle>;
  readonly slideMoves: Map<string, SlideMove>;
  readonly seen: SeenMap;
  readonly baseSlideOrder: readonly string[];
  deferred: DeferredPatch[];
  clock: number;
  sequence: number;
  active: boolean;
}

export const elementLifecycle = (patch: Patch): { id: string; state: Lifecycle['state'] } | null =>
  patch.path.length === 2 && patch.path[0] === 'elements'
    && (patch.op === 'insert' || patch.op === 'remove')
    ? { id: patch.path[1], state: patch.op === 'insert' ? 'present' : 'removed' }
    : null;

export const slideLifecycle = (patch: Patch): { id: string; state: Lifecycle['state'] } | null =>
  patch.path.length === 2 && patch.path[0] === 'slides'
    && (patch.op === 'insert' || patch.op === 'remove')
    ? { id: patch.path[1], state: patch.op === 'insert' ? 'present' : 'removed' }
    : null;

export const slideMove = (patch: Patch): { id: string; after: string | null } | null => {
  if (patch.op !== 'move' || patch.path.length !== 2 || patch.path[0] !== 'slideOrder') return null;
  const after = (patch as { value?: { after?: unknown } }).value?.after;
  return after === null || typeof after === 'string' && after
    ? { id: patch.path[1], after } : null;
};

export const elementHierarchy = (patch: Patch): Readonly<Record<string, unknown>> | null =>
  hierarchyRecords(patch);

export const newer = (stamp: CollabStamp, current?: { stamp: CollabStamp }): boolean =>
  !current || compareStamp(stamp, current.stamp) > 0;

export function patchNewer(
  session: CollaborationSession,
  patch: Patch,
  stamp: CollabStamp,
): boolean {
  const element = elementLifecycle(patch);
  if (element) return newer(stamp, session.elementLifecycles.get(element.id));
  const slide = slideLifecycle(patch);
  if (slide) return newer(stamp, session.slideLifecycles.get(slide.id));
  const hierarchy = elementHierarchy(patch);
  if (hierarchy) {
    const affected = (patch as { value: { affected: readonly string[] } }).value.affected;
    return affected.every((id) => newer(stamp, session.registers.get(hierarchyKey(id))));
  }
  const move = slideMove(patch);
  if (move) return newer(stamp, session.slideMoves.get(move.id));
  return newer(stamp, session.registers.get(pathKey(patch)));
}

/** 同一原子消息共用 stamp；先按 ordinal 折叠末次意图，再与先前消息做严格 LWW。 */
export function recordPatches(
  session: CollaborationSession,
  patches: readonly Patch[],
  stamp: CollabStamp,
): void {
  const registers = new Map<string, Register['kind']>();
  const elements = new Map<string, Lifecycle['state']>();
  const slides = new Map<string, Lifecycle['state']>();
  const moves = new Map<string, { after: string | null; ordinal: number }>();
  for (let ordinal = 0; ordinal < patches.length; ordinal++) {
    const patch = patches[ordinal];
    const hierarchy = elementHierarchy(patch);
    if (hierarchy) {
      const root = patch.path[1];
      const state = (patch as {
        value: { affected: readonly string[]; records: Readonly<Record<string, unknown>> };
      }).value;
      for (const id of state.affected) registers.set(hierarchyKey(id), 'hierarchy');
      for (const [id, record] of Object.entries(hierarchy)) {
        elements.set(id, record === null ? 'removed' : 'present');
        if (record !== null) registers.set(JSON.stringify(['elements', id, 'order']), 'hierarchy');
      }
      if (hierarchy[root] === null) {
        for (const [id, record] of Object.entries(state.records)) {
          if (record === null) continue;
          for (const field of XFRM_FIELDS) {
            registers.set(JSON.stringify(['elements', id, 'ovr', field]), 'hierarchy');
          }
        }
      }
      registers.set(pathKey(patch), 'hierarchy');
      continue;
    }
    const element = elementLifecycle(patch);
    if (element) {
      const records = (patch as { value?: { records?: Readonly<Record<string, unknown>> } }).value?.records;
      for (const id of Object.keys(records ?? { [element.id]: true })) {
        elements.set(id, element.state);
        registers.set(hierarchyKey(id), 'hierarchy');
      }
    }
    const slide = slideLifecycle(patch);
    if (slide) {
      slides.set(slide.id, slide.state);
      const records = (patch as { value?: { records?: Readonly<Record<string, unknown>> } }).value?.records;
      for (const id of Object.keys(records ?? {})) {
        elements.set(id, slide.state);
        registers.set(hierarchyKey(id), 'hierarchy');
      }
      if (slide.state === 'present') moves.set(slide.id, {
        after: patch.op === 'insert'
          ? (patch.value as { readonly after: string | null }).after : null,
        ordinal,
      });
    }
    const move = slideMove(patch);
    if (move) moves.set(move.id, { after: move.after, ordinal });
    if (!element && !slide && !move) registers.set(pathKey(patch), 'field');
  }
  for (const [key, kind] of registers) {
    const current = session.registers.get(key);
    if (!current || compareStamp(stamp, current.stamp) >= 0) session.registers.set(key, { stamp, kind });
  }
  for (const [id, state] of elements) {
    const current = session.elementLifecycles.get(id);
    // 外部副本的显式树删除压过并发结构意图；同副本更晚的撤销插入仍可恢复该身份。
    if (state === 'removed' && current?.stamp.replicaId !== stamp.replicaId
      || newer(stamp, current)) {
      session.elementLifecycles.set(id, { stamp, state });
    }
  }
  for (const [id, state] of slides) {
    if (newer(stamp, session.slideLifecycles.get(id))) {
      session.slideLifecycles.set(id, { stamp, state });
    }
  }
  for (const [id, move] of moves) {
    if (newer(stamp, session.slideMoves.get(id))) session.slideMoves.set(id, { stamp, ...move });
  }
}

export function targetExists(doc: EditDoc, patch: Patch): boolean {
  const [root, id] = patch.path;
  if (root === 'elements' && typeof id === 'string') return !!doc.elements[id];
  if ((root === 'slides' || root === 'slideOrder') && typeof id === 'string') {
    return !!doc.slides[id];
  }
  return true;
}
