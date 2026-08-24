/** @web-ppt/edit-core —— 无 DOM 的编辑文档模型与高保真渲染投影。 */
export { Editor } from './editor';
export { copyElements } from './clipboard';
export { validateEditDoc } from './model-invariants';
export { isElementDescendantOf, outermostSelectedElementIds } from './selection';
export { elementOrder, writableLayerSiblingIds } from './element-order';
export { applyPatches } from './commands/patch';
export { allocateElementId, allocateSlideId, createDoc, createEmptyDoc, disposeDoc, replaceDocPackage } from './document';
export {
  effectiveElement, invalidateAll, invalidateElement, invalidateElementStructure, invalidateSlide,
  slideOfElement, toSlide,
} from './projection';
export {
  assertFractionalIndex, compareFractionalIndex, fractionalIndexBetween, initialFractionalIndex,
} from './fractional-index';
export {
  composeSpaceMatrices, elementFrameToParentMatrix, elementFrameToSlideMatrix,
  elementChildrenToSlideMatrix, elementFrameToSlidePoint, elementParentToSlideMatrix, elementParentToSlidePoint,
  inverseTransformSpaceVector, invertSpaceMatrix, screenToSlidePoint, slideToElementFramePoint,
  slideToElementParentPoint, slideToScreenPoint, spaceOrientationParity, transformSpacePoint,
  transformSpaceVector,
} from './space';
export type {
  CreateDocOptions, EditableKind, EditDoc, EditDocMeta, EditIdentity, EditSaveState, ElementId, ElementInsertionSource, ElementMeta, ElementOverrides,
  ElementRecord, FractionalIndex, ProjectionInvalidation, RemovedElementRecord, SlideId, SlideOverrides,
  FlatTextParagraph, SlideRecord, SlideSource, TextMark, TextOverride,
} from './types';
export type {
  AlignEdge, AlignElementsCommand, ClipboardElementRecord, ClipboardRelationship, ClipboardResource, ClipboardXmlRoot, Command, CommandPatches, EditTextCommand, EditorChange,
  EditorOptions, EditorSubscriber, ElementClipboardPayload, ElementClipboardRecordMeta, ElementOrderPatch, ElementTextPatch, ElementTransformPatch,
  ElementTreePatch, ElementTreeSnapshot, ElementXfrmPath, History, HistoryEntry, Patch, RemoveElementCommand,
  PasteElementsCommand, Selection, ElementLayerTarget, FlipField, NumericXfrmField, SetFlipCommand, SetXfrmCommand, SetZCommand, TextPosition, Transaction,
  TextEditOp, TransactionOptions, TransactionResult, XfrmField, XfrmValueByField,
} from './commands/types';
export { applyTextEditOps, flattenTextBody, textBodyFromOverride } from './text-model';
export {
  TEXT_ATOM, textBodyEditText, textPositionAtIndex, textPositionToIndex, textRunEditLength,
} from './text-position';
export type { AffineMatrix, ElementFrameTransform, SlideViewport, SpacePoint } from './space';
