import { layoutText } from '@web-ppt/core';
import type { ElementId, TableCellAddress } from '@web-ppt/edit-core';
import { sameTextCell } from './text-editor-target';
import type { ActiveText } from './text-editor-types';

export interface TextAutofitTarget {
  id: ElementId;
  cell: TableCellAddress | null;
}

const targetOf = (active: ActiveText): TextAutofitTarget => ({
  id: active.id,
  cell: active.cell ? { ...active.cell } : null,
});

const sameTarget = (left: TextAutofitTarget, right: TextAutofitTarget): boolean =>
  left.id === right.id && sameTextCell(left.cell, right.cell);

function resolvedScale(active: ActiveText): number {
  return layoutText(active.text, active.width, active.height, {
    includeCarets: false,
    insets: active.insets,
    vert: active.vert,
  }).scale;
}

/** normAutofit 是视图派生状态；输入突发期不应污染可序列化文档与历史。 */
export class TextAutofitThrottle {
  private current: { target: TextAutofitTarget; scale: number } | null = null;
  private timer: number | null = null;

  constructor(private readonly view: Window) {}

  displayScale(active: ActiveText): number | undefined {
    if (!active.text.autoFitCompute || active.text.autoFitShape) {
      this.reset();
      return undefined;
    }
    const target = targetOf(active);
    if (!this.current || !sameTarget(this.current.target, target)) {
      this.cancelTimer();
      this.current = { target, scale: resolvedScale(active) };
    }
    return this.current.scale;
  }

  schedule(active: ActiveText, settle: (target: TextAutofitTarget) => void): void {
    if (!active.text.autoFitCompute || active.text.autoFitShape || this.timer !== null) return;
    const target = targetOf(active);
    this.timer = this.view.setTimeout(() => {
      this.timer = null;
      settle(target);
    }, 100);
  }

  settle(active: ActiveText, expectedTarget: TextAutofitTarget): boolean {
    if (!active.text.autoFitCompute || active.text.autoFitShape
      || !sameTarget(targetOf(active), expectedTarget)
      || !this.current || !sameTarget(this.current.target, expectedTarget)) return false;
    const scale = resolvedScale(active);
    if (scale === this.current.scale) return false;
    this.current = { target: targetOf(active), scale };
    return true;
  }

  reset(): void {
    this.cancelTimer();
    this.current = null;
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.view.clearTimeout(this.timer);
    this.timer = null;
  }
}
