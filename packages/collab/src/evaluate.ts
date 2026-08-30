import type {
  EditDoc, ElementHierarchyPatch, ElementTreePatch, Patch, SlideTreePatch,
} from '@web-ppt/edit-core';
import {
  hierarchyWithoutNewerMembers, hierarchyWithoutRemovedMembers,
  rebaseElementHierarchy, rebaseElementRemoval,
} from './hierarchy-conflict';
import { pathKey } from './message';
import { rebaseSlideRemoval } from './slide-conflict';
import {
  elementHierarchy, elementLifecycle, hierarchyKey, newer, slideLifecycle, slideMove, targetExists,
} from './state';
import type { CollaborationSession, Lifecycle } from './state';
import type { CollabMessage } from './types';
import { rebaseTablePatches } from './table-conflict';

export interface PatchAvailability {
  readonly elements: Set<string>;
  readonly slides: Set<string>;
}

export interface EvaluatedMessage {
  readonly accepted: Patch[];
  readonly recorded: Patch[];
  readonly missingDependency: boolean;
  readonly availability: PatchAvailability;
}

export function patchAvailability(
  patches: readonly Patch[], seed?: PatchAvailability,
): PatchAvailability {
  const availability = {
    elements: new Set(seed?.elements),
    slides: new Set(seed?.slides),
  };
  for (const patch of patches) {
    const element = elementLifecycle(patch);
    if (element?.state === 'present') {
      Object.keys((patch as ElementTreePatch).value.records)
        .forEach((id) => availability.elements.add(id));
    }
    const slide = slideLifecycle(patch);
    if (slide?.state === 'present') {
      availability.slides.add(slide.id);
      Object.keys((patch as SlideTreePatch).value.records)
        .forEach((id) => availability.elements.add(id));
    }
    if (elementHierarchy(patch)) {
      for (const [id, record] of Object.entries(
        (patch as ElementHierarchyPatch).value.records,
      )) if (record) availability.elements.add(id);
    }
  }
  return availability;
}

function targetRemoved(
  patch: Patch,
  elements: ReadonlyMap<string, Lifecycle>,
  slides: ReadonlyMap<string, Lifecycle>,
): boolean {
  const [root, id] = patch.path;
  if (root === 'elements' && typeof id === 'string') return elements.get(id)?.state === 'removed';
  if ((root === 'slides' || root === 'slideOrder') && typeof id === 'string') {
    return slides.get(id)?.state === 'removed';
  }
  return false;
}

function targetAvailable(doc: EditDoc, patch: Patch, available: PatchAvailability): boolean {
  const [root, id] = patch.path;
  if (root === 'elements' && available.elements.has(id)) return true;
  if ((root === 'slides' || root === 'slideOrder') && available.slides.has(id)) return true;
  return targetExists(doc, patch);
}

function parentAvailable(doc: EditDoc, parent: string, available: PatchAvailability): boolean {
  return !!doc.elements[parent] || !!doc.slides[parent]
    || available.elements.has(parent) || available.slides.has(parent);
}

/** 纯读求值；任一依赖缺失时调用方必须延迟整条消息，不能提交其中的结构子集。 */
export function evaluateRemoteMessage(
  doc: EditDoc,
  session: CollaborationSession,
  raw: CollabMessage,
  seed?: PatchAvailability,
): EvaluatedMessage {
  const accepted: Patch[] = [];
  const recorded: Patch[] = [];
  const available = patchAvailability([], seed);
  let missingDependency = false;
  for (const patch of raw.patches) {
    const element = elementLifecycle(patch);
    const slide = slideLifecycle(patch);
    const move = slideMove(patch);
    const hierarchy = elementHierarchy(patch);
    if (element) {
      if (element.state === 'removed') {
        const current = session.elementLifecycles.get(element.id);
        if (current?.stamp.replicaId === raw.replicaId && !newer(raw.stamp, current)) continue;
        const candidate = rebaseElementRemoval(doc, patch as ElementTreePatch);
        if (candidate) accepted.push(candidate);
        recorded.push(patch);
        if (candidate && candidate !== patch) recorded.push(candidate);
        continue;
      }
      if (!newer(raw.stamp, session.elementLifecycles.get(element.id))) continue;
      const parent = (patch as ElementTreePatch).value.parent;
      if (session.slideLifecycles.get(parent)?.state === 'removed'
        || session.elementLifecycles.get(parent)?.state === 'removed') {
        recorded.push({ ...patch, op: 'remove' } as ElementTreePatch);
        continue;
      }
      if (!parentAvailable(doc, parent, available)) missingDependency = true;
      if (!doc.elements[element.id]) {
        accepted.push(patch);
        Object.keys((patch as ElementTreePatch).value.records)
          .forEach((id) => available.elements.add(id));
      }
      recorded.push(patch);
      continue;
    }
    if (slide) {
      if (!newer(raw.stamp, session.slideLifecycles.get(slide.id))) continue;
      if (slide.state === 'removed') {
        const candidate = rebaseSlideRemoval(doc, patch as SlideTreePatch);
        if (candidate) accepted.push(candidate);
        recorded.push(candidate ?? patch);
        continue;
      }
      if (!doc.slides[slide.id]) {
        accepted.push(patch);
        available.slides.add(slide.id);
        Object.keys((patch as SlideTreePatch).value.records)
          .forEach((id) => available.elements.add(id));
      }
      recorded.push(patch);
      continue;
    }
    if (hierarchy) {
      const structural = patch as ElementHierarchyPatch;
      if (!parentAvailable(doc, structural.value.parent, available)) missingDependency = true;
      const removed = new Set([...session.elementLifecycles]
        .flatMap(([id, lifecycle]) => lifecycle.state === 'removed' ? [id] : []));
      const newerMembers = new Set(structural.value.affected.filter((id) =>
        !newer(raw.stamp, session.registers.get(hierarchyKey(id)))));
      const conflictFiltered = hierarchyWithoutNewerMembers(structural, newerMembers);
      const filtered = conflictFiltered && hierarchyWithoutRemovedMembers(
        doc, conflictFiltered, removed,
      );
      if (filtered) {
        const ungroup = filtered.value.records[filtered.path[1]] === null;
        const candidate = rebaseElementHierarchy(doc, filtered, (id, field) => {
          const path = field === 'order'
            ? ['elements', id, 'order'] : ['elements', id, 'ovr', field];
          const register = session.registers.get(JSON.stringify(path));
          return ungroup && register?.kind === 'hierarchy' || newer(raw.stamp, register);
        });
        accepted.push(candidate);
        recorded.push(candidate);
        Object.entries(candidate.value.records).forEach(([id, record]) => {
          if (record) available.elements.add(id);
        });
      }
      continue;
    }
    if (move) {
      if (!newer(raw.stamp, session.slideMoves.get(move.id))) continue;
      if (targetRemoved(patch, session.elementLifecycles, session.slideLifecycles)) {
        recorded.push(patch);
      } else if (!targetAvailable(doc, patch, available)) missingDependency = true;
      else {
        accepted.push(patch);
        recorded.push(patch);
      }
      continue;
    }
    if (!newer(raw.stamp, session.registers.get(pathKey(patch)))) continue;
    if (targetRemoved(patch, session.elementLifecycles, session.slideLifecycles)) {
      recorded.push(patch);
    } else if (!targetAvailable(doc, patch, available)) missingDependency = true;
    else {
      accepted.push(patch);
      recorded.push(patch);
    }
  }
  const table = rebaseTablePatches(doc, session, raw.stamp, accepted);
  return {
    accepted: table.accepted,
    recorded: [...recorded, ...table.recorded],
    missingDependency,
    availability: available,
  };
}
