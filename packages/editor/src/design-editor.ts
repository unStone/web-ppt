import { renderSlideToSvg } from '@web-ppt/core';
import { foreignObjectScalesCorrectly } from '@web-ppt/viewer-core';
import type { DesignCommand, DesignTarget, EditorChange } from '@web-ppt/edit-core';
import { bindDesignIdentities } from './dom-identity';
import type { DesignEditor, DesignEditorOptions } from './design-editor-types';
import type { EditorSession } from './session';

let designViewSerial = 0;

class DomDesignEditor implements DesignEditor {
  readonly element: HTMLDivElement;
  private currentTarget: DesignTarget;
  private isDestroyed = false;
  private readonly unsubscribe: () => void;
  private readonly idPrefix: string;
  private readonly textMode: 'html' | 'svg';
  private readonly presentation: ReturnType<EditorSession['toPresentation']>;

  constructor(
    container: HTMLElement,
    private readonly session: EditorSession,
    options: DesignEditorOptions,
  ) {
    if (session.disposed) throw new Error('不能挂载已经释放的编辑会话');
    this.currentTarget = structuredClone(options.target);
    session.editor.toDesignCanvas(this.currentTarget);
    this.idPrefix = `${session.editor.doc.identity.prefix}design-view-${++designViewSerial}-`;
    this.presentation = session.toPresentation();
    this.textMode = options.textMode === 'svg' || options.textMode === 'html'
      ? options.textMode
      : foreignObjectScalesCorrectly(container.ownerDocument) ? 'html' : 'svg';
    this.element = container.ownerDocument.createElement('div');
    this.element.dataset.pptDesignEditor = this.currentTarget.kind;
    this.element.style.position = 'relative';
    this.element.style.width = '100%';
    this.element.style.height = '100%';
    container.append(this.element);
    this.unsubscribe = session.editor.subscribe((change) => this.update(change));
    this.render();
  }

  get target(): DesignTarget { return structuredClone(this.currentTarget); }
  get destroyed(): boolean { return this.isDestroyed; }

  setTarget(target: DesignTarget): void {
    this.assertAlive();
    this.session.editor.toDesignCanvas(target);
    this.currentTarget = structuredClone(target);
    this.element.dataset.pptDesignEditor = target.kind;
    this.render();
  }

  exec(...commands: DesignCommand[]) {
    this.assertAlive();
    return this.session.editor.execDesign(this.currentTarget, ...commands);
  }

  render(): void {
    this.assertAlive();
    this.element.innerHTML = renderSlideToSvg(
      this.presentation,
      this.session.editor.toDesignCanvas(this.currentTarget),
      {
        textMode: this.textMode,
        idPrefix: `${this.idPrefix}${this.currentTarget.id}-`,
        includeEditMarkers: true,
      },
    );
    bindDesignIdentities(this.element, this.session.editor.doc, this.currentTarget);
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.unsubscribe();
    this.element.remove();
  }

  private assertAlive(): void {
    if (this.isDestroyed || this.session.disposed) throw new Error('设计视图已经销毁');
  }

  private update(change: EditorChange): void {
    if (change.source === 'selection') return;
    const doc = this.session.editor.doc;
    this.presentation.width = doc.meta.width;
    this.presentation.height = doc.meta.height;
    if (change.createdSlides.size || change.removedSlides.size || change.movedSlides.size) {
      // 来源版式可含 slide:last / slide-part 链接；只在页树变化时刷新解析上下文，版式元素热路径仍为 O(1)。
      this.presentation.slides = doc.slideOrder.map((id) => this.session.editor.toSlide(id));
    }
    this.render();
  }
}

export function createDesignEditor(
  container: HTMLElement,
  session: EditorSession,
  options: DesignEditorOptions,
): DesignEditor {
  return new DomDesignEditor(container, session, options);
}
