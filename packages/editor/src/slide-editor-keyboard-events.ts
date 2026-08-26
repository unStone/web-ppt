import type { EditorSession } from './session';
import type { EditorKeyboardController } from './editor-keyboard';
import type { ElementClipboardController } from './element-clipboard';
import type { MarqueeGestureController } from './marquee-gesture';
import type { MoveGestureController } from './move-gesture';
import type { ResizeGestureController } from './resize-gesture';
import type { RotationGestureController } from './rotation-gesture';
import type { ImageCropGestureController } from './image-crop-gesture';
import type { TextEditorController } from './text-editor';
import type { SlideLinkController } from './slide-link-controller';
import type { FormatPainterViewBinding } from './format-painter-view';
import type { EditorMode } from './slide-editor-types';

interface SlideEditorKeyboardEventOptions {
  readonly session: EditorSession;
  readonly keyboard: EditorKeyboardController;
  readonly clipboard: ElementClipboardController;
  readonly marquee: MarqueeGestureController;
  readonly move: MoveGestureController;
  readonly resize: ResizeGestureController;
  readonly rotation: RotationGestureController;
  readonly crop: ImageCropGestureController;
  readonly textEditor: TextEditorController;
  readonly links: SlideLinkController;
  readonly formatPainter: FormatPainterViewBinding;
  mode(): EditorMode;
  cancelActiveGesture(): boolean;
}

/** 键盘/剪贴板事件共享焦点与 Escape 优先级，集中路由可避免视图类继续膨胀。 */
export class SlideEditorKeyboardEvents {
  constructor(private readonly options: SlideEditorKeyboardEventOptions) {}

  readonly keydown = (event: KeyboardEvent): void => {
    const o = this.options;
    if (o.mode() !== 'edit') return;
    if (event.key === 'Escape' && o.formatPainter.active) {
      o.formatPainter.cancel();
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)
      && o.links.followSelection('edit', event)) {
      event.preventDefault();
      return;
    }
    if (o.textEditor.owns(event.target)) return;
    if (o.crop.activeId && event.key === 'Enter') {
      o.crop.commitGesture();
      o.crop.exit();
      event.preventDefault();
      return;
    }
    if (o.crop.activeId && event.key === 'Escape') {
      o.crop.exit();
      event.preventDefault();
      return;
    }
    if (o.marquee.modifier(event)) event.preventDefault();
    if (o.move.modifier(event)) event.preventDefault();
    if (o.rotation.modifier(event)) event.preventDefault();
    if (o.resize.modifier(event)) event.preventDefault();
    if (o.clipboard.duplicate(event) || o.keyboard.keyDown(event)) return;
    if (event.key !== 'Escape') return;
    if (o.cancelActiveGesture()) {
      event.preventDefault();
      return;
    }
    const selection = o.session.editor.selection;
    if (selection.kind === 'elements' && selection.enteredGroup) {
      const groupId = selection.enteredGroup;
      const parent = o.session.editor.doc.elements[groupId]?.parent;
      const enteredGroup = parent && o.session.editor.doc.elements[parent]?.src.kind === 'group'
        ? parent : null;
      o.session.editor.select({ kind: 'elements', ids: [groupId], enteredGroup });
    } else {
      o.session.editor.select({ kind: 'none' });
    }
    event.preventDefault();
  };

  readonly keyup = (event: KeyboardEvent): void => {
    const o = this.options;
    if (o.mode() === 'edit' && o.marquee.modifier(event)) event.preventDefault();
    if (o.mode() === 'edit' && o.move.modifier(event)) event.preventDefault();
    if (o.mode() === 'edit' && o.rotation.modifier(event)) event.preventDefault();
    if (o.mode() === 'edit' && o.resize.modifier(event)) event.preventDefault();
    if (o.keyboard.keyUp(event)) event.preventDefault();
  };

  readonly blur = (): void => { this.options.keyboard.breakSequence(); };
  readonly copy = (event: ClipboardEvent): void => { this.options.clipboard.copy(event); };
  readonly cut = (event: ClipboardEvent): void => { this.options.clipboard.cut(event); };
  readonly paste = (event: ClipboardEvent): void => { this.options.clipboard.paste(event); };
}
