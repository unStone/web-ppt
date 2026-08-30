import {
  bodyPropsPatchElements, panePatchElements, patchElements, renderPatchElements,
  renderPatchSlides, reorderedPatchElements,
} from './change-classification';
import { slidePatchSets } from './commands/slide-tree';
import type { EditorChange, Patch, Selection } from './commands/types';
import type { EditDoc, ProjectionInvalidation } from './types';

/** 撤销、重做和外部补丁必须给 DOM 层同一套精确失效集合，不能各自近似一遍。 */
export function changeFromPatches(
  doc: EditDoc,
  patches: readonly Patch[],
  inverse: readonly Patch[],
  source: EditorChange['source'],
  selection: Selection,
  dirty: ProjectionInvalidation,
): EditorChange {
  return {
    source,
    selection,
    touchedElements: patchElements(patches),
    renderElements: renderPatchElements(patches, dirty.dirtyElements),
    renderSlides: renderPatchSlides(patches),
    bodyPropsElements: bodyPropsPatchElements(patches, inverse),
    reorderedElements: reorderedPatchElements(patches),
    paneElements: panePatchElements(patches),
    ...slidePatchSets(doc, patches),
    ...dirty,
  };
}
