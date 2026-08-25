import type { EditDoc, ElementRecord } from '../types';
import type { XmlDocument } from '../xml/types';
import { patchElementOrders } from './order';
import { patchElementText } from './text';
import { patchElementXfrm } from './xfrm';
import { patchTableGeometry, patchTableRows } from './table';
import { patchElementShapeFormat } from './shape-format';
import { patchElementEffects } from './effects';
import { patchElementImageContent } from './image-content';
import { patchElementHyperlink } from './hyperlink';
import type { HyperlinkSaveContext } from './hyperlink';

/** 插入片段与整页保存必须经过同一条覆盖物化管线，避免二次复制丢失编辑。 */
export function materializeElementOverrides(
  document: XmlDocument,
  doc: EditDoc,
  part: string,
  records: readonly ElementRecord[],
  scope?: ReadonlySet<string>,
  structuralContentAlreadyMaterialized: ReadonlySet<string> = new Set(),
  links?: HyperlinkSaveContext,
): void {
  // 新插入宿主仍要在整页上下文重放变换与文字：占位符的继承只有此时完整。
  // 表格追加行不是 set 操作，片段中已经物化后绝不能在外层再次生成。
  patchElementOrders(document, doc, part, scope);
  for (const record of records) {
    patchElementXfrm(document, record);
    patchElementShapeFormat(document, record);
    patchElementEffects(document, record);
    patchElementImageContent(document, record);
    if (links) patchElementHyperlink(document, record, links);
    if (!structuralContentAlreadyMaterialized.has(record.id)) patchTableRows(document, record);
    patchTableGeometry(document, record);
    patchElementText(document, record, links);
  }
}
