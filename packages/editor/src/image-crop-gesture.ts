import {
  elementFrameToSlidePoint, screenToSlidePoint, slideOfElement, slideToElementFramePoint,
} from '@web-ppt/edit-core';
import type { Editor, ElementId, ImageCrop, Selection, SlideId, SpacePoint } from '@web-ppt/edit-core';
import { PointerGestureLifecycle } from './pointer-gesture';
import type { PointerGestureSnapshot } from './pointer-gesture';
import { RESIZE_HANDLES } from './resize-geometry';
import type { ResizeHandle } from './resize-geometry';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_VISIBLE = 1 / 100000;
const ZERO_CROP: ImageCrop = { l: 0, t: 0, r: 0, b: 0 };

interface ImageCropGestureOptions {
  root: HTMLElement;
  stage: HTMLElement;
  interactionLayer: SVGSVGElement;
  editor: Editor;
  editable(): boolean;
  slideId(): SlideId;
  zoom(): number;
  renderSelection(): void;
}

interface CropSession {
  id: ElementId;
  handle: ResizeHandle;
  source: ImageCrop;
}

type Corners = [SpacePoint, SpacePoint, SpacePoint, SpacePoint];
interface LocalBounds { left: number; top: number; right: number; bottom: number }

const svg = <K extends keyof SVGElementTagNameMap>(document: Document, name: K) =>
  document.createElementNS(SVG_NS, name);
const midpoint = (left: SpacePoint, right: SpacePoint): SpacePoint => ({
  x: (left.x + right.x) / 2, y: (left.y + right.y) / 2,
});
const handlePoints = (corners: Corners): SpacePoint[] => [
  corners[0], midpoint(corners[0], corners[1]), corners[1], midpoint(corners[1], corners[2]),
  corners[2], midpoint(corners[2], corners[3]), corners[3], midpoint(corners[3], corners[0]),
];
const pointsAttribute = (corners: Corners): string =>
  corners.map((point) => `${point.x},${point.y}`).join(' ');
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

function sourceBounds(editor: Editor, id: ElementId, crop: ImageCrop): LocalBounds {
  const image = editor.effectiveElement(id);
  const width = image.w / (1 - crop.l - crop.r);
  const height = image.h / (1 - crop.t - crop.b);
  return {
    left: -crop.l * width, top: -crop.t * height,
    right: (1 - crop.l) * width, bottom: (1 - crop.t) * height,
  };
}

function boundsCorners(editor: Editor, id: ElementId, bounds: LocalBounds): Corners {
  const { left, top, right, bottom } = bounds;
  return [
    { x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom },
  ].map((point) => elementFrameToSlidePoint(editor.doc, id, point)) as Corners;
}

function sourceCorners(editor: Editor, id: ElementId, crop: ImageCrop): Corners {
  return boundsCorners(editor, id, sourceBounds(editor, id, crop));
}

function cropCorners(
  editor: Editor,
  id: ElementId,
  crop: ImageCrop,
  source: ImageCrop,
): Corners {
  const bounds = sourceBounds(editor, id, source);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  return boundsCorners(editor, id, {
    left: bounds.left + crop.l * width,
    top: bounds.top + crop.t * height,
    right: bounds.left + (1 - crop.r) * width,
    bottom: bounds.top + (1 - crop.b) * height,
  });
}

function positionRect(rect: SVGRectElement, point: SpacePoint, size: number): void {
  rect.setAttribute('x', String(point.x - size / 2));
  rect.setAttribute('y', String(point.y - size / 2));
  rect.setAttribute('width', String(size));
  rect.setAttribute('height', String(size));
}

function updateOverlay(group: SVGGElement, source: Corners, crop: Corners, zoom: number): void {
  group.querySelector<SVGPolygonElement>('[data-edit-crop-source-frame]')
    ?.setAttribute('points', pointsAttribute(source));
  group.querySelector<SVGPolygonElement>('[data-edit-crop-frame]')
    ?.setAttribute('points', pointsAttribute(crop));
  const visualSize = 8 / zoom;
  const hitSize = 16 / zoom;
  const strokeWidth = 1.5 / zoom;
  const positions = handlePoints(crop);
  RESIZE_HANDLES.forEach((handle, index) => {
    const visual = group.querySelector<SVGRectElement>(`[data-edit-crop-handle="${handle}"]`);
    const hit = group.querySelector<SVGRectElement>(`[data-edit-crop-hit="${handle}"]`);
    if (visual) {
      positionRect(visual, positions[index], visualSize);
      visual.setAttribute('stroke-width', String(strokeWidth));
    }
    if (hit) positionRect(hit, positions[index], hitSize);
  });
}

/** 双矩形裁剪模式独占 interaction 层；静态图片只在模型提交后增量换代。 */
export class ImageCropGestureController {
  private readonly options: ImageCropGestureOptions;
  private readonly lifecycle: PointerGestureLifecycle;
  private currentId: ElementId | null = null;

  constructor(options: ImageCropGestureOptions) {
    this.options = options;
    this.lifecycle = new PointerGestureLifecycle(options.root);
  }

  get activeId(): ElementId | null { return this.currentId; }
  get isGestureActive(): boolean { return this.lifecycle.isActive; }

  enter(id: ElementId): boolean {
    const record = this.options.editor.doc.elements[id];
    const image = record && this.options.editor.effectiveElement(id);
    if (!this.options.editable() || !record || image.kind !== 'image' || image.media
      || record.meta.editable !== 'full' || record.meta.locked
      || slideOfElement(this.options.editor.doc, id) !== this.options.slideId()) return false;
    this.lifecycle.cancel();
    this.currentId = id;
    const selection = this.options.editor.selection;
    if (selection.kind !== 'elements' || selection.ids.length !== 1 || selection.ids[0] !== id) {
      this.options.editor.select({
        kind: 'elements', ids: [id],
        enteredGroup: selection.kind === 'elements' ? selection.enteredGroup : null,
      });
    }
    this.render();
    return true;
  }

  exit(): void {
    if (!this.currentId) return;
    this.lifecycle.cancel();
    this.currentId = null;
    this.removeOverlay();
    this.options.renderSelection();
  }

  destroy(): void {
    this.lifecycle.cancel();
    this.currentId = null;
    this.removeOverlay();
  }

  cancelGesture(): void { this.lifecycle.cancel(); }
  commitGesture(): boolean { return this.lifecycle.commit(); }

  sync(selection: Selection): void {
    const id = this.currentId;
    if (!id) return;
    if (!this.options.editable() || !this.options.editor.doc.elements[id]
      || slideOfElement(this.options.editor.doc, id) !== this.options.slideId()
      || selection.kind !== 'elements' || selection.ids.length !== 1 || selection.ids[0] !== id) {
      this.exit();
      return;
    }
    this.render();
  }

  handleAt(target: EventTarget | null): ResizeHandle | null {
    const element = target instanceof this.options.root.ownerDocument.defaultView!.Element
      ? target.closest<SVGElement>('[data-edit-crop-hit]') : null;
    if (!element || !this.options.interactionLayer.contains(element)) return null;
    const handle = element.dataset.editCropHit;
    return RESIZE_HANDLES.includes(handle as ResizeHandle) ? handle as ResizeHandle : null;
  }

  begin(event: PointerEvent, handle: ResizeHandle): void {
    const id = this.currentId;
    if (!id) return;
    const image = this.options.editor.effectiveElement(id);
    if (image.kind !== 'image') return;
    const session: CropSession = { id, handle, source: structuredClone(image.crop ?? ZERO_CROP) };
    this.lifecycle.begin(event, {
      cursor: (event.target as SVGElement | null)?.style.cursor || 'crosshair',
      dataset: { name: 'imageCropState', value: handle },
      start: () => {},
      frame: (snapshot) => this.preview(session, snapshot),
      finish: (snapshot) => this.commit(session, snapshot),
      clear: () => this.renderCrop(session.source, session.source),
    });
  }

  move(event: PointerEvent): void { this.lifecycle.move(event); }
  finish(event: PointerEvent): void { this.lifecycle.finish(event); }
  cancelPointer(event: PointerEvent): void { this.lifecycle.cancelPointer(event); }

  private toLocal(id: ElementId, screen: SpacePoint): SpacePoint {
    const rect = this.options.stage.getBoundingClientRect();
    const slide = screenToSlidePoint(screen, {
      left: rect.left, top: rect.top, zoom: this.options.zoom(),
    });
    return slideToElementFramePoint(this.options.editor.doc, id, slide);
  }

  private proposal(session: CropSession, snapshot: PointerGestureSnapshot): ImageCrop {
    const point = this.toLocal(session.id, snapshot.screen);
    const bounds = sourceBounds(this.options.editor, session.id, session.source);
    const sourceWidth = bounds.right - bounds.left;
    const sourceHeight = bounds.bottom - bounds.top;
    let left = session.source.l;
    let top = session.source.t;
    let right = 1 - session.source.r;
    let bottom = 1 - session.source.b;
    if (session.handle.includes('w')) {
      left = clamp((point.x - bounds.left) / sourceWidth, 0, right - MIN_VISIBLE);
    }
    if (session.handle.includes('e')) {
      right = clamp((point.x - bounds.left) / sourceWidth, left + MIN_VISIBLE, 1);
    }
    if (session.handle.includes('n')) {
      top = clamp((point.y - bounds.top) / sourceHeight, 0, bottom - MIN_VISIBLE);
    }
    if (session.handle.includes('s')) {
      bottom = clamp((point.y - bounds.top) / sourceHeight, top + MIN_VISIBLE, 1);
    }
    return { l: left, t: top, r: 1 - right, b: 1 - bottom };
  }

  private preview(session: CropSession, snapshot: PointerGestureSnapshot): void {
    this.renderCrop(this.proposal(session, snapshot), session.source);
  }

  private commit(session: CropSession, snapshot: PointerGestureSnapshot): (() => void) | null {
    const crop = this.proposal(session, snapshot);
    if (JSON.stringify(crop) === JSON.stringify(session.source)) return null;
    return () => this.options.editor.transaction((transaction) => {
      transaction.exec({ type: 'SetCrop', id: session.id, crop });
    }, '裁剪图片');
  }

  private render(): void {
    const id = this.currentId;
    if (!id) return;
    this.options.interactionLayer.querySelector('[data-edit-selection-ids]')?.remove();
    this.removeOverlay();
    const document = this.options.root.ownerDocument;
    const group = svg(document, 'g');
    group.dataset.editCropId = id;
    group.setAttribute('aria-hidden', 'true');
    group.style.pointerEvents = 'none';
    const source = svg(document, 'polygon');
    source.dataset.editCropSourceFrame = '';
    source.setAttribute('fill', 'none');
    source.setAttribute('stroke', '#64748b');
    source.setAttribute('stroke-width', String(1 / this.options.zoom()));
    source.setAttribute('stroke-dasharray', `${5 / this.options.zoom()} ${4 / this.options.zoom()}`);
    group.append(source);
    const frame = svg(document, 'polygon');
    frame.dataset.editCropFrame = '';
    frame.setAttribute('fill', 'none');
    frame.setAttribute('stroke', '#2563eb');
    frame.setAttribute('stroke-width', String(1.5 / this.options.zoom()));
    group.append(frame);
    for (const handle of RESIZE_HANDLES) {
      const hit = svg(document, 'rect');
      hit.dataset.editCropHit = handle;
      hit.setAttribute('fill', 'transparent');
      hit.style.pointerEvents = 'all';
      hit.style.cursor = `${handle}-resize`;
      group.append(hit);
      const visual = svg(document, 'rect');
      visual.dataset.editCropHandle = handle;
      visual.setAttribute('fill', '#111827');
      visual.setAttribute('stroke', '#fff');
      group.append(visual);
    }
    this.options.interactionLayer.append(group);
    const image = this.options.editor.effectiveElement(id);
    const crop = image.kind === 'image' ? image.crop ?? ZERO_CROP : ZERO_CROP;
    this.renderCrop(crop, crop);
  }

  private renderCrop(crop: ImageCrop, source: ImageCrop): void {
    const id = this.currentId;
    const group = id && this.options.interactionLayer
      .querySelector<SVGGElement>(`[data-edit-crop-id="${id}"]`);
    if (id && group) updateOverlay(
      group,
      sourceCorners(this.options.editor, id, source),
      cropCorners(this.options.editor, id, crop, source),
      this.options.zoom(),
    );
  }

  private removeOverlay(): void {
    for (const node of [...this.options.interactionLayer.querySelectorAll('[data-edit-crop-id]')]) {
      node.remove();
    }
  }
}
