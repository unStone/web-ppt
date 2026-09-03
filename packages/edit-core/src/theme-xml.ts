import { findXmlChild, findXmlDescendant, parseXmlTree, serializeXmlTreeBytes, setXmlAttribute } from './xml';
import { insertXmlChildUnchecked, replaceXmlChildren } from './xml/nodes';
import { DRAWINGML_NS } from './xml/qname';
import type { XmlElement } from './xml/types';
import { namespacedElement } from './save/xml-element';
import { themeHasOverrides } from './theme';
import type { ThemeRecord } from './types';

function rootElement(bytes: Uint8Array): { document: ReturnType<typeof parseXmlTree>; root: XmlElement } {
  const document = parseXmlTree(bytes);
  const root = document.children.find((node): node is XmlElement => node.type === 'element');
  if (!root) throw new Error('主题 part 缺少 XML 根节点');
  return { document, root };
}

function colorHex(value: string): string {
  const channels = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(value)?.slice(1).map(Number);
  if (!channels) throw new Error(`无法写回主题颜色：${value}`);
  return channels.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function patchColors(themeElements: XmlElement, record: ThemeRecord): void {
  const clrScheme = findXmlChild(themeElements, { localName: 'clrScheme' });
  if (!clrScheme) throw new Error(`主题缺少 clrScheme：${record.id}`);
  for (const [slot, value] of Object.entries(record.ovr.colors ?? {})) {
    const wrapper = findXmlChild(clrScheme, { localName: slot });
    if (!wrapper) throw new Error(`主题缺少颜色槽 ${slot}：${record.id}`);
    const current = wrapper.children.find((node): node is XmlElement => node.type === 'element');
    const color = namespacedElement(wrapper, DRAWINGML_NS, 'srgbClr');
    setXmlAttribute(color, 'val', colorHex(value));
    if (current) replaceXmlChildren(wrapper, current, [color]);
    else insertXmlChildUnchecked(wrapper, color);
  }
}

function patchFontCollection(parent: XmlElement, record: ThemeRecord, role: 'major' | 'minor'): void {
  const override = record.ovr.fonts?.[role];
  if (!override) return;
  const collection = findXmlChild(parent, { localName: `${role}Font` });
  if (!collection) throw new Error(`主题缺少 ${role}Font：${record.id}`);
  for (const field of ['latin', 'ea', 'cs'] as const) {
    if (override[field] === undefined) continue;
    const font = findXmlChild(collection, { localName: field });
    if (!font) throw new Error(`主题缺少字体字段 ${role}.${field}：${record.id}`);
    setXmlAttribute(font, 'typeface', override[field]);
  }
  for (const [script, typeface] of Object.entries(override.scripts ?? {})) {
    let font = collection.children.find((node): node is XmlElement =>
      node.type === 'element' && node.localName === 'font'
        && node.attributes.some((attribute) => attribute.localName === 'script' && attribute.value === script));
    if (!font) {
      font = namespacedElement(collection, DRAWINGML_NS, 'font');
      setXmlAttribute(font, 'script', script);
      insertXmlChildUnchecked(collection, font);
    }
    setXmlAttribute(font, 'typeface', typeface);
  }
}

/** 只触碰显式覆盖的字段；其它属性、扩展和词法节点由保留型 XML 树原样直通。 */
export function materializeThemePart(bytes: Uint8Array, record: ThemeRecord): Uint8Array {
  if (!themeHasOverrides(record)) return bytes;
  const { document, root } = rootElement(bytes);
  const themeElements = findXmlDescendant(root, { localName: 'themeElements' });
  if (!themeElements) throw new Error(`主题缺少 themeElements：${record.id}`);
  patchColors(themeElements, record);
  const fontScheme = findXmlChild(themeElements, { localName: 'fontScheme' });
  if (!fontScheme) throw new Error(`主题缺少 fontScheme：${record.id}`);
  patchFontCollection(fontScheme, record, 'major');
  patchFontCollection(fontScheme, record, 'minor');
  return serializeXmlTreeBytes(document);
}
