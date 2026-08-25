export { openEditor } from './session';
export { ELEMENT_CLIPBOARD_MIME } from './element-clipboard';
export {
  elementFrameToSlideMatrix, elementFrameToSlidePoint, elementParentToSlideMatrix,
  elementParentToSlidePoint, invertSpaceMatrix, screenToSlidePoint, slideToElementFramePoint,
  slideToElementParentPoint, slideToScreenPoint, transformSpacePoint,
  queryElementFill, queryElementStroke, SHAPE_PATTERN_PRESETS,
} from '@web-ppt/edit-core';
export type { EditorSession, OpenEditorOptions } from './session';
export type { EditorMode, SlideEditor, SlideEditorOptions } from './slide-editor';
export type { ImageInsertOptions } from './image-insertion';
export type { TableInsertOptions } from './table-insertion';
export type {
  AddImageCommand, AddShapeCommand, AddTableCommand, ElementClipboardPayload, ElementFillState, ElementStrokeState, ParagraphProperties, ParagraphPropertiesState, ParagraphPropertyOverrides,
  RunPropertiesState, RunPropertyOverrides, TextBodyAutoFit, TextBodyProperties, TextBodyPropertyOverrides,
  SetFillCommand, SetStrokeCommand, StrokeCommandValue, VectorFill,
} from '@web-ppt/edit-core';
export type { SnapMargins } from './snap';
export type { AffineMatrix, SlideViewport, SpacePoint } from '@web-ppt/edit-core';
