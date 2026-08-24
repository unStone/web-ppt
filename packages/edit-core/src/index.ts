/** @web-ppt/edit-core —— 无 DOM 的编辑文档模型与高保真渲染投影。 */
export { Editor } from './editor';
export { validateEditDoc } from './model-invariants';
export { isElementDescendantOf } from './selection';
export { applyPatches } from './commands/patch';
export { allocateElementId, allocateSlideId, createDoc, createEmptyDoc, disposeDoc, replaceDocPackage } from './document';
export {
  effectiveElement, invalidateAll, invalidateElement, invalidateElementStructure, invalidateSlide,
  slideOfElement, toSlide,
} from './projection';
export {
  compareFractionalIndex, fractionalIndexBetween, initialFractionalIndex,
} from './fractional-index';
export type {
  CreateDocOptions, EditableKind, EditDoc, EditDocMeta, EditIdentity, EditSaveState, ElementId, ElementMeta, ElementOverrides,
  ElementRecord, FractionalIndex, ProjectionInvalidation, RemovedElementRecord, SlideId, SlideOverrides,
  SlideRecord, SlideSource, TextOverride,
} from './types';
export type {
  Command, CommandPatches, EditorChange, EditorOptions, EditorSubscriber, ElementTextPatch, ElementTransformPatch,
  ElementTreePatch, ElementTreeSnapshot, ElementXfrmPath, History, HistoryEntry, Patch, RemoveElementCommand,
  Selection, FlipField, NumericXfrmField, SetFlipCommand, SetXfrmCommand, TextPosition, Transaction,
  TransactionOptions, TransactionResult, XfrmField, XfrmValueByField,
} from './commands/types';
