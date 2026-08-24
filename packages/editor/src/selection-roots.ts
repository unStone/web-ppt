import { isElementDescendantOf } from '@web-ppt/edit-core';
import type { EditDoc, ElementId } from '@web-ppt/edit-core';

/** 祖先与后代同时入选时只变换最外层根，否则世界变换会重复叠加。 */
export function outermostSelectedElementIds(doc: EditDoc, ids: readonly ElementId[]): ElementId[] {
  return ids.filter((id) => !ids.some((ancestor) => ancestor !== id
    && isElementDescendantOf(doc, id, ancestor)));
}
