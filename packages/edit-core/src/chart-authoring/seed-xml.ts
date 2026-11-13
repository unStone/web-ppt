import { createXmlElement, createXmlText, insertXmlChild, parseXmlTree, setXmlAttribute } from '../xml/index.js';
import type { XmlDocument, XmlElement, XmlNode } from '../xml/index.js';

export const SEED_NS = {
  chart: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  chartEx: 'http://schemas.microsoft.com/office/drawing/2014/chartex',
  drawing: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  presentation: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  office: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  relationships: 'http://schemas.openxmlformats.org/package/2006/relationships',
  types: 'http://schemas.openxmlformats.org/package/2006/content-types',
  spreadsheet: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  markupCompat: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
} as const;

export function seedElement(
  name: string,
  attributes: Readonly<Record<string, string | number>> = {},
  children: readonly (XmlNode | string)[] = [],
): XmlElement {
  const node = createXmlElement(name, { attributes: Object.entries(attributes).map(([key, value]) => [key, String(value)]) });
  for (const child of children) insertXmlChild(node, typeof child === 'string' ? createXmlText(child) : child);
  return node;
}

export function seedDocument(name: string, namespaces: Readonly<Record<string, string>>, children: readonly XmlElement[]): XmlDocument {
  const document = parseXmlTree(`<${name}/>`);
  for (const [prefix, namespace] of Object.entries(namespaces)) {
    const attribute = prefix ? `xmlns:${prefix}` : 'xmlns';
    setXmlAttribute(document.root, attribute, namespace);
  }
  for (const child of children) insertXmlChild(document.root, child);
  return document;
}
