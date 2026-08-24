import type { ShapeElement, TextBody } from '@web-ppt/core';
import type { Editor, ElementId } from '@web-ppt/edit-core';

export interface TextEditorControllerOptions {
  editor: Editor;
  boundary: HTMLElement;
  staticLayer: HTMLElement;
  textLayer: HTMLElement;
  slideId: () => string;
  claim: () => void;
  release: () => void;
  syncStatic: (id: ElementId) => void;
}

export interface CompositionSnapshot {
  domText: string;
  modelText: string;
  from: number;
  to: number;
}

export interface ActiveText {
  id: ElementId;
  element: ShapeElement;
  text: TextBody;
}
