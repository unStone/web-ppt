/** @web-ppt/edit-core —— 无 DOM 的编辑文档模型与高保真渲染投影。 */
export { Editor } from './editor';
export { EDITOR_RECOVERY_VERSION, restoreRecoveryFrames } from './recovery';
export { detectImageMime } from './commands/image-format';
export { MAX_REPLACE_IMAGE_BYTES } from './commands/image-resource';
export { copyElements } from './clipboard';
export { queryRunProps } from './run-properties';
export { queryRunLink } from './run-links';
export { queryParaProps } from './paragraph-properties';
export { queryBodyProps } from './body-properties';
export { assertFormatMask, FORMAT_MASK_FIELDS } from './commands/format-painter-types';
export { assertFindTextRequest, findText } from './text-search';
export { queryElementFill, SHAPE_PATTERN_PRESETS } from './shape-fill';
export { querySlideBackground, querySlideHidden, querySlideLayout } from './slide-properties';
export {
  normalizeSlideTransition, querySlideTransition, SLIDE_TRANSITION_TYPES, transitionDirections,
} from './slide-transition';
export {
  ANIMATION_EFFECTS, MAX_ANIMATION_STEPS, animationDirections, animationEffectsForKind,
  normalizeSlideAnimations, projectAnimationSteps,
  querySlideAnimations,
} from './slide-animation';
export { querySlideNotes } from './slide-notes';
export { queryElementStroke } from './shape-stroke';
export { queryElementEffects } from './shape-effects';
export { queryElementCrop } from './image-content';
export { listTableStyles, queryTableStyle } from './table-style';
export type { TableStyleCatalogItem, TableStyleState } from './table-style';
export {
  assertCustomGeometry, moveCustomGeometryPoint, queryElementCustomGeometry,
  setCustomGeometryClosed, setCustomGeometrySegmentType,
} from './custom-geometry';
export { customGeometryFromSvgPath } from './custom-geometry-path';
export type { CustomGeometry } from '@web-ppt/core';
export {
  MAX_EXTERNAL_LINK_LENGTH, normalizeExternalLinkTarget, queryElementLink,
} from './hyperlink';
export type { VectorFill } from './shape-fill';
export type { StrokeCommandValue } from './shape-stroke';
export { validateEditDoc } from './model-invariants';
export { tableCellKey, tableCellOverrideKey } from './table-cell';
export { queryTableGrid } from './table-grid';
export { assertTableDimension, isEmptyContentPlaceholder, MAX_TABLE_DIMENSION } from './table-insertion-policy';
export { isElementDescendantOf, outermostSelectedElementIds } from './selection';
export { elementOrder, writableLayerSiblingIds } from './element-order';
export { MAX_ELEMENT_NAME_LENGTH } from './element-name';
export { querySelectionPane } from './selection-pane';
export { applyPatches, assertPatchesApplicable, stageExternalPatches } from './commands/patch';
export { allocateElementId, allocateSlideId, createDoc, createEmptyDoc, disposeDoc, replaceDocPackage } from './document';
export { configureCollaborationIdentity } from './collaboration-identity';
export { assertIdentityAllocation, MAX_COLLABORATION_VERSION } from './identity-allocation';
export {
  effectiveElement, invalidateAll, invalidateElement, invalidateElementStructure, invalidateSlide, invalidateSlideStructure,
  slideOfElement, toSlide,
} from './projection';
export { projectedSlideElementIds, unboundLayoutPlaceholders } from './layout-projection';
export {
  assertFractionalIndex, compareFractionalIndex, fractionalIndexBetween, initialFractionalIndex,
} from './fractional-index';
export {
  composeSpaceMatrices, elementContentToSlideMatrix, elementFrameToParentMatrix, elementFrameToSlideMatrix,
  elementChildrenToSlideMatrix, elementFrameToSlidePoint, elementParentToSlideMatrix, elementParentToSlidePoint,
  inverseTransformSpaceVector, invertSpaceMatrix, screenToSlidePoint, slideToElementFramePoint,
  slideToElementParentPoint, slideToScreenPoint, spaceOrientationParity, transformSpacePoint,
  transformSpaceVector,
} from './space';
export type {
  CreateDocOptions, EditableKind, EditAnimationStep, EditDoc, EditDocMeta, EditIdentity, EditIdentityAllocation, EditIdentityRange, EditSaveState, ElementCropState, ElementEffectsState, ElementFillState, ElementId, ElementImageReplacement, ElementInsertionSource, ElementLinkState, ElementMeta, ElementOverrides, ElementStrokeState, ImageCrop, LinkOverride, LinkSourceValue, LinkTarget, RelativeLinkSource, UnsupportedLinkSource, SlideAnimationState, SlideBackgroundState, SlideHiddenState, SlideImageBackground, SlideLayoutState, SlideNotesState, SlideTransitionState,
  ElementRecord, FractionalIndex, ProjectionInvalidation, RemovedElementRecord, SlideId, SlideOverrides,
  FlatTextParagraph, ParagraphProperties, ParagraphPropertiesState, ParagraphPropertyOverrides, RunLinkState, RunProperties, RunPropertiesState, RunPropertyOverrides, RunPropertyState,
  SlideCreation, SlideNotesBinding, SlideRecord, SlideSource, TableCellAddress, TableCellColumnRef, TableCellKey, TableCellOverrides, TableCellRef, TableCellRowRef, TableColumnId, TableColumnInsertion, TableMergeRegion, TableRowId, TableRowInsertion, TextFragment, TextFragmentMark, TextFragmentParagraph, TextMark, TextOverride,
  TextBodyAutoFit, TextBodyProperties, TextBodyPropertyOverrides,
} from './types';
export type {
  RecoveryAssetReference, RecoveryFrame, RecoveryFrameSource, RecoveryRestoreResult, RecoverySubscriber,
} from './recovery-types';
export type {
  AddImageCommand, AddShapeCommand, AddSlideCommand, AddTableCommand, AlignEdge, AlignElementsCommand, ClipboardElementRecord, ClipboardPortableLink, ClipboardRelationship, ClipboardResource, ClipboardTextLink, ClipboardXmlRoot, Command, CommandPatches, DuplicateSlideCommand, EditTextCommand, EditorChange, GroupCommand, UngroupCommand,
  EditorOptions, EditorPatchEvent, EditorPatchSubscriber, EditorPatchSubscribeOptions, EditorSubscriber, ExternalPatchOptions, ElementClipboardPayload, ElementClipboardRecordMeta, ElementCropPatch, ElementEffectsPatch, ElementFillPatch, ElementImageReplacementPatch, ElementInteractionField, ElementInteractionPatch, ElementLinkPatch, ElementNamePatch, ElementOrderPatch, ElementStrokePatch, ElementTextPatch, ElementTransformPatch,
  ElementHierarchyPatch, ElementHierarchyState, ElementTreePatch, ElementTreeSnapshot, ElementXfrmPath, FitTextShapeCommand, History, HistoryEntry, InsertColumnCommand, InsertRowCommand, MergeCellsCommand, MoveSlideCommand, Patch, RemoveColumnCommand, RemoveElementCommand, RemoveRowCommand, RemoveSlideCommand, SetAnimationsCommand, SetBackgroundCommand, SetBackgroundCropCommand, SetBackgroundImageCommand, SetCellPropsCommand, SetColumnWidthCommand, SetHiddenCommand, SetRowHeightCommand, SetTransitionCommand, SlideAnimationsPatch, SlideBackgroundImagePatch, SlideBackgroundPatch, SlideChangeSets, SlideHiddenPatch, SlideTransitionPatch, SlideOrderPatch, SlidePropertyPatch, SlideTreePatch, SlideTreeSnapshot, SplitCellCommand,
  ApplyFormatCommand, FormatMaskField, PasteElementsCommand, Selection, ElementLayerTarget, FlipField, NumericXfrmField, SetElementHiddenCommand, SetFlipCommand, SetLockedCommand, SetNameCommand, SetParaPropsCommand, SetRunPropsCommand, SetXfrmCommand, SetZCommand, TextPosition, TextRange, Transaction,
  ReplaceImageCommand, SetBodyPropsCommand, SetCropCommand, SetEffectsCommand, SetFillCommand, SetLayoutCommand, SetLinkCommand, SetNotesCommand, SetStrokeCommand, SlideLayoutPatch, SlideNotesPatch, TableCellPropsPatch, TableColumnPatch, TableGridEntryPatch, TableMergePatch, TableRowPatch,
  ElementTableStylePatch, SetTableStyleCommand,
  TextEditOp, TransactionOptions, TransactionResult, XfrmField, XfrmValueByField,
} from './commands/types';
export type {
  ConvertToCustomGeometryCommand, ElementGeometryPatch, SetGeometryCommand,
} from './commands/geometry-types';
export type { SlideTransitionInput } from './slide-transition';
export type {
  EditableAnimationEffect, EmphasisAnimationEffect, EntranceExitAnimationEffect,
} from './animation-catalog';
export type { SelectionPaneItem } from './selection-pane';
export type {
  FindTextRequest, ReplaceTextCommand, ReplaceTextScope, TextSearchMatch, TextSearchScope,
  TextSearchTarget,
} from './text-search-types';
export {
  applyParagraphProps, applyRunProps, applyTextEditOps, flattenTextBody, queryTextParagraphProps,
  queryTextRunProps, textBodyFromOverride, textFragmentFromRange, textMarksInRange,
} from './text-model';
export {
  TEXT_ATOM, textBodyEditText, textPositionAtIndex, textPositionToIndex, textRunEditLength,
} from './text-position';
export type { AffineMatrix, ElementFrameTransform, SlideViewport, SpacePoint } from './space';
