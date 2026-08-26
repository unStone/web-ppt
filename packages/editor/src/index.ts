export { openEditor } from './session';
export { fingerprintSource } from './source-fingerprint';
export { RecoveryOpenCancelledError } from './recovery-store';
export { createIndexedDbRecoveryStore } from './indexeddb-recovery-store';
export {
  applyWebPptAdapterBinding, createWebPptAdapter, WEB_PPT_IDLE_SNAPSHOT,
} from './framework-adapter';
export { ELEMENT_CLIPBOARD_MIME } from './element-clipboard';
export {
  elementFrameToSlideMatrix, elementFrameToSlidePoint, elementParentToSlideMatrix,
  elementParentToSlidePoint, invertSpaceMatrix, screenToSlidePoint, slideToElementFramePoint,
  slideToElementParentPoint, slideToScreenPoint, transformSpacePoint,
  queryElementCrop, queryElementEffects, queryElementFill, queryElementLink, queryElementStroke,
  queryRunLink, querySlideBackground, querySlideHidden, querySlideLayout, querySlideNotes,
  SHAPE_PATTERN_PRESETS,
} from '@web-ppt/edit-core';
export type { EditorSession, OpenEditorOptions } from './session';
export type { WebPptSourceIdentity } from './source-fingerprint';
export type {
  EditorRecovery, RecoveryCandidate, RecoveryDecision, RecoveryDecisionHandler, RecoveryOptions,
  RecoveryStore, RecoveryStoreAppend, RecoveryStoreJournal, RecoveryStoreReset,
} from './recovery-store';
export type {
  IndexedDbRecoveryStore, IndexedDbRecoveryStoreOptions, RecoveryCleanupResult, RecoveryStoreStats,
} from './indexeddb-recovery-store';
export type {
  WebPptAdapter, WebPptAdapterBinding, WebPptAdapterCallbacks, WebPptAdapterProgress, WebPptAdapterSnapshot,
  WebPptAdapterSubscriber, WebPptDocument, WebPptSource, WebPptViewOptions, WebPptViewState,
} from './framework-adapter';
export type {
  EditorMode, LinkFollowContext, LinkFollowHandler, LinkFollowSource, SlideEditor, SlideEditorOptions,
} from './slide-editor-types';
export type { ImageInsertOptions } from './image-insertion';
export type { ImageBackgroundOptions, ImageReplaceOptions } from './image-insertion';
export type { TableInsertOptions } from './table-insertion';
export type {
  AddImageCommand, AddShapeCommand, AddTableCommand, ElementClipboardPayload, ElementCropState, ElementEffectsState, ElementFillState, ElementLinkState, ElementStrokeState, ImageCrop, LinkOverride, LinkSourceValue, LinkTarget, ParagraphProperties, ParagraphPropertiesState, ParagraphPropertyOverrides, SlideBackgroundState, SlideHiddenState, SlideLayoutState,
  RunLinkState, RunPropertiesState, RunPropertyOverrides, SlideNotesState, TextBodyAutoFit, TextBodyProperties, TextBodyPropertyOverrides,
  ReplaceImageCommand, SetBackgroundCommand, SetBackgroundCropCommand, SetBackgroundImageCommand, SetCropCommand, SetEffectsCommand, SetFillCommand, SetHiddenCommand, SetLayoutCommand, SetLinkCommand, SetStrokeCommand, StrokeCommandValue, VectorFill,
} from '@web-ppt/edit-core';
export type { EditorChange, SlideId } from '@web-ppt/edit-core';
export type { SnapMargins } from './snap';
export type { AffineMatrix, SlideViewport, SpacePoint } from '@web-ppt/edit-core';
