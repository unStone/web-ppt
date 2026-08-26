import { elementName } from './element-name';
import { elementOrder } from './element-order';
import { projectionContentIds } from './layout-projection';
import type { EditDoc, EditableKind, ElementId, SlideId } from './types';

export interface SelectionPaneItem {
  readonly id: ElementId;
  readonly parentId: ElementId | null;
  readonly depth: number;
  readonly kind: EditDoc['elements'][string]['src']['kind'];
  readonly name: string;
  readonly sourceName: string | null;
  readonly direct: boolean;
  readonly editable: EditableKind;
  readonly locked: boolean;
  readonly ownLocked: boolean;
  readonly hidden: boolean;
  readonly ownHidden: boolean;
  readonly hasChildren: boolean;
}

/** 选择窗格与画布共用模型绘制序；逆序只负责把最上层对象放在列表顶部。 */
export function querySelectionPane(doc: EditDoc, slideId: SlideId): SelectionPaneItem[] {
  const slide = doc.slides[slideId];
  if (!slide) throw new Error(`找不到幻灯片：${slideId}`);
  const output: SelectionPaneItem[] = [];
  const visit = (
    ids: readonly ElementId[], parentId: ElementId | null, depth: number,
    ancestorLocked: boolean, ancestorHidden: boolean,
  ): void => {
    const ordered = [...ids].sort((left, right) => {
      const leftOrder = elementOrder(doc.elements[left]);
      const rightOrder = elementOrder(doc.elements[right]);
      return leftOrder === rightOrder ? 0 : leftOrder < rightOrder ? 1 : -1;
    });
    for (const id of ordered) {
      const record = doc.elements[id];
      if (!record) throw new Error(`选择窗格指向不存在的元素：${id}`);
      const ownLocked = record.meta.locked === true;
      const ownHidden = record.meta.hiddenByUser === true;
      const children = record.children ?? [];
      output.push({
        id, parentId, depth, kind: record.src.kind,
        name: elementName(record), sourceName: record.src.name ?? null,
        direct: Object.prototype.hasOwnProperty.call(record.ovr, 'name'),
        editable: record.meta.editable,
        locked: ancestorLocked || ownLocked, ownLocked,
        hidden: ancestorHidden || ownHidden, ownHidden,
        hasChildren: children.length > 0,
      });
      if (children.length) visit(
        children, id, depth + 1,
        ancestorLocked || ownLocked, ancestorHidden || ownHidden,
      );
    }
  };
  // 版式切换保留旧来源记录用于撤销/保存，但它们不再属于当前交互树，不能在窗格中形成“幽灵对象”。
  visit(projectionContentIds(doc, slideId), null, 0, false, false);
  return output;
}
