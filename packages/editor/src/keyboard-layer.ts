import { slideOfElement, writableLayerSiblingIds } from '@web-ppt/edit-core';
import type { ElementId, ElementLayerTarget } from '@web-ppt/edit-core';
import type { KeyboardControllerOptions } from './keyboard-context';
import { shouldYieldKeyboardEvent } from './keyboard-owner';
import { isSelectable } from './selection-hit';
import { outermostSelectedElementIds } from './selection-roots';

function bracketKey(event: KeyboardEvent): '[' | ']' | null {
  if (event.code === 'BracketLeft') return '[';
  if (event.code === 'BracketRight') return ']';
  if (event.key === '[' || event.key === '{') return '[';
  if (event.key === ']' || event.key === '}') return ']';
  return null;
}

function layerIds(options: KeyboardControllerOptions, roots: readonly ElementId[]): ElementId[] | null {
  const doc = options.editor.doc;
  const first = doc.elements[roots[0]];
  if (!first) return null;
  const part = first.meta.origin?.part ?? null;
  if (roots.some((id) => {
    const record = doc.elements[id];
    return !record || record.parent !== first.parent || (record.meta.origin?.part ?? null) !== part;
  })) return null;
  return writableLayerSiblingIds(doc, first);
}

function commandsFor(
  roots: readonly ElementId[], layer: readonly ElementId[], to: ElementLayerTarget,
): ElementId[] {
  const selected = new Set(roots);
  const ordered = layer.filter((id) => selected.has(id));
  if (to === 'front') {
    if (layer.slice(-ordered.length).every((id, index) => id === ordered[index])) return [];
    return ordered;
  }
  if (to === 'back') {
    if (layer.slice(0, ordered.length).every((id, index) => id === ordered[index])) return [];
    return [...ordered].reverse();
  }
  const positions = new Map(layer.map((id, index) => [id, index]));
  if (to === 'forward') {
    return [...ordered].reverse().filter((id) => {
      const index = positions.get(id)!;
      return index < layer.length - 1 && !selected.has(layer[index + 1]);
    });
  }
  return ordered.filter((id) => {
    const index = positions.get(id)!;
    return index > 0 && !selected.has(layer[index - 1]);
  });
}

/** PowerPoint 层级快捷键只编排公开 SetZ；排序规则属于选区语义，不泄漏进 DOM。 */
export class LayerKeyboardController {
  constructor(private readonly options: KeyboardControllerOptions) {}

  keyDown(event: KeyboardEvent): boolean {
    const hasOnePrimary = event.ctrlKey !== event.metaKey;
    const key = bracketKey(event);
    if (event.defaultPrevented || !key
      || !hasOnePrimary || event.altKey || shouldYieldKeyboardEvent(event)) return false;
    event.preventDefault();
    if (this.options.gestureActive()) return true;
    const selection = this.options.editor.selection;
    if (selection.kind !== 'elements') return true;
    const doc = this.options.editor.doc;
    if (selection.ids.some((id) => slideOfElement(doc, id) !== this.options.slideId()
      || !isSelectable(doc, id))) return true;
    const roots = outermostSelectedElementIds(doc, selection.ids);
    const layer = layerIds(this.options, roots);
    if (!layer) return true;
    const to: ElementLayerTarget = key === ']'
      ? event.shiftKey ? 'front' : 'forward'
      : event.shiftKey ? 'back' : 'backward';
    const ids = commandsFor(roots, layer, to);
    if (!ids.length) return true;
    const labels: Record<ElementLayerTarget, string> = {
      front: '置于顶层', back: '置于底层', forward: '上移一层', backward: '下移一层',
    };
    this.options.editor.transaction((transaction) => {
      for (const id of ids) transaction.exec({ type: 'SetZ', id, to });
    }, labels[to]);
    return true;
  }
}
