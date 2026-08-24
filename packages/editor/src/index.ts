export { openEditor } from './session';
export {
  elementFrameToSlideMatrix, elementFrameToSlidePoint, elementParentToSlideMatrix,
  elementParentToSlidePoint, invertSpaceMatrix, screenToSlidePoint, slideToElementFramePoint,
  slideToElementParentPoint, slideToScreenPoint, transformSpacePoint,
} from '@web-ppt/edit-core';
export type { EditorSession, OpenEditorOptions } from './session';
export type { EditorMode, SlideEditor, SlideEditorOptions } from './slide-editor';
export type { SnapMargins } from './snap';
export type { AffineMatrix, SlideViewport, SpacePoint } from '@web-ppt/edit-core';
