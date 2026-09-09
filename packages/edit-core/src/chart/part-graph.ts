import type { EditDoc } from '../types';
import { findXmlAttribute, parseXmlTree, xmlElementChildren } from '@web-ppt/edit-core/xml';
import { chartSourceBytes } from './context';
import { chartPartForElement } from './locator';

const manifests = new WeakMap<Uint8Array, { parts: readonly string[]; charts: ReadonlySet<string> }>();

function manifestParts(bytes: Uint8Array | undefined) {
  const cached = bytes && manifests.get(bytes);
  if (cached) return cached;
  const parts: string[] = [], charts = new Set<string>();
  if (bytes) for (const node of xmlElementChildren(parseXmlTree(bytes).root, {
    localName: 'Override', namespaceUri: 'http://schemas.openxmlformats.org/package/2006/content-types',
  })) {
    const part = findXmlAttribute(node, { localName: 'PartName', namespaceUri: null })?.value.replace(/^\//, '');
    const type = findXmlAttribute(node, { localName: 'ContentType', namespaceUri: null })?.value;
    if (!part) continue;
    parts.push(part);
    if (type === 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml') charts.add(part);
  }
  const result = { parts, charts };
  if (bytes) manifests.set(bytes, result);
  return result;
}

export function nativeChartParts(doc: EditDoc) {
  const { parts, charts: known } = manifestParts(chartSourceBytes(doc, '[Content_Types].xml'));
  const charts = new Set(known);
  for (const record of Object.values(doc.elements)) {
    const part = chartPartForElement(doc, record.id);
    if (part) charts.add(part);
  }
  return { parts: [...new Set([...parts, ...charts])], charts };
}
