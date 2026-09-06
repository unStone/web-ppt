import type { TextBody } from '@web-ppt/core';
import { textPositionAtIndex } from '@web-ppt/edit-core';
import { domPointAt } from '../text-dom';
import type { NativeTextFormat } from './native';

export function textRange(root: HTMLElement, text: TextBody, from: number, to: number): Range | null {
  const start = domPointAt(root, textPositionAtIndex(text, from));
  const end = domPointAt(root, textPositionAtIndex(text, to));
  if (!start || !end) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
  return range;
}

export function textBounds(root: HTMLElement, text: TextBody, from: number, to: number): DOMRect {
  const range = textRange(root, text, from, to);
  return range && typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : root.getBoundingClientRect();
}

let serial = 0;
export function compositionDecoration(root: HTMLElement) {
  const window = root.ownerDocument.defaultView! as unknown as {
    Highlight?: new (...ranges: Range[]) => unknown; CSS?: { highlights?: Map<string, unknown> };
  };
  const names: string[] = [], prefix = `webppt-ime-${++serial}-`;
  const style = root.ownerDocument.createElement('style'); root.ownerDocument.head.append(style);
  const clear = () => { names.forEach((name) => window.CSS?.highlights?.delete(name)); names.length = 0; style.textContent = ''; };
  return {
    update(text: TextBody, formats: readonly NativeTextFormat[]) {
      clear();
      if (!window.Highlight || !window.CSS?.highlights) return;
      const rules: string[] = [];
      formats.forEach((format, index) => {
        const range = textRange(root, text, format.rangeStart, format.rangeEnd);
        if (!range || format.underlineThickness === 'none') return;
        const name = `${prefix}${index}`;
        const lineStyle = ['solid', 'dotted', 'dashed', 'wavy'].includes(format.underlineStyle) ? format.underlineStyle : 'solid';
        window.CSS!.highlights!.set(name, new window.Highlight!(range)); names.push(name);
        rules.push(`::highlight(${name}){text-decoration:underline ${lineStyle};text-decoration-thickness:${format.underlineThickness === 'thick' ? '2px' : '1px'}}`);
      });
      style.textContent = rules.join('');
    },
    dispose() { clear(); style.remove(); },
  };
}
