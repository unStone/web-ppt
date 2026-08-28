import { projectedSlideElementIds } from '@web-ppt/edit-core';
import type { EditDoc, ElementId, SlideId } from '@web-ppt/edit-core';

export function elementIds(doc: EditDoc, roots: readonly ElementId[]): ElementId[] {
  const output: ElementId[] = [];
  const walk = (ids: readonly ElementId[]): void => {
    for (const id of ids) {
      output.push(id);
      const children = doc.elements[id]?.children;
      if (children) walk(children);
    }
  };
  walk(roots);
  return output;
}

/** 数字 spid 只在源 part 内有意义；DOM 交互统一改认会话级 EditDoc 身份。 */
function includingRoot(root: ParentNode, selector: string): SVGElement[] {
  const own = root.nodeType === 1 && (root as Element).matches(selector) ? [root as SVGElement] : [];
  return [...own, ...root.querySelectorAll<SVGElement>(selector)];
}

function findByIdentity(root: ParentNode, attribute: 'editId' | 'editRoot', id: string): SVGElement | null {
  return includingRoot(root, `[data-${attribute === 'editId' ? 'edit-id' : 'edit-root'}]`)
    .find((node) => node.dataset[attribute] === id) ?? null;
}

function bindProjectedIdentities(
  root: ParentNode,
  doc: EditDoc,
  ids: readonly (ElementId | null)[],
): void {
  const nodes = includingRoot(root, '[data-el]');
  if (nodes.length !== ids.length) throw new Error('渲染节点与编辑投影的元素数量不一致');
  nodes.forEach((node, index) => {
    const id = ids[index];
    // 目标版式的静态元素只参与投影，不伪造可编辑的 EditDoc 身份。
    if (id === null) return;
    const sourceId = doc.elements[id].src.id;
    if ((sourceId === undefined ? '' : String(sourceId)) !== node.dataset.el) {
      throw new Error(`渲染节点与编辑投影的顺序不一致：${id}`);
    }
    node.dataset.editId = id;
  });
  for (const id of ids) {
    if (id === null) continue;
    const identity = findByIdentity(root, 'editId', id);
    if (!identity) throw new Error(`渲染结果缺少编辑元素：${id}`);
    const partition = identity.parentElement?.localName === 'a' ? identity.parentElement : identity;
    (partition as SVGElement).dataset.editRoot = id;
  }
  // 静态层标记不能与 contenteditable 的 data-r 重名，否则宿主的编辑器选择器会命中预览副本。
  for (const marker of root.querySelectorAll<HTMLElement | SVGElement>('[data-r]')) {
    marker.dataset.pptSearchR = marker.dataset.r!;
    delete marker.dataset.r;
    if (marker.dataset.from !== undefined) {
      marker.dataset.pptSearchFrom = marker.dataset.from;
      delete marker.dataset.from;
    }
    if (marker.dataset.to !== undefined) {
      marker.dataset.pptSearchTo = marker.dataset.to;
      delete marker.dataset.to;
    }
  }
}

export function bindElementIdentities(root: ParentNode, doc: EditDoc, roots: readonly ElementId[]): void {
  bindProjectedIdentities(root, doc, elementIds(doc, roots));
}

/** 结构壳尚未挂孩子时只绑定容器本身，孩子沿用原分区身份。 */
export function bindSingleElementIdentity(root: ParentNode, doc: EditDoc, id: ElementId): void {
  bindProjectedIdentities(root, doc, [id]);
}

export function bindSlideIdentities(root: ParentNode, doc: EditDoc, slideId: SlideId): void {
  bindProjectedIdentities(root, doc, projectedSlideElementIds(doc, slideId));
}

export function findElementPartition(root: ParentNode, id: ElementId): SVGElement | null {
  return findByIdentity(root, 'editRoot', id);
}

/**
 * visibility 会被后代的 visible 覆盖；显示元素时必须删除声明，让祖先隐藏继续继承。
 */
export function syncElementVisibility(root: ParentNode, doc: EditDoc, id: ElementId): boolean {
  const partition = findElementPartition(root, id);
  const record = doc.elements[id];
  if (!partition || !record) return false;
  if (record.meta.hiddenByUser) partition.style.visibility = 'hidden';
  else partition.style.removeProperty('visibility');
  return true;
}

export function syncElementTreeVisibility(root: ParentNode, doc: EditDoc, id: ElementId): void {
  const visit = (current: ElementId): void => {
    syncElementVisibility(root, doc, current);
    for (const child of doc.elements[current]?.children ?? []) visit(child);
  };
  visit(id);
}

export function syncSlideVisibility(root: ParentNode, doc: EditDoc, slideId: SlideId): void {
  for (const id of doc.slides[slideId]?.children ?? []) syncElementTreeVisibility(root, doc, id);
}

export function touchedElementPartitions(
  doc: EditDoc,
  slideId: SlideId,
  touched: ReadonlySet<ElementId>,
): { ids: ElementId[]; topLevelCount: number } {
  const partitions = new Set<ElementId>();
  const topLevel = new Set<ElementId>();
  for (const id of touched) {
    let record = doc.elements[id];
    if (!record) continue;
    while (typeof record.parent === 'string' && doc.elements[record.parent]
      && touched.has(record.parent)) record = doc.elements[record.parent];
    let owner = record;
    while (doc.elements[owner.parent]) owner = doc.elements[owner.parent];
    if (owner.parent === slideId) {
      partitions.add(record.id);
      topLevel.add(owner.id);
    }
  }
  return { ids: [...partitions], topLevelCount: topLevel.size };
}

/** 百分比在小页面上会把一次局部修改误判成整页重绘；只有真实批量提交才考虑换整页。 */
export function shouldRenderWholeSlide(
  partitionCount: number,
  topLevelCount: number,
  slideTopLevelCount: number,
): boolean {
  return partitionCount > 8 && topLevelCount / Math.max(slideTopLevelCount, 1) > 0.3;
}
