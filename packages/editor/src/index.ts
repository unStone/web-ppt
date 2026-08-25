export { openEditor } from './session';
export { ELEMENT_CLIPBOARD_MIME } from './element-clipboard';
export {
  elementFrameToSlideMatrix, elementFrameToSlidePoint, elementParentToSlideMatrix,
  elementParentToSlidePoint, invertSpaceMatrix, screenToSlidePoint, slideToElementFramePoint,
  slideToElementParentPoint, slideToScreenPoint, transformSpacePoint,
} from '@web-ppt/edit-core';
export type { EditorSession, OpenEditorOptions } from './session';
export type { EditorMode, SlideEditor, SlideEditorOptions } from './slide-editor';
export type { ImageInsertOptions } from './image-insertion';
export type { TableInsertOptions } from './table-insertion';
export type {
  AddImageCommand, AddShapeCommand, AddTableCommand, ElementClipboardPayload, ParagraphProperties, ParagraphPropertiesState, ParagraphPropertyOverrides,
  RunPropertiesState, RunPropertyOverrides, TextBodyAutoFit, TextBodyProperties, TextBodyPropertyOverrides,
} from '@web-ppt/edit-core';
export type { SnapMargins } from './snap';
export type { AffineMatrix, SlideViewport, SpacePoint } from '@web-ppt/edit-core';
