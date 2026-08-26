import type { EditorSession } from './session';
import type { EditorMode } from './slide-editor-types';
import type { WebPptFormatPainterState } from './framework-adapter-types';
import type { FormatPainterStartOptions } from './format-painter-types';

const IDLE: WebPptFormatPainterState = Object.freeze({
  active: false, mode: 'inactive', source: null, readonly: true,
});

/** adapter 只桥接会话控制器；状态机仍由 EditorSession 独占。 */
export class AdapterFormatPainterBinding {
  private session: EditorSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private previous: WebPptFormatPainterState = IDLE;

  bind(session: EditorSession, changed: () => void): void {
    this.release();
    this.session = session;
    this.unsubscribe = session.formatPainter.subscribe(changed);
  }

  release(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session = null;
    this.previous = IDLE;
  }

  start(options: FormatPainterStartOptions): boolean {
    return this.session?.formatPainter.start(options) ?? false;
  }

  cancel(): void { this.session?.formatPainter.cancel(); }

  state(ready: boolean, mode: EditorMode): WebPptFormatPainterState {
    const state = this.session?.formatPainter.snapshot ?? IDLE;
    const readonly = !ready || !this.session || this.session.editor.doc.meta.readonly
      || mode !== 'edit';
    if (this.previous.active === state.active && this.previous.mode === state.mode
      && this.previous.source === state.source && this.previous.readonly === readonly) {
      return this.previous;
    }
    this.previous = { active: state.active, mode: state.mode, source: state.source, readonly };
    return this.previous;
  }
}
