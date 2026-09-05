import type { ElementRecord } from '../types';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import type { XmlDocument } from '../xml/types';
import { elementNonVisualProperties } from './xfrm';

export const hasAltTextOverride = (record: ElementRecord): boolean => !!record.ovr.altText;

export function patchElementAltText(document: XmlDocument, record: ElementRecord): void {
  if (!record.ovr.altText) return;
  if (record.meta.editable === 'none') throw new Error(`元素 ${record.id} 的替代文字不可写`);
  for (const properties of elementNonVisualProperties(document, record)) {
    for (const field of ['title', 'descr'] as const) {
      if (!Object.prototype.hasOwnProperty.call(record.ovr.altText, field)) continue;
      const value = record.ovr.altText[field]!;
      if (value) setXmlAttribute(properties, field, value);
      else removeXmlAttribute(properties, field);
    }
  }
}
