import { assertFindTextRequest, findText, slideOfElement } from '@web-ppt/edit-core';
import type {
  Editor, FindTextRequest, SlideId, TextSearchMatch,
} from '@web-ppt/edit-core';

const MAX_QUERY_CACHES = 8;

function requestKey(request: FindTextRequest): string {
  return JSON.stringify([
    request.query, request.matchCase === true, request.wholeWord === true,
  ]);
}

function requestSlides(editor: Editor, request: FindTextRequest): SlideId[] {
  if (request.scope.kind === 'document') return [...editor.doc.slideOrder];
  if (request.scope.kind === 'slide') return [request.scope.slideId];
  const included = new Set(request.scope.slideIds);
  return editor.doc.slideOrder.filter((id) => included.has(id));
}

/** 查询结果按页懒缓存；事务只淘汰脏页，页序变化只重组数组。 */
export class SessionTextSearchIndex {
  private readonly cache = new Map<string, Map<SlideId, readonly TextSearchMatch[]>>();
  private readonly unsubscribe: () => void;
  private isDisposed = false;

  constructor(private readonly editor: Editor) {
    this.unsubscribe = editor.subscribe((change) => {
      const invalidated = new Set([...change.dirtySlides, ...change.removedSlides]);
      // hiddenByUser 不触发 SVG 重绘，但会改变“可见文字”集合；仍只淘汰所属页。
      for (const id of change.paneElements) {
        if (editor.doc.elements[id]) invalidated.add(slideOfElement(editor.doc, id));
      }
      for (const slideId of invalidated) {
        for (const pages of this.cache.values()) pages.delete(slideId);
      }
    });
  }

  find(request: FindTextRequest): readonly TextSearchMatch[] {
    if (this.isDisposed) throw new Error('文字搜索索引已经释放');
    assertFindTextRequest(this.editor.doc, request);
    const key = requestKey(request);
    let pages = this.cache.get(key);
    if (!pages) {
      if (this.cache.size >= MAX_QUERY_CACHES) this.cache.delete(this.cache.keys().next().value as string);
      pages = new Map();
      this.cache.set(key, pages);
    } else {
      this.cache.delete(key);
      this.cache.set(key, pages);
    }
    return requestSlides(this.editor, request).flatMap((slideId) => {
      let matches = pages!.get(slideId);
      if (!matches) {
        matches = findText(this.editor.doc, {
          ...request, scope: { kind: 'slide', slideId },
        });
        pages!.set(slideId, matches);
      }
      return [...matches];
    });
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.unsubscribe();
    this.cache.clear();
  }
}
