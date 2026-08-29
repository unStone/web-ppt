import type { CustomGeometry } from '@web-ppt/core';
import type { ElementId } from '@web-ppt/edit-core';
import type { EditorSession } from '../session';
import type { SlideEditor } from '../slide-editor-types';

export interface VertexEditorOptions {
  onError?: (error: unknown) => void;
}

export interface VertexEditor {
  readonly elementId: ElementId | null;
  readonly geometry: CustomGeometry | null;
  readonly destroyed: boolean;
  /** 省略 id 时只接受当前单元素选区；预设形状必须先显式 convert。 */
  start(id?: ElementId): boolean;
  end(): void;
  convert(id?: ElementId): boolean;
  setClosed(pathId: string, closed: boolean): void;
  setSegmentType(pathId: string, commandId: string, type: 'line' | 'cubic'): void;
  refresh(): void;
  destroy(): void;
}

export type VertexEditorFactory = (
  session: EditorSession,
  view: SlideEditor,
  options?: VertexEditorOptions,
) => VertexEditor;
