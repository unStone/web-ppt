import type { ElementId } from '@web-ppt/edit-core';

interface SelectionModifiers {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export function selectionModifierActive(modifiers: SelectionModifiers): boolean {
  return modifiers.shiftKey || modifiers.ctrlKey || modifiers.metaKey;
}

/** 结果始终服从当前作用域绘制顺序，点击先后不成为隐藏的主元素。 */
export function combineSelectionIds(
  scope: readonly ElementId[],
  prior: readonly ElementId[],
  affected: readonly ElementId[],
  toggle: boolean,
): ElementId[] {
  const affectedSet = new Set(affected);
  if (!toggle) return scope.filter((id) => affectedSet.has(id));
  const scopeSet = new Set(scope);
  const priorSet = new Set(prior);
  const selected = new Set(scope.filter((id) => priorSet.has(id)));
  for (const id of affectedSet) {
    if (!scopeSet.has(id)) continue;
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  }
  return scope.filter((id) => selected.has(id));
}
