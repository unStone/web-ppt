import { insertXmlChildUnchecked } from '../xml/nodes';
import { DRAWINGML_NS } from '../xml/qname';
import { setXmlAttribute } from '../xml/mutate';
import type { XmlElement } from '../xml/types';
import { namespacedElement } from './xml-element';

function colorParts(value: string): { hex: string; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) return { hex: hex.toUpperCase(), alpha: 1 };
  const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (!match) throw new Error(`无法写回颜色：${value}`);
  return {
    hex: match.slice(1, 4).map((part) => Math.round(Number(part)).toString(16).padStart(2, '0'))
      .join('').toUpperCase(),
    alpha: match[4] === undefined ? 1 : Number(match[4]),
  };
}

export function appendDrawingColor(parent: XmlElement, value: string): void {
  const { hex, alpha } = colorParts(value);
  const color = namespacedElement(parent, DRAWINGML_NS, 'srgbClr');
  setXmlAttribute(color, 'val', hex);
  insertXmlChildUnchecked(parent, color);
  if (alpha < 1) {
    const opacity = namespacedElement(color, DRAWINGML_NS, 'alpha');
    setXmlAttribute(opacity, 'val', String(Math.round(alpha * 100000)));
    insertXmlChildUnchecked(color, opacity);
  }
}
