import type { Editor, SlideId } from '@web-ppt/edit-core';
import { directSelectableChildIds } from './selection-hit';

/** “全页”始终退出组上下文，只选择当前页直属且可交互的根元素。 */
export function selectAllSlideElements(editor: Editor, slideId: SlideId): readonly string[] {
  const ids = directSelectableChildIds(editor.doc, slideId, null);
  editor.select(ids.length
    ? { kind: 'elements', ids, enteredGroup: null }
    : { kind: 'none' });
  return ids;
}
