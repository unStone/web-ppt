import type { Editor, ElementId, Selection, SlideId } from '@web-ppt/edit-core';
import { ImageInsertionController } from './image-insertion';
import { shouldYieldPointerEvent } from './keyboard-owner';
import type { MarqueeGestureController } from './marquee-gesture';
import type { MoveGestureController } from './move-gesture';
import type { ResizeGestureController } from './resize-gesture';
import type { RotationGestureController } from './rotation-gesture';
import { combineSelectionIds, selectionModifierActive } from './selection-combine';
import { isRotationHandleAt, resizeHandleAt } from './selection-handles';
import {
  alternateSelectableElementId, directSelectableChildIds, enteredGroupOnSlide, isSelectable,
  outermostHitCandidate, tableCellAddressFromPath,
} from './selection-hit';
import type { TextEditorController } from './text-editor';
import type { ImageCropGestureController } from './image-crop-gesture';
import type { FormatPainterTarget } from './format-painter-types';

interface SlidePointerControllerOptions {
  readonly editor: Editor;
  readonly root: HTMLElement;
  readonly staticLayer: HTMLElement;
  readonly interactionLayer: SVGSVGElement;
  readonly textEditor: TextEditorController;
  readonly imageInsertion: ImageInsertionController;
  readonly marquee: MarqueeGestureController;
  readonly move: MoveGestureController;
  readonly resize: ResizeGestureController;
  readonly rotation: RotationGestureController;
  readonly crop: ImageCropGestureController;
  editable(): boolean;
  slideId(): SlideId;
  hitCandidates(path: EventTarget[]): ElementId[];
  formatPainter: {
    active(): boolean;
    apply(target: FormatPainterTarget): boolean;
    error(error: unknown): void;
  };
}

/** 统一路由画布 pointer 命中；视图生命周期类只负责装配控制器。 */
export class SlidePointerController {
  private readonly options: SlidePointerControllerOptions;

  constructor(options: SlidePointerControllerOptions) { this.options = options; }

  readonly down = (event: PointerEvent): void => {
    const o = this.options;
    if (!o.editable() || event.button !== 0 || event.isPrimary === false) return;
    if (shouldYieldPointerEvent(event) || o.textEditor.owns(event.target)) return;
    if (o.textEditor.isActive) o.textEditor.close(false);
    if (o.formatPainter.active()) {
      this.applyFormat(event);
      return;
    }
    const cropHandle = o.crop.handleAt(event.target);
    if (cropHandle) {
      o.move.cancel(); o.resize.cancel(); o.rotation.cancel(); o.marquee.cancel();
      o.crop.begin(event, cropHandle);
      event.preventDefault();
      o.root.focus({ preventScroll: true });
      return;
    }
    if (isRotationHandleAt(event.target, o.interactionLayer)) {
      const selection = o.editor.selection;
      if (selection.kind === 'elements'
        && selection.ids.every((id) => isSelectable(o.editor.doc, id))) {
        o.move.cancel();
        o.resize.cancel();
        o.marquee.cancel();
        o.rotation.begin(event, selection.ids);
      }
      event.preventDefault();
      o.root.focus({ preventScroll: true });
      return;
    }
    o.rotation.cancel();
    const resizeHandle = resizeHandleAt(event.target, o.interactionLayer);
    if (resizeHandle) {
      const selection = o.editor.selection;
      if (selection.kind === 'elements'
        && selection.ids.every((id) => isSelectable(o.editor.doc, id))) {
        o.move.cancel();
        o.marquee.cancel();
        o.resize.begin(event, resizeHandle, selection.ids);
      }
      event.preventDefault();
      o.root.focus({ preventScroll: true });
      return;
    }
    o.resize.cancel();
    const candidates = o.hitCandidates(event.composedPath());
    if (o.crop.activeId) {
      if (candidates.includes(o.crop.activeId)) {
        event.preventDefault();
        o.root.focus({ preventScroll: true });
        return;
      }
      o.crop.exit();
    }
    const selection = o.editor.selection;
    const enteredGroup = enteredGroupOnSlide(
      o.editor.doc, selection.kind === 'elements' ? selection.enteredGroup : null, o.slideId(),
    );
    const togglesSelection = selectionModifierActive(event);
    const id = this.pointedElement(event, candidates, enteredGroup, selection, togglesSelection);
    const keepsSelection = id && !event.altKey && !togglesSelection && selection.kind === 'elements'
      && selection.ids.includes(id);
    if (!id) {
      o.move.cancel();
      o.marquee.begin(event, enteredGroup);
      event.preventDefault();
      o.root.focus({ preventScroll: true });
      return;
    }
    o.marquee.cancel();
    if (!keepsSelection) {
      const scope = directSelectableChildIds(o.editor.doc, o.slideId(), enteredGroup);
      const ids = combineSelectionIds(
        scope, selection.kind === 'elements' ? selection.ids : [], [id], togglesSelection,
      );
      o.editor.select(ids.length ? { kind: 'elements', ids, enteredGroup } : { kind: 'none' });
    }
    const nextSelection = o.editor.selection;
    if ((!event.altKey || togglesSelection) && nextSelection.kind === 'elements'
      && nextSelection.ids.includes(id)
      && nextSelection.ids.every((selectedId) => isSelectable(o.editor.doc, selectedId))) {
      o.move.begin(event, nextSelection.ids);
    }
    event.preventDefault();
    o.root.focus({ preventScroll: true });
  };

  private applyFormat(event: PointerEvent): void {
    const o = this.options;
    o.move.cancel(); o.resize.cancel(); o.rotation.cancel(); o.marquee.cancel();
    const selection = o.editor.selection;
    const enteredGroup = enteredGroupOnSlide(
      o.editor.doc, selection.kind === 'elements' ? selection.enteredGroup : null, o.slideId(),
    );
    const candidates = o.hitCandidates(event.composedPath());
    const id = this.pointedElement(
      event, candidates, enteredGroup, selection, selectionModifierActive(event),
    );
    if (id) {
      const cell = tableCellAddressFromPath(event.composedPath(), o.staticLayer);
      try {
        if (o.formatPainter.apply({ id, ...(cell ? { cell } : {}) })) {
          o.editor.select({ kind: 'elements', ids: [id], enteredGroup });
        }
      } catch (error) {
        o.formatPainter.error(error);
      }
    }
    event.preventDefault();
    o.root.focus({ preventScroll: true });
  }

  private pointedElement(
    event: PointerEvent,
    candidates: ElementId[],
    enteredGroup: ElementId | null,
    selection: Selection,
    togglesSelection: boolean,
  ): ElementId | undefined {
    const o = this.options;
    return event.altKey
      ? alternateSelectableElementId(
        o.editor.doc,
        o.root.ownerDocument.elementsFromPoint?.(event.clientX, event.clientY) ?? [],
        o.staticLayer,
        enteredGroup,
        selection,
        togglesSelection,
      )
      : outermostHitCandidate(o.editor.doc, candidates, enteredGroup);
  }

  readonly move = (event: PointerEvent): void => {
    this.options.marquee.move(event);
    this.options.rotation.move(event);
    this.options.resize.move(event);
    this.options.crop.move(event);
    this.options.move.move(event);
  };

  readonly up = (event: PointerEvent): void => {
    this.options.marquee.finish(event);
    this.options.rotation.finish(event);
    this.options.resize.finish(event);
    this.options.crop.finish(event);
    this.options.move.finish(event);
  };

  readonly cancel = (event: PointerEvent): void => {
    this.options.marquee.cancelPointer(event);
    this.options.rotation.cancelPointer(event);
    this.options.resize.cancelPointer(event);
    this.options.crop.cancelPointer(event);
    this.options.move.cancelPointer(event);
  };

  readonly doubleClick = (event: MouseEvent): void => {
    const o = this.options;
    if (!o.editable()) return;
    const candidates = o.hitCandidates(event.composedPath());
    const selection = o.editor.selection;
    const enteredGroup = enteredGroupOnSlide(
      o.editor.doc, selection.kind === 'elements' ? selection.enteredGroup : null, o.slideId(),
    );
    const textId = outermostHitCandidate(o.editor.doc, candidates, enteredGroup);
    const cell = tableCellAddressFromPath(event.composedPath(), o.staticLayer);
    const picture = textId && o.editor.doc.elements[textId]?.meta.ph?.type === 'pic'
      ? o.editor.doc.elements[textId] : null;
    if (picture) {
      const element = o.editor.effectiveElement(picture.id);
      o.editor.select({ kind: 'elements', ids: [picture.id], enteredGroup });
      void o.imageInsertion.choose({
        placeholderId: picture.id,
        rect: { x: element.x, y: element.y, w: element.w, h: element.h },
      }).catch(() => { /* 错误已作为 webpptimageerror 事件交给宿主。 */ });
      event.preventDefault();
      return;
    }
    const image = textId && o.editor.doc.elements[textId]?.src.kind === 'image'
      ? o.editor.doc.elements[textId] : null;
    if (image && o.crop.enter(image.id)) {
      event.preventDefault();
      return;
    }
    if (textId && (cell ? o.textEditor.enterCell(textId, cell) : o.textEditor.enter(textId))) {
      event.preventDefault();
      return;
    }
    if (selection.kind !== 'elements' || selection.ids.length !== 1) return;
    const groupId = selection.ids[0];
    const groupIndex = candidates.indexOf(groupId);
    if (groupIndex < 1 || o.editor.doc.elements[groupId]?.src.kind !== 'group') return;
    const id = outermostHitCandidate(o.editor.doc, candidates.slice(0, groupIndex), groupId);
    if (!id) return;
    o.editor.select({ kind: 'elements', ids: [id], enteredGroup: groupId });
    event.preventDefault();
  };
}
