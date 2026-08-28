import type { Editor, EditorChange, ElementId, SlideId } from '@web-ppt/edit-core';
import { shouldRenderWholeSlide, touchedElementPartitions } from './dom-identity';
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
  if (change.renderSlides.has(slideId)) return false;
  const renderElements = new Set(change.renderElements);
  // 本视图的 HTML 编辑面已覆盖文字；静态 SVG 延迟到退出时一次同步，避免每键双重排版。
  if (options.deferElement && editor.doc.elements[options.deferElement]) {
    renderElements.delete(options.deferElement);
  }
  const partitions = touchedElementPartitions(editor.doc, slideId, renderElements);
  const partitionById = new Map([...staticLayer.querySelectorAll<SVGElement>('[data-edit-root]')]
    .map((node) => [node.dataset.editRoot!, node] as const));
  const partition = (id: ElementId): SVGElement | null => partitionById.get(id) ?? null;
  const elementCount = editor.doc.slides[slideId].children.length;
  const removed = [...renderElements].filter((id) => !editor.doc.elements[id]
    && !!partition(id));
  const removedPartitions = removed.flatMap((id) => partition(id) ?? []);
  const fallbackParents = new Map<ElementId, Node>();
  const reusableChildren = new Map<ElementId, readonly SVGElement[]>();
  const structurallyReused = new Set<ElementId>();
  for (const id of partitions.ids) {
    const current = partition(id);
    const removedOwner = current && removedPartitions.find((root) => root.contains(current));
    if (removedOwner?.parentNode) fallbackParents.set(id, removedOwner.parentNode);
  }
  const changedCount = partitions.ids.length + removed.length;
  const hierarchyChange = removed.some((id) => change.reorderedElements.has(id));
  if (!hierarchyChange && changedCount && shouldRenderWholeSlide(
    changedCount, partitions.topLevelCount + removed.length, elementCount + removed.length,
  )) return false;
  // 先把孩子移出待删除的组合壳，避免 remove() 连同仍需更新的分区一起断开。
  // 只有新建恒等组合的孩子能直接复用；来源 grpSp 的孩子必须随后按新坐标重绘。
  for (const removedId of removed) {
    const owner = partition(removedId);
    if (!owner?.parentNode) continue;
    const canReuseWithoutRender = !editor.doc.removedElements[removedId];
    const candidates = partitions.ids.filter((id) => {
      const current = partition(id);
      return !!current && owner.contains(current) && editor.doc.elements[id]?.parent !== removedId;
    });
    const parent = candidates[0] ? editor.doc.elements[candidates[0]]?.parent : null;
    const siblings = parent && (editor.doc.slides[parent]?.children ?? editor.doc.elements[parent]?.children);
    if (!siblings || !candidates.length) continue;
    const candidateSet = new Set(candidates);
    for (const id of siblings) {
      if (!candidateSet.has(id)) continue;
      const current = partition(id)!;
      owner.parentNode.insertBefore(current, owner);
      if (canReuseWithoutRender) structurallyReused.add(id);
    }
  }
  for (const id of partitions.ids) {
    if (partition(id)) continue;
    const record = editor.doc.elements[id];
    const existingChildren = (record?.children ?? [])
      .map((child) => partition(child)).filter((node): node is SVGElement => !!node);
    if (existingChildren[0]?.parentNode) fallbackParents.set(id, existingChildren[0].parentNode);
    if (record?.meta.insertion?.containsDescendants === false
      && existingChildren.length === record.children?.length) {
      reusableChildren.set(id, existingChildren);
      continue;
    }
    for (const child of record?.children ?? []) {
      if (partition(child) && !removeElementPartition(staticLayer, child)) return false;
    }
  }
  for (const id of removed) if (!removeElementPartition(staticLayer, id)) return false;
  for (const id of partitions.ids) {
    if (structurallyReused.has(id)) continue;
    const updated = partition(id)
      ? patchElement(staticLayer, editor, id, idPrefix, textMode)
      : insertElementPartition(
        staticLayer, editor, id, idPrefix, textMode, fallbackParents.get(id), reusableChildren.get(id),
      );
    if (!updated) return false;
  }
  return !change.reorderedElements.size
    || reorderElementPartitions(staticLayer, editor, change.reorderedElements);
}
