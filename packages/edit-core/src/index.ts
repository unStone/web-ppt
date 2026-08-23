/** @web-ppt/edit-core —— 无 DOM 的编辑文档模型与高保真渲染投影。 */
export { allocateElementId, allocateSlideId, createDoc, createEmptyDoc, disposeDoc } from './document';
export {
  effectiveElement, invalidateAll, invalidateElement, invalidateSlide, slideOfElement, toSlide,
} from './projection';
export {
  compareFractionalIndex, fractionalIndexBetween, initialFractionalIndex,
} from './fractional-index';
export type {
  CreateDocOptions, EditableKind, EditDoc, EditDocMeta, EditIdentity, ElementId, ElementMeta, ElementOverrides,
  ElementRecord, FractionalIndex, ProjectionInvalidation, SlideId, SlideOverrides, SlideRecord, SlideSource,
} from './types';
