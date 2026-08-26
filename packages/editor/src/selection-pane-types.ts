import type { ElementId, SlideId } from '@web-ppt/edit-core';
import type { EditorMode } from './slide-editor-types';

export interface SelectionPaneOptions {
  readonly slideId?: SlideId;
  readonly mode?: EditorMode;
  readonly ariaLabel?: string;
  readonly onError?: (error: unknown) => void;
}

export interface SelectionPane {
  readonly element: HTMLDivElement;
  readonly slideId: SlideId;
  readonly mode: EditorMode;
  readonly destroyed: boolean;
  setSlide(slideId: SlideId): void;
  setMode(mode: EditorMode): void;
  focusElement(id: ElementId): boolean;
  destroy(): void;
}
