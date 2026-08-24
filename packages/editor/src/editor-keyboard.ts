import { KeyboardNudgeController } from './keyboard-nudge';
import { HistoryKeyboardController } from './keyboard-history';
import { DeleteKeyboardController } from './keyboard-delete';
import { LayerKeyboardController } from './keyboard-layer';
import type { KeyboardControllerOptions } from './keyboard-context';
import { shouldYieldKeyboardEvent } from './keyboard-owner';
import { directSelectableChildIds, enteredGroupOnSlide } from './selection-hit';

/** 画布键盘路由只组合命令，元素变换与选择范围仍留在各自模块。 */
export class EditorKeyboardController {
  private readonly options: KeyboardControllerOptions;
  private readonly history: HistoryKeyboardController;
  private readonly deletion: DeleteKeyboardController;
  private readonly layer: LayerKeyboardController;
  private readonly nudge: KeyboardNudgeController;

  constructor(options: KeyboardControllerOptions) {
    this.options = options;
    this.history = new HistoryKeyboardController(options);
    this.deletion = new DeleteKeyboardController(options);
    this.layer = new LayerKeyboardController(options);
    this.nudge = new KeyboardNudgeController(options);
  }

  keyDown(event: KeyboardEvent): boolean {
    if (this.history.keyDown(event)) {
      this.nudge.breakSequence();
      return true;
    }
    if (this.deletion.keyDown(event)) {
      this.nudge.breakSequence();
      return true;
    }
    if (this.layer.keyDown(event)) {
      this.nudge.breakSequence();
      return true;
    }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey
      && !shouldYieldKeyboardEvent(event)) {
      // 活动手势必须继续持有键盘焦点，否则浏览器会把后续按键送往画布外部。
      if (this.options.gestureActive()) {
        event.preventDefault();
        return true;
      }
      const doc = this.options.editor.doc;
      const slideId = this.options.slideId();
      const selection = this.options.editor.selection;
      const enteredGroup = selection.kind === 'elements'
        ? enteredGroupOnSlide(doc, selection.enteredGroup, slideId) : null;
      const candidates = directSelectableChildIds(doc, slideId, enteredGroup);
      if (!candidates.length) return false;
      const selected = selection.kind === 'elements'
        ? selection.ids.map((id) => candidates.indexOf(id)).filter((index) => index >= 0) : [];
      const edge = selected.length
        ? event.shiftKey ? Math.min(...selected) : Math.max(...selected) : -1;
      const index = edge < 0
        ? event.shiftKey ? candidates.length - 1 : 0
        : (edge + (event.shiftKey ? -1 : 1) + candidates.length) % candidates.length;
      this.options.editor.select({ kind: 'elements', ids: [candidates[index]], enteredGroup });
      event.preventDefault();
      return true;
    }
    return this.nudge.keyDown(event);
  }

  keyUp(event: KeyboardEvent): boolean { return this.nudge.keyUp(event); }
  breakSequence(): void { this.nudge.breakSequence(); }
}
