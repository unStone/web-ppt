import { parseXmlLite } from './xml-lite';

/**
 * 命名空间无关的 XML 访问工具。
 * OOXML 的前缀（p:/a:/r:）在不同生成器里不稳定，一律按 localName 匹配。
 */

// Web Worker 里没有 DOMParser（Window-only API），此时回退到自带的最小解析器。
// 两者结构等价，实测 xml-lite 约为原生的 1.8×，换来主线程零阻塞。
const nativeParser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;

export function parseXml(text: string): Element {
  if (!nativeParser) {
    // 只用到 localName / firstElementChild / nextElementSibling / children /
    // attributes / getAttribute / textContent / getElementsByTagName 这几个成员，
    // LiteElement 全部实现，因此这里的断言是安全的。
    return parseXmlLite(text) as unknown as Element;
  }
  const doc = nativeParser.parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('XML 解析失败: ' + (err.textContent ?? '').slice(0, 200));
  return doc.documentElement;
}

export function kids(el: Element | null, name: string): Element[] {
  const out: Element[] = [];
  if (!el) return out;
  for (let n = el.firstElementChild; n; n = n.nextElementSibling) {
    if (n.localName === name) out.push(n);
  }
  return out;
}

export function kid(el: Element | null, name: string): Element | null {
  if (!el) return null;
  for (let n = el.firstElementChild; n; n = n.nextElementSibling) {
    if (n.localName === name) return n;
  }
  return null;
}

export function walk(el: Element | null, ...path: string[]): Element | null {
  let cur = el;
  for (const name of path) {
    cur = kid(cur, name);
    if (!cur) return null;
  }
  return cur;
}

export function attr(el: Element | null, name: string): string | null {
  if (!el) return null;
  if (name.includes(':')) {
    for (const a of Array.from(el.attributes)) if (a.name === name) return a.value;
    const local = name.split(':')[1];
    for (const a of Array.from(el.attributes)) if (a.localName === local) return a.value;
    return null;
  }
  const v = el.getAttribute(name);
  if (v !== null) return v;
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
  return null;
}

export function numAttr(el: Element | null, name: string): number | null {
  const v = attr(el, name);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function boolAttr(el: Element | null, name: string, dflt = false): boolean {
  const v = attr(el, name);
  if (v === null) return dflt;
  return v === '1' || v === 'true';
}

/** EMU → CSS px */
export const emu = (v: number | null | undefined): number => (v ?? 0) / 9525;

/** 百分之一磅 → px */
export const pt100 = (v: number): number => (v / 100) * (96 / 72);
