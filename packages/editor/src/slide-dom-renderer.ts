import { renderSlideToSvg } from '@web-ppt/core';
import type { Presentation } from '@web-ppt/core';
import type { Editor, EditorChange, ElementId, Selection, SlideId } from '@web-ppt/edit-core';
import { bindSlideIdentities, findElementPartition } from './dom-identity';
import { insertElementPartition, patchElement } from './dom-patch';
import { patchSlideDom } from './slide-dom-update';
import { renderSelectionOverlay } from './selection-overlay';
import { renderPlaceholderOverlay } from './placeholder-overlay';

interface SlideDomRendererOptions {
  presentation: Presentation;
  editor: Editor;
  staticLayer: HTMLElement;
  interactionLayer: SVGSVGElement;
  slideId: () => SlideId;
  zoom: () => number;
  idPrefix: string;
  textMode: 'html' | 'svg';
  editable: () => boolean;
}

export class SlideDomRenderer {
  constructor(private readonly options: SlideDomRendererOptions) {}

  render(selection: Selection): void {
    const { presentation, editor, staticLayer, idPrefix, textMode } = this.options;
    const slideId = this.options.slideId();
    staticLayer.innerHTML = renderSlideToSvg(
      presentation, editor.toSlide(slideId), {
        textMode, idPrefix: `${idPrefix}${slideId}-`, includeEditMarkers: true,
      },
    );
    bindSlideIdentities(staticLayer, editor.doc, slideId);
    this.renderSelection(selection);
  }

  update(change: EditorChange, deferElement: ElementId | null): void {
    const { staticLayer, editor, idPrefix, textMode } = this.options;
    const slideId = this.options.slideId();
    if (!patchSlideDom({
      staticLayer, editor, slideId, change, idPrefix, textMode, deferElement,
    })) this.render(change.selection);
    else this.renderSelection(change.selection);
  }

  syncElement(id: ElementId): void {
    const { staticLayer, editor, idPrefix, textMode } = this.options;
    const updated = findElementPartition(staticLayer, id)
      ? patchElement(staticLayer, editor, id, idPrefix, textMode)
      : insertElementPartition(staticLayer, editor, id, idPrefix, textMode);
    if (!updated) this.render(editor.selection);
  }

  renderSelection(selection: Selection): void {
    renderPlaceholderOverlay(
      this.options.interactionLayer, this.options.editor.doc, this.options.slideId(),
      this.options.zoom(), this.options.editable(),
    );
    renderSelectionOverlay(
      this.options.interactionLayer, this.options.editor.doc, selection,
      this.options.slideId(), this.options.zoom(),
    );
  }
}
