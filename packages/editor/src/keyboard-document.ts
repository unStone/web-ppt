import type { KeyboardControllerOptions } from './keyboard-context';
import { shouldYieldKeyboardEvent } from './keyboard-owner';
import { selectAllSlideElements } from './selection-all';

function hasOnePrimary(event: KeyboardEvent): boolean {
  return event.ctrlKey !== event.metaKey;
}

/** 文档级键位只组合既有选择、页面命令和视图回显，不引入第二条事件通道。 */
export class DocumentKeyboardController {
  constructor(private readonly options: KeyboardControllerOptions) {}

  keyDown(event: KeyboardEvent, textOwner = false): boolean {
    if (event.defaultPrevented || !textOwner && shouldYieldKeyboardEvent(event)) return false;
    const key = event.key.toLowerCase();
    if (!textOwner && hasOnePrimary(event) && !event.altKey && !event.shiftKey && key === 'a') {
      event.preventDefault();
      if (!this.options.gestureActive()) {
        selectAllSlideElements(this.options.editor, this.options.slideId());
      }
      return true;
    }
    if (hasOnePrimary(event) && !event.altKey && !event.shiftKey && key === 'm') {
      event.preventDefault();
      if (this.options.gestureActive()) return true;
      const doc = this.options.editor.doc;
      const slideId = this.options.slideId();
      const current = doc.slides[slideId];
      const layoutId = current?.layoutId && doc.layouts[current.layoutId]
        ? current.layoutId : doc.layoutOrder[0];
      if (doc.meta.readonly || doc.meta.source !== 'pptx' || !doc.package || !layoutId) {
        this.report(new Error('当前文档没有可用于新增页面的可写 OOXML 版式'));
        return true;
      }
      try {
        const result = this.options.editor.transaction((transaction) => {
          transaction.exec({ type: 'AddSlide', layoutId, at: { after: slideId } });
          transaction.select({ kind: 'none' });
        }, '新增幻灯片');
        const added = result.createdSlides.values().next().value;
        if (added) this.options.revealSlide(added);
      } catch (error) { this.report(error); }
      return true;
    }
    if ((event.key === 'PageUp' || event.key === 'PageDown')
      && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      if (this.options.gestureActive()) return true;
      const order = this.options.editor.doc.slideOrder;
      const current = order.indexOf(this.options.slideId());
      const delta = event.key === 'PageUp' ? -1 : 1;
      const target = order[current + delta];
      if (target) this.options.revealSlide(target);
      return true;
    }
    return false;
  }

  private report(error: unknown): void {
    if (this.options.onError) {
      try { this.options.onError(error); } catch { /* 宿主错误观察者不能破坏键盘通道。 */ }
      return;
    }
    const reporter = (globalThis as typeof globalThis & { reportError?: (reason: unknown) => void })
      .reportError;
    if (reporter) reporter(error);
    else console.error('页面快捷键执行失败', error);
  }
}
