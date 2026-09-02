import type { GeomSpec } from '@web-ppt/core';
import type { PresetAdjustmentHandle } from '@web-ppt/core/geometry/handles';
import type { ElementId } from '@web-ppt/edit-core';
import type { EditorSession } from '../session';
import type { SlideEditor } from '../slide-editor-types';

export interface PresetAdjustmentEditorOptions {
  onError?: (error: unknown) => void;
}

export interface PresetAdjustmentEditor {
  readonly elementId: ElementId | null;
  readonly geometry: GeomSpec | null;
  readonly handles: readonly PresetAdjustmentHandle[];
  readonly destroyed: boolean;
  /** 省略 id 时只接受当前单元素选区；无手柄预设也能进入并显示为空。 */
  start(id?: ElementId): boolean;
  end(): void;
  /** 切换后保留当前目标；没有活动目标时使用当前单元素选区。 */
  setPreset(preset: string): boolean;
  refresh(): void;
  destroy(): void;
}

export type PresetAdjustmentEditorFactory = (
  session: EditorSession,
  view: SlideEditor,
  options?: PresetAdjustmentEditorOptions,
) => PresetAdjustmentEditor;
