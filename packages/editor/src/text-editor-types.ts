import type { TextBody, TextVert } from '@web-ppt/core';
import type { AffineMatrix, Editor, ElementId, TableCellAddress } from '@web-ppt/edit-core';

export interface TextEditorControllerOptions {
  editor: Editor;
  boundary: HTMLElement;
  staticLayer: HTMLElement;
  textLayer: HTMLElement;
  textLayout: 'browser' | 'engine';
  slideId: () => string;
  claim: () => void;
  release: () => void;
  syncStatic: (id: ElementId) => void;
  selectAllElements: () => void;
  documentKeyDown: (event: KeyboardEvent) => boolean;
}

export interface CompositionSnapshot {
  domText: string;
  modelText: string;
  from: number;
  to: number;
}

export interface ActiveText {
  id: ElementId;
  cell?: TableCellAddress;
  text: TextBody;
  width: number;
  height: number;
  matrix: AffineMatrix;
  insets?: readonly [number, number, number, number];
  anchor?: TextBody['anchor'];
  vert?: TextVert;
}
