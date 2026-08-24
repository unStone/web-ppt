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

export function bindElementIdentities(root: ParentNode, doc: EditDoc, roots: readonly ElementId[]): void {
  const ids = elementIds(doc, roots);
  const nodes = includingRoot(root, '[data-el]');
  if (nodes.length !== ids.length) throw new Error('渲染节点与编辑投影的元素数量不一致');
  nodes.forEach((node, index) => {
    const id = ids[index];
    if (String(doc.elements[id].src.id) !== node.dataset.el) {
      throw new Error(`渲染节点与编辑投影的顺序不一致：${id}`);
    }
    node.dataset.editId = id;
  });
  for (const id of ids) {
    const identity = findByIdentity(root, 'editId', id);
    if (!identity) throw new Error(`渲染结果缺少编辑元素：${id}`);
    const partition = identity.parentElement?.localName === 'a' ? identity.parentElement : identity;
    (partition as SVGElement).dataset.editRoot = id;
  }
}

export function bindSlideIdentities(root: ParentNode, doc: EditDoc, slideId: SlideId): void {
  bindElementIdentities(root, doc, doc.slides[slideId].children);
}

export function findElementPartition(root: ParentNode, id: ElementId): SVGElement | null {
  return findByIdentity(root, 'editRoot', id);
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
