import { isResizeHandle } from './resize-geometry';
import type { ResizeHandle } from './resize-geometry';

function targetElement(target: EventTarget | null): Element | null {
  return target && typeof target === 'object' && (target as Node).nodeType === 1
    ? target as Element : null;
}

export function resizeHandleAt(
  target: EventTarget | null,
  interactionLayer: SVGSVGElement,
): ResizeHandle | null {
  const handle = targetElement(target)?.closest<SVGRectElement>('[data-edit-resize-handle]');
  const value = handle?.dataset.editResizeHandle;
  return handle && interactionLayer.contains(handle) && isResizeHandle(value) ? value : null;
}

export function isRotationHandleAt(target: EventTarget | null, interactionLayer: SVGSVGElement): boolean {
  const handle = targetElement(target)?.closest<SVGCircleElement>('[data-edit-rotation-handle]');
  return !!handle && interactionLayer.contains(handle);
}
