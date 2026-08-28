import { isElementInteractionPatch } from './commands/element-interaction';
import { isElementNamePatch } from './commands/element-name';
import { isElementOrderPatch } from './commands/element-order';
import { isElementHierarchyPatch } from './commands/element-hierarchy';
import { isSlideLayoutPatch } from './commands/slide-layout';
import { isSlideOrderPatch } from './commands/slide-order';
import { isSlideBackgroundPatch } from './commands/slide-property';
import { isSlideTreePatch } from './commands/slide-tree';
import type { Patch } from './commands/types';
import type { ElementId, SlideId, TextOverride } from './types';

export function patchElements(patches: readonly Patch[]): Set<ElementId> {
  return new Set(patches.flatMap((patch) => isElementHierarchyPatch(patch)
    ? patch.value.affected : patch.path[0] === 'elements' ? [patch.path[1]] : []));
}

export function affectsSlideSequence(patches: readonly Patch[]): boolean {
  return patches.some((patch) => isSlideTreePatch(patch) || isSlideOrderPatch(patch));
}

export function renderPatchSlides(patches: readonly Patch[]): Set<SlideId> {
  return new Set(patches.filter((patch) => isSlideBackgroundPatch(patch) || isSlideLayoutPatch(patch))
    .map((patch) => patch.path[1]));
}

export function renderPatchElements(
  patches: readonly Patch[], dirtyElements: ReadonlySet<ElementId> = new Set(),
): Set<ElementId> {
  const result = new Set(patches.flatMap((patch) => isElementHierarchyPatch(patch)
    ? patch.value.affected
    : patch.path[0] === 'elements' && !isElementOrderPatch(patch) && !isElementInteractionPatch(patch)
      ? [patch.path[1]] : []));
  // 页树与页序会改变字段投影，却没有元素属性 patch；必须把派生脏元素交给 DOM 增量层。
  if (affectsSlideSequence(patches)) for (const id of dirtyElements) result.add(id);
  return result;
}

export function reorderedPatchElements(patches: readonly Patch[]): Set<ElementId> {
  return new Set(patches.flatMap((patch) => isElementHierarchyPatch(patch)
    ? patch.value.affected : isElementOrderPatch(patch) ? [patch.path[1]] : []));
}

export function panePatchElements(patches: readonly Patch[]): Set<ElementId> {
  return new Set(patches.filter((patch) => isElementNamePatch(patch) || isElementInteractionPatch(patch))
    .map((patch) => patch.path[1]));
}

export const hasDocumentPatch = (patches: readonly Patch[]): boolean =>
  patches.some((patch) => !isElementInteractionPatch(patch));

export function bodyPropsPatchElements(
  forward: readonly Patch[],
  inverse: readonly Patch[],
): Set<ElementId> {
  const result = new Set<ElementId>();
  const inverseByPath = new Map(inverse.map((patch) => [JSON.stringify(patch.path), patch]));
  const textValue = (patch: Patch | undefined): TextOverride | null => {
    if (!patch || patch.op !== 'set' || !patch.value || typeof patch.value !== 'object') return null;
    const value = patch.value as unknown as TextOverride;
    return value.kind === 'flat' || value.kind === 'empty' ? value : null;
  };
  for (const patch of forward) {
    if (patch.path.length !== 4 || patch.path[0] !== 'elements' || patch.path[3] !== 'text') continue;
    const before = inverseByPath.get(JSON.stringify(patch.path));
    const forwardValue = textValue(patch);
    const inverseValue = textValue(before);
    if (JSON.stringify(forwardValue?.bodyOverrides) !== JSON.stringify(inverseValue?.bodyOverrides)) {
      result.add(patch.path[1]);
    }
  }
  return result;
}
