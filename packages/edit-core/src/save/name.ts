import type { ElementRecord } from '../types';
import { setXmlAttribute } from '../xml/mutate';
import type { XmlDocument } from '../xml/types';
import { elementNonVisualProperties } from './xfrm';

import { own } from '../data-validation';

export function hasNameOverride(record: ElementRecord): boolean {
  return own(record.ovr, 'name');
}

/** 名称只落在宿主 cNvPr；不重建 non-visual 树，避免碰未知扩展与锁定节点。 */
export function patchElementName(document: XmlDocument, record: ElementRecord): void {
  if (!hasNameOverride(record)) return;
  if (record.meta.editable === 'none') throw new Error(`元素 ${record.id} 不可重命名`);
  for (const properties of elementNonVisualProperties(document, record)) {
    setXmlAttribute(properties, 'name', record.ovr.name as string);
  }
}
