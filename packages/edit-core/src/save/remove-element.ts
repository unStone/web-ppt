import type { RemovedElementRecord } from '../types';
import { removeXmlChild } from '../xml/nodes';
import type { XmlDocument } from '../xml/types';
import { locateElementHost } from './xfrm';

/** 删除宿主节点但不碰 rels 或媒体；共享资源只能在保存期可达性分析后回收。 */
export function patchRemovedElement(document: XmlDocument, record: RemovedElementRecord): void {
  if (record.meta.editable === 'none') throw new Error(`元素 ${record.id} 不可写回`);
  const { host, parent } = locateElementHost(document, record);
  if (!removeXmlChild(parent, host)) throw new Error(`无法删除元素宿主：${record.id}`);
}
