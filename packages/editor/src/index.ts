export { openEditor } from './session';
export { createSelectionPane } from './selection-pane';
export { fingerprintSource } from './source-fingerprint';
export { RecoveryOpenCancelledError } from './recovery-store';
export { createIndexedDbRecoveryStore } from './indexeddb-recovery-store';
export {
  createWebPptAdapter,
} from './framework-adapter';
export { applyWebPptAdapterBinding } from './framework-adapter-binding';
export { WEB_PPT_IDLE_SNAPSHOT } from './framework-adapter-state';
export { ELEMENT_CLIPBOARD_MIME } from './element-clipboard';
export {
  elementFrameToSlideMatrix, elementFrameToSlidePoint, elementParentToSlideMatrix,
  elementParentToSlidePoint, invertSpaceMatrix, screenToSlidePoint, slideToElementFramePoint,
  slideToElementParentPoint, slideToScreenPoint, transformSpacePoint,
  queryElementCrop, queryElementEffects, queryElementFill, queryElementLink, queryElementStroke,
  queryElementPresetGeometry, queryParaProps, queryRunLink, queryRunProps, queryTableGrid,
  querySlideBackground, querySlideHidden, querySlideLayout, querySlideNotes,
  listSections, queryElementAltText, querySlideAnimations, querySlideSize, querySlideTransition,
  sectionOfSlide, ANIMATION_EFFECTS, MAX_ANIMATION_STEPS, animationDirections,
  animationEffectsForKind,
  SHAPE_PATTERN_PRESETS, SLIDE_TRANSITION_TYPES, transitionDirections,
} from '@web-ppt/edit-core';
export type { EditorSession, OpenEditorOptions } from './session';
export type {
  FormatPainter, FormatPainterSnapshot, FormatPainterSource, FormatPainterStartOptions,
  FormatPainterSubscriber, FormatPainterTarget,
} from './format-painter-types';
export type {
  TextSearch, TextSearchMode, TextSearchOpenOptions, TextSearchOptions, TextSearchSnapshot,
  TextSearchSubscriber,
} from './text-search-types';
export type { SelectionPane, SelectionPaneOptions } from './selection-pane-types';
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
  WebPptAdapterSubscriber, WebPptDocument, WebPptDocumentKind, WebPptFormatPainterState, WebPptTextSearchState,
  WebPptViewOptions, WebPptViewState,
} from './framework-adapter-types';
export type { WebPptSource } from './source-fingerprint';
export type {
  EditorContextRequest, EditorContextRequestHandler, EditorMode, LinkFollowContext, LinkFollowHandler,
  LinkFollowSource, SlideEditor, SlideEditorOptions,
  TouchNavigationChange, TouchNavigationHandler,
} from './slide-editor-types';
export type { ImageInsertOptions } from './image-insertion';
export type { ImageBackgroundOptions, ImageReplaceOptions } from './image-insertion';
export type { TableInsertOptions } from './table-insertion';
export type {
  AddImageCommand, AddSectionCommand, AddShapeCommand, AddTableCommand, DistributeElementsCommand, EditAnimationStep, ElementAltTextState, ElementClipboardPayload, ElementCropState, ElementEffectsState, ElementFillState, ElementLinkState, ElementStrokeState, ImageCrop, LinkOverride, LinkSourceValue, LinkTarget, ParagraphAutoNumberType, ParagraphBullet, ParagraphBulletInput, ParagraphBulletSize, ParagraphBulletStyle, ParagraphProperties, ParagraphPropertiesState, ParagraphPropertyInput, ParagraphPropertyOverrides, SectionId, SectionRecord, SetAltTextCommand, SetSlideSizeCommand, SlideAnimationState, SlideBackgroundState, SlideHiddenState, SlideLayoutState, SlideSizeState,
  RunLinkState, RunPropertiesState, RunPropertyOverrides, SlideNotesState, SlideTransitionInput, SlideTransitionState, TextBodyAutoFit, TextBodyProperties, TextBodyPropertyOverrides,
  MoveSectionCommand, RemoveSectionCommand, RenameSectionCommand, ReplaceImageCommand, SetAnimationsCommand, SetBackgroundCommand, SetBackgroundCropCommand, SetBackgroundImageCommand, SetCropCommand, SetEffectsCommand, SetFillCommand, SetHiddenCommand, SetTransitionCommand, SetLayoutCommand, SetLinkCommand, SetStrokeCommand, StrokeCommandValue, VectorFill,
  FormatMaskField,
} from '@web-ppt/edit-core';
export type {
  EditorChange, FindTextRequest, ReplaceTextCommand, ReplaceTextScope, SlideId, TextSearchMatch,
  TextSearchScope, TextSearchTarget,
} from '@web-ppt/edit-core';
export type { SelectionPaneItem } from '@web-ppt/edit-core';
export type { SnapMargins } from './snap';
export type { AffineMatrix, SlideViewport, SpacePoint } from '@web-ppt/edit-core';
