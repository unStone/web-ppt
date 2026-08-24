import type { Editor, EditorChange, ElementId, SlideId } from '@web-ppt/edit-core';
import {
  findElementPartition, shouldRenderWholeSlide, touchedElementPartitions,
} from './dom-identity';
import {
  insertElementPartition, patchElement, removeElementPartition, reorderElementPartitions,
} from './dom-patch';

interface SlideDomUpdateOptions {
  staticLayer: HTMLElement;
  editor: Editor;
  slideId: SlideId;
  change: EditorChange;
  idPrefix: string;
  textMode: 'html' | 'svg';
  deferElement: ElementId | null;
}

/** 返回 false 表示局部分区身份不足，调用方应统一回退整页渲染。 */
export function patchSlideDom(options: SlideDomUpdateOptions): boolean {
  const { staticLayer, editor, slideId, change, idPrefix, textMode } = options;
  if (!change.dirtySlides.has(slideId)) return true;
  const renderElements = new Set(change.renderElements);
  // 本视图的 HTML 编辑面已覆盖文字；静态 SVG 延迟到退出时一次同步，避免每键双重排版。
  if (options.deferElement && editor.doc.elements[options.deferElement]) {
    renderElements.delete(options.deferElement);
  }
  const partitions = touchedElementPartitions(editor.doc, slideId, renderElements);
  const elementCount = editor.doc.slides[slideId].children.length;
  const removed = [...renderElements].filter((id) => !editor.doc.elements[id]
    && !!findElementPartition(staticLayer, id));
  const changedCount = partitions.ids.length + removed.length;
  if (changedCount && shouldRenderWholeSlide(
    changedCount, partitions.topLevelCount + removed.length, elementCount + removed.length,
  )) return false;
  for (const id of removed) if (!removeElementPartition(staticLayer, id)) return false;
  for (const id of partitions.ids) {
    const updated = findElementPartition(staticLayer, id)
      ? patchElement(staticLayer, editor, id, idPrefix, textMode)
      : insertElementPartition(staticLayer, editor, id, idPrefix, textMode);
    if (!updated) return false;
  }
  return !change.reorderedElements.size
    || reorderElementPartitions(staticLayer, editor, change.reorderedElements);
}
