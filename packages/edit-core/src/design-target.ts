import type { EditDoc, DesignTarget, ElementId, SlideId } from './types';

export type CanvasTarget = { readonly kind: 'slide'; readonly id: SlideId } | DesignTarget;

export function assertDesignTarget(doc: EditDoc, target: DesignTarget): void {
  if (!target || typeof target !== 'object'
    || Object.getPrototypeOf(target) !== Object.prototype || typeof target.id !== 'string' || !target.id
    || target.kind === 'layout' && !doc.layouts[target.id]
    || target.kind === 'master' && !doc.masters[target.id]
    || target.kind !== 'layout' && target.kind !== 'master') {
    throw new Error(`找不到设计目标：${String(target?.id)}`);
  }
}

export function canvasTargetOfElement(doc: EditDoc, id: ElementId): CanvasTarget {
  let current = doc.elements[id];
  const seen = new Set<ElementId>();
  while (current) {
    if (seen.has(current.id)) throw new Error(`元素父链成环：${current.id}`);
    seen.add(current.id);
    if (doc.slides[current.parent]) return { kind: 'slide', id: current.parent };
    if (doc.layouts[current.parent]) return { kind: 'layout', id: current.parent };
    if (doc.masters[current.parent]) return { kind: 'master', id: current.parent };
    current = doc.elements[current.parent];
  }
  throw new Error(`元素 ${id} 的父链没有画布根`);
}

export function canvasChildren(doc: EditDoc, target: CanvasTarget): ElementId[] {
  const root = target.kind === 'slide' ? doc.slides[target.id]
    : target.kind === 'layout' ? doc.layouts[target.id] : doc.masters[target.id];
  if (!root) throw new Error(`找不到${target.kind === 'slide' ? '页面' : '设计'}画布：${target.id}`);
  return root.children;
}

export function isCanvasRoot(doc: EditDoc, id: string): boolean {
  return !!doc.slides[id] || !!doc.layouts[id] || !!doc.masters[id];
}

export function sameCanvas(left: CanvasTarget, right: CanvasTarget): boolean {
  return left.kind === right.kind && left.id === right.id;
}
