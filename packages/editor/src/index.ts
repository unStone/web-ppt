export { openEditor } from './session';
export {
  elementFrameToSlideMatrix, elementFrameToSlidePoint, elementParentToSlideMatrix,
  elementParentToSlidePoint, invertSpaceMatrix, screenToSlidePoint, slideToElementFramePoint,
  slideToElementParentPoint, slideToScreenPoint, transformSpacePoint,
} from './space';
export type { EditorSession, OpenEditorOptions } from './session';
export type { EditorMode, SlideEditor, SlideEditorOptions } from './slide-editor';
export type { AffineMatrix, SlideViewport, SpacePoint } from './space';
