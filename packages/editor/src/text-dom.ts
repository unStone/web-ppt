import type { TextBody } from '@web-ppt/core';
import { TEXT_ATOM, textPositionAtIndex } from '@web-ppt/edit-core';
import type { TextPosition } from '@web-ppt/edit-core';

export interface DomRead { valid: boolean; text: string }

function readSemanticNode(node: Node): DomRead {
  if (node.nodeType === node.TEXT_NODE) return { valid: true, text: node.nodeValue ?? '' };
  if (node.nodeType !== node.ELEMENT_NODE) return { valid: true, text: '' };
  const element = node as HTMLElement;
  if (element.hasAttribute('data-bullet')) return { valid: true, text: '' };
  if (element.localName === 'svg' && element.hasAttribute('data-r')) {
    return { valid: true, text: TEXT_ATOM };
  }
  if (element.localName === 'br') return { valid: true, text: '\n' };
  let text = '';
  for (const child of element.childNodes) {
    const read = readSemanticNode(child);
    if (!read.valid) return read;
    text += read.text;
  }
  // 浏览器/输入法可能加 b/font/div 等私有包装；样式不可信，只接纳其中的纯文本。
  if (element.dataset.empty === 'true' && text.startsWith('\u00A0')) text = text.slice(1);
  return { valid: true, text };
}

/** 未知浏览器包装只取纯文本，格式绝不从 DOM 私有样式反写。 */
export function readEditableDom(root: ParentNode): DomRead {
  const paragraphs = [...root.querySelectorAll<HTMLElement>('[data-p]')]
    .filter((paragraph) => !paragraph.parentElement?.closest('[data-p]'));
  const values: string[] = [];
  for (const paragraph of paragraphs) {
    let text = '';
    for (const child of paragraph.childNodes) {
      const read = readSemanticNode(child);
      if (!read.valid) return read;
      text += read.text;
    }
    values.push(text);
  }
  return { valid: true, text: values.join('\n') };
}

function domPointIndex(root: HTMLElement, node: Node, offset: number): number | null {
  const range = root.ownerDocument.createRange();
  try {
    range.setStart(root, 0);
    range.setEnd(node, offset);
  } catch { return null; }
  const read = readEditableDom(range.cloneContents());
  return read.valid ? read.text.length : null;
}

export function rangePositions(
  root: HTMLElement,
  body: TextBody,
): { from: TextPosition; to: TextPosition } | null {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== root) return null;
  const from = domPointIndex(root, range.startContainer, range.startOffset);
  const to = domPointIndex(root, range.endContainer, range.endOffset);
  return from === null || to === null ? null : {
    from: textPositionAtIndex(body, from), to: textPositionAtIndex(body, to),
  };
}

export function caretPointAt(container: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = offset;
  for (let index = 0; index < container.childNodes.length; index++) {
    const child = container.childNodes[index];
    if (child.nodeType === child.TEXT_NODE) {
      const length = container.dataset.empty === 'true' && child.nodeValue === '\u00A0'
        ? 0 : child.nodeValue?.length ?? 0;
      if (remaining <= length) return { node: child, offset: Math.min(remaining, length) };
      remaining -= length;
      continue;
    }
    const read = readSemanticNode(child);
    if (!read.valid) continue;
    if (remaining <= read.text.length) {
      if (child instanceof HTMLElement && !['br', 'svg'].includes(child.localName)) {
        return caretPointAt(child, remaining);
      }
      return { node: container, offset: index + (remaining ? 1 : 0) };
    }
    remaining -= read.text.length;
  }
  return { node: container, offset: container.childNodes.length };
}

function changedRange(before: string, after: string): { from: number; to: number; text: string } {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return { from: prefix, to: before.length - suffix, text: after.slice(prefix, after.length - suffix) };
}

export function compositionChangedRange(
  before: string, after: string, from: number, to: number,
): { from: number; to: number; text: string } | null {
  const prefix = before.slice(0, from);
  const suffix = before.slice(to);
  if (after.length < prefix.length + suffix.length
    || !after.startsWith(prefix) || !after.endsWith(suffix)) return null;
  return { from, to, text: after.slice(prefix.length, after.length - suffix.length) };
}

export function rebaseRange(
  base: string, current: string, from: number, to: number,
): { from: number; to: number } | null {
  if (base === current) return { from, to };
  const remote = changedRange(base, current);
  if (remote.to <= from) {
    const delta = remote.text.length - (remote.to - remote.from);
    return { from: from + delta, to: to + delta };
  }
  if (remote.from >= to) return { from, to };
  return null;
}
