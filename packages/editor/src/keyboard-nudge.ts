import { slideOfElement } from '@web-ppt/edit-core';
import type { KeyboardControllerOptions } from './keyboard-context';
import { nativeControlOwnsKeyboard } from './keyboard-owner';
import { isSelectable } from './selection-hit';
import { outermostSelectedElementIds } from './selection-roots';
import { elementParentToSlideMatrix, inverseTransformSpaceVector } from './space';

const ARROW_DELTA: Readonly<Record<string, { x: number; y: number }>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

interface ActiveHold {
  id: number;
  time: number;
}

export class KeyboardNudgeController {
  private readonly options: KeyboardControllerOptions;
  private readonly activeHolds = new Map<string, ActiveHold>();
  private nextHold = 0;

  constructor(options: KeyboardControllerOptions) {
    this.options = options;
  }

  keyDown(event: KeyboardEvent): boolean {
    const direction = ARROW_DELTA[event.key];
    if (!direction || event.ctrlKey || event.metaKey || event.altKey
      || nativeControlOwnsKeyboard(event)) return false;
    if (this.options.gestureActive()) {
      event.preventDefault();
      return true;
    }
    const selection = this.options.editor.selection;
    if (selection.kind !== 'elements') return false;
    const doc = this.options.editor.doc;
    if (selection.ids.some((id) => slideOfElement(doc, id) !== this.options.slideId()
      || !isSelectable(doc, id))) return false;
    const roots = outermostSelectedElementIds(doc, selection.ids);
    let hold = this.activeHolds.get(event.key);
    if (!hold) {
      hold = { id: ++this.nextHold, time: Date.now() };
      this.activeHolds.set(event.key, hold);
    }
    const distance = event.shiftKey ? 10 : 1;
    const worldDelta = { x: direction.x * distance, y: direction.y * distance };
    const positions = roots.map((id) => {
      const source = this.options.editor.effectiveElement(id);
      const parentDelta = inverseTransformSpaceVector(elementParentToSlideMatrix(doc, id), worldDelta);
      return { id, x: source.x + parentDelta.x, y: source.y + parentDelta.y };
    });
    this.options.editor.transaction((transaction) => {
      for (const position of positions) transaction.exec({ type: 'SetXfrm', ...position });
    }, '微移元素', {
      mergeKey: `keyboard-nudge:${this.options.namespace}:${hold.id}:${event.key}:${roots.join(',')}`,
      time: hold.time,
    });
    event.preventDefault();
    return true;
  }

  keyUp(event: KeyboardEvent): boolean {
    return !!ARROW_DELTA[event.key] && this.activeHolds.delete(event.key);
  }

  breakSequence(): void {
    this.activeHolds.clear();
  }
}
