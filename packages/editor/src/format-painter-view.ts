import type { FormatPainter } from './format-painter-types';
import type {
  FormatPainterSnapshot, FormatPainterStartOptions, FormatPainterTarget,
} from './format-painter-types';

/** 视图绑定只投影状态与错误；格式真相仍完全属于会话控制器。 */
export class FormatPainterViewBinding {
  private readonly unsubscribe: () => void;

  constructor(
    private readonly root: HTMLElement,
    private readonly painter: FormatPainter,
    private readonly onError?: (error: unknown) => void,
  ) {
    this.unsubscribe = painter.subscribe((snapshot) => this.sync(snapshot));
    this.sync(painter.snapshot);
  }

  get active(): boolean { return this.painter.snapshot.active; }

  start(options: FormatPainterStartOptions): boolean { return this.painter.start(options); }
  apply(target: FormatPainterTarget): boolean { return this.painter.apply(target); }
  cancel(): void { this.painter.cancel(); }
  destroy(): void { this.unsubscribe(); }

  report(error: unknown): void {
    const CustomEventCtor = this.root.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
    this.root.dispatchEvent(new CustomEventCtor('webpptformaterror', { detail: error }));
    try { this.onError?.(error); } catch { /* 宿主错误观察者不能破坏格式刷状态。 */ }
  }

  private sync(snapshot: FormatPainterSnapshot): void {
    if (snapshot.active) {
      this.root.dataset.formatPainter = snapshot.mode;
      this.root.dataset.formatPainterSource = snapshot.source!.id;
    } else {
      delete this.root.dataset.formatPainter;
      delete this.root.dataset.formatPainterSource;
    }
  }
}
