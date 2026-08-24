import type { EditDoc, ElementRecord } from '../types';
import type { XmlDocument } from '../xml/types';
import { patchElementOrders } from './order';
import { patchElementText } from './text';
import { patchElementXfrm } from './xfrm';
import { patchTableRows } from './table';

/** 插入片段与整页保存必须经过同一条覆盖物化管线，避免二次复制丢失编辑。 */
export function materializeElementOverrides(
  document: XmlDocument,
  doc: EditDoc,
  part: string,
  records: readonly ElementRecord[],
  scope?: ReadonlySet<string>,
): void {
  patchElementOrders(document, doc, part, scope);
  for (const record of records) {
    patchElementXfrm(document, record);
    patchTableRows(document, record);
    patchElementText(document, record);
  }
}
