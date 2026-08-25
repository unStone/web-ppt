/** @web-ppt/edit-core —— 无 DOM 的编辑文档模型与高保真渲染投影。 */
export { Editor } from './editor';
export { detectImageMime } from './commands/image-format';
export { MAX_REPLACE_IMAGE_BYTES } from './commands/image-resource';
export { copyElements } from './clipboard';
export { queryRunProps } from './run-properties';
export { queryParaProps } from './paragraph-properties';
export { queryBodyProps } from './body-properties';
export { queryElementFill, SHAPE_PATTERN_PRESETS } from './shape-fill';
export { queryElementStroke } from './shape-stroke';
export { queryElementEffects } from './shape-effects';
export { queryElementCrop } from './image-content';
export type { VectorFill } from './shape-fill';
export type { StrokeCommandValue } from './shape-stroke';
export { validateEditDoc } from './model-invariants';
export { tableCellKey, tableCellOverrideKey } from './table-cell';
export { assertTableDimension, isEmptyContentPlaceholder, MAX_TABLE_DIMENSION } from './table-insertion-policy';
export { isElementDescendantOf, outermostSelectedElementIds } from './selection';
export { elementOrder, writableLayerSiblingIds } from './element-order';
export { applyPatches } from './commands/patch';
export { allocateElementId, allocateSlideId, createDoc, createEmptyDoc, disposeDoc, replaceDocPackage } from './document';
export {
  effectiveElement, invalidateAll, invalidateElement, invalidateElementStructure, invalidateSlide, invalidateSlideStructure,
  slideOfElement, toSlide,
} from './projection';
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
  CreateDocOptions, EditableKind, EditDoc, EditDocMeta, EditIdentity, EditSaveState, ElementCropState, ElementEffectsState, ElementFillState, ElementId, ElementImageReplacement, ElementInsertionSource, ElementMeta, ElementOverrides, ElementStrokeState, ImageCrop,
  ElementRecord, FractionalIndex, ProjectionInvalidation, RemovedElementRecord, SlideId, SlideOverrides,
  FlatTextParagraph, ParagraphProperties, ParagraphPropertiesState, ParagraphPropertyOverrides, RunProperties, RunPropertiesState, RunPropertyOverrides, RunPropertyState,
  SlideCreation, SlideRecord, SlideSource, TableCellAddress, TableCellKey, TableCellOverrides, TableCellRowRef, TableRowId, TableRowInsertion, TextFragment, TextFragmentMark, TextFragmentParagraph, TextMark, TextOverride,
  TextBodyAutoFit, TextBodyProperties, TextBodyPropertyOverrides,
} from './types';
export type {
  AddImageCommand, AddShapeCommand, AddSlideCommand, AddTableCommand, AlignEdge, AlignElementsCommand, ClipboardElementRecord, ClipboardRelationship, ClipboardResource, ClipboardXmlRoot, Command, CommandPatches, DuplicateSlideCommand, EditTextCommand, EditorChange,
  EditorOptions, EditorSubscriber, ElementClipboardPayload, ElementClipboardRecordMeta, ElementCropPatch, ElementEffectsPatch, ElementFillPatch, ElementImageReplacementPatch, ElementOrderPatch, ElementStrokePatch, ElementTextPatch, ElementTransformPatch,
  ElementTreePatch, ElementTreeSnapshot, ElementXfrmPath, FitTextShapeCommand, History, HistoryEntry, InsertRowCommand, MoveSlideCommand, Patch, RemoveElementCommand, RemoveSlideCommand, SlideChangeSets, SlideOrderPatch, SlideTreePatch, SlideTreeSnapshot,
  PasteElementsCommand, Selection, ElementLayerTarget, FlipField, NumericXfrmField, SetFlipCommand, SetParaPropsCommand, SetRunPropsCommand, SetXfrmCommand, SetZCommand, TextPosition, TextRange, Transaction,
  ReplaceImageCommand, SetBodyPropsCommand, SetCropCommand, SetEffectsCommand, SetFillCommand, SetStrokeCommand, TableRowPatch,
  TextEditOp, TransactionOptions, TransactionResult, XfrmField, XfrmValueByField,
} from './commands/types';
export {
  applyParagraphProps, applyRunProps, applyTextEditOps, flattenTextBody, queryTextParagraphProps,
  queryTextRunProps, textBodyFromOverride, textFragmentFromRange,
} from './text-model';
export {
  TEXT_ATOM, textBodyEditText, textPositionAtIndex, textPositionToIndex, textRunEditLength,
} from './text-position';
export type { AffineMatrix, ElementFrameTransform, SlideViewport, SpacePoint } from './space';
