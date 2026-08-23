import { attributeStates, elementStates, nodeState, nodeStates } from './state';
import type { XmlAttributeState, XmlElementState } from './state';
import { serializeElementOpen } from './mutate';
import { isXmlQName, namespaceForQName, splitQName, XML_NS } from './qname';
import type {
  XmlAttribute, XmlDocument, XmlElement, XmlNode, XmlProcessingInstruction, XmlQuote,
} from './types';

type XmlByteEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';
interface XmlByteState { encoding: XmlByteEncoding; bom: boolean; source: Uint8Array }
const byteStates = new WeakMap<XmlDocument, XmlByteState>();
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};
const isXmlWhitespace = (char: string | undefined): boolean =>
  char === ' ' || char === '\t' || char === '\r' || char === '\n';
const isNameDelimiter = (char: string | undefined): boolean =>
  isXmlWhitespace(char) || char === '=' || char === '/' || char === '>';

function isSelfClosingTag(openTag: string): boolean {
  let index = openTag.length - 2;
  while (isXmlWhitespace(openTag[index])) index--;
  return openTag[index] === '/';
}

function decodeXml(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[A-Za-z][\w.-]*);/gi, (source, reference: string) => {
    if (reference[0] !== '#') return ENTITIES[reference] ?? source;
    const hex = reference[1].toLowerCase() === 'x';
    const code = Number.parseInt(reference.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : source;
  });
}

function decodeBytes(source: Uint8Array): { text: string; encoding: XmlByteEncoding; bom: boolean } {
  let encoding: XmlByteEncoding = 'utf-8';
  let bom = false;
  let offset = 0;
  if (source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf) {
    bom = true;
    offset = 3;
  } else if (source[0] === 0xff && source[1] === 0xfe) {
    encoding = 'utf-16le';
    bom = true;
    offset = 2;
  } else if (source[0] === 0xfe && source[1] === 0xff) {
    encoding = 'utf-16be';
    bom = true;
    offset = 2;
  } else if (source[0] === 0x3c && source[1] === 0x00) {
    encoding = 'utf-16le';
  } else if (source[0] === 0x00 && source[1] === 0x3c) {
    encoding = 'utf-16be';
  }
  return { text: new TextDecoder(encoding, { fatal: true }).decode(source.subarray(offset)), encoding, bom };
}

function encodeBytes(text: string, encoding: XmlByteEncoding, bom: boolean): Uint8Array {
  if (encoding === 'utf-8') {
    const body = new TextEncoder().encode(text);
    if (!bom) return body;
    const bytes = new Uint8Array(body.length + 3);
    bytes.set([0xef, 0xbb, 0xbf]);
    bytes.set(body, 3);
    return bytes;
  }
  const bytes = new Uint8Array(text.length * 2 + (bom ? 2 : 0));
  let offset = 0;
  if (bom) {
    bytes.set(encoding === 'utf-16le' ? [0xff, 0xfe] : [0xfe, 0xff]);
    offset = 2;
  }
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (encoding === 'utf-16le') {
      bytes[offset++] = unit & 0xff;
      bytes[offset++] = unit >>> 8;
    } else {
      bytes[offset++] = unit >>> 8;
      bytes[offset++] = unit & 0xff;
    }
  }
  return bytes;
}

function declaredByteEncoding(document: XmlDocument): Omit<XmlByteState, 'source'> {
  const declaration = document.children.find((node): node is XmlProcessingInstruction =>
    node.type === 'processing-instruction' && node.target.toLowerCase() === 'xml');
  const match = declaration?.value.match(/\bencoding\s*=\s*(['"])([^'"]+)\1/i);
  const label = match?.[2].toLowerCase() ?? 'utf-8';
  const sourceBom = nodeState(document).raw.startsWith('\uFEFF');
  if (label === 'utf-8' || label === 'utf8') return { encoding: 'utf-8', bom: sourceBom };
  if (label === 'utf-16') return { encoding: 'utf-16le', bom: true };
  if (label === 'utf-16le') return { encoding: 'utf-16le', bom: sourceBom };
  if (label === 'utf-16be') return { encoding: 'utf-16be', bom: sourceBom };
  throw new Error(`无法按 XML 声明输出 ${match?.[2]} 字节；仅支持 UTF-8 与 UTF-16`);
}

interface RawAttribute {
  name: string;
  value: string;
  quote: XmlQuote;
  state: XmlAttributeState;
}

class PreservingXmlParser {
  private offset = 0;

  constructor(private readonly source: string) {}

  parse(): XmlDocument {
    const children: XmlNode[] = [];
    const document = { type: 'document', children, root: null } as unknown as XmlDocument;
    let root: XmlElement | null = null;
    while (this.offset < this.source.length) {
      const node = this.source[this.offset] === '<'
        ? this.parseMarkup(document, new Map())
        : this.parseText(document);
      children.push(node);
      if (node.type === 'element') {
        if (root) this.fail('XML 只能有一个根元素');
        root = node;
      } else if (node.type === 'text' && node.value.replace(/^\uFEFF/, '').trim()) {
        this.fail('根元素外不能出现文本');
      }
    }
    if (!root) this.fail('未找到根元素');
    Object.defineProperty(document, 'root', { value: root, enumerable: true });
    nodeStates.set(document, { raw: this.source, parent: null, dirty: false });
    return document;
  }

  private parseText(parent: XmlDocument | XmlElement): XmlNode {
    const start = this.offset;
    const end = this.source.indexOf('<', start);
    this.offset = end < 0 ? this.source.length : end;
    const raw = this.source.slice(start, this.offset);
    const node = { type: 'text', value: decodeXml(raw) } as const;
    nodeStates.set(node, { raw, parent, dirty: false });
    return node;
  }

  private parseMarkup(parent: XmlDocument | XmlElement, inheritedNs: ReadonlyMap<string, string>): XmlNode {
    const start = this.offset;
    if (this.source.startsWith('<!--', start)) {
      const end = this.source.indexOf('-->', start + 4);
      if (end < 0) this.fail('注释未闭合');
      this.offset = end + 3;
      const raw = this.source.slice(start, this.offset);
      const node = { type: 'comment', value: raw.slice(4, -3) } as const;
      nodeStates.set(node, { raw, parent, dirty: false });
      return node;
    }
    if (this.source.startsWith('<![CDATA[', start)) {
      const end = this.source.indexOf(']]>', start + 9);
      if (end < 0) this.fail('CDATA 未闭合');
      this.offset = end + 3;
      const raw = this.source.slice(start, this.offset);
      const node = { type: 'cdata', value: raw.slice(9, -3) } as const;
      nodeStates.set(node, { raw, parent, dirty: false });
      return node;
    }
    if (this.source.startsWith('<?', start)) return this.parseInstruction(parent);
    if (this.source.startsWith('<!', start)) return this.parseDeclaration(parent);
    if (this.source.startsWith('</', start)) this.fail('遇到意外的闭合标签');
    return this.parseElement(parent, inheritedNs);
  }

  private parseInstruction(parent: XmlDocument | XmlElement): XmlNode {
    const start = this.offset;
    const end = this.source.indexOf('?>', start + 2);
    if (end < 0) this.fail('处理指令未闭合');
    this.offset = end + 2;
    const raw = this.source.slice(start, this.offset);
    const body = raw.slice(2, -2);
    const split = body.search(/\s/);
    const node: XmlProcessingInstruction = {
      type: 'processing-instruction',
      target: split < 0 ? body : body.slice(0, split),
      value: split < 0 ? '' : body.slice(split).trimStart(),
    };
    nodeStates.set(node, { raw, parent, dirty: false });
    return node;
  }

  private parseDeclaration(parent: XmlDocument | XmlElement): XmlNode {
    const start = this.offset;
    let quote = '';
    let bracketDepth = 0;
    this.offset += 2;
    while (this.offset < this.source.length) {
      const char = this.source[this.offset++];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '[') bracketDepth++;
      else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
      else if (char === '>' && bracketDepth === 0) break;
    }
    if (this.source[this.offset - 1] !== '>') this.fail('声明未闭合');
    const raw = this.source.slice(start, this.offset);
    const node = { type: 'declaration', value: raw.slice(2, -1) } as const;
    nodeStates.set(node, { raw, parent, dirty: false });
    return node;
  }

  private parseElement(parent: XmlDocument | XmlElement, inheritedNs: ReadonlyMap<string, string>): XmlElement {
    const start = this.offset;
    const openEnd = this.scanOpenEnd(start);
    const openRaw = this.source.slice(start, openEnd + 1);
    const nameEnd = this.scanNameEnd(start + 1, openEnd);
    const name = this.source.slice(start + 1, nameEnd);
    if (!isXmlQName(name)) this.fail(`非法元素名 ${name || '(空)'}`);
    const rawAttributes = this.parseAttributes(openRaw, name.length + 1);
    const namespaces = new Map(inheritedNs);
    namespaces.set('xml', XML_NS);
    for (const attribute of rawAttributes) {
      if (attribute.name === 'xmlns') namespaces.set('', decodeXml(attribute.value));
      else if (attribute.name.startsWith('xmlns:')) {
        namespaces.set(attribute.name.slice(6), decodeXml(attribute.value));
      }
    }
    const attributes = rawAttributes.map((raw): XmlAttribute => {
      const parts = splitQName(raw.name);
      const attribute: XmlAttribute = {
        name: raw.name,
        prefix: parts.prefix,
        localName: parts.localName,
        namespaceUri: namespaceForQName(raw.name, namespaces, true),
        value: decodeXml(raw.value),
        quote: raw.quote,
      };
      attributeStates.set(attribute, raw.state);
      return attribute;
    });
    const parts = splitQName(name);
    const selfClosing = isSelfClosingTag(openRaw);
    const children: XmlNode[] = [];
    const element: XmlElement = {
      type: 'element',
      name,
      prefix: parts.prefix,
      localName: parts.localName,
      namespaceUri: namespaceForQName(name, namespaces, false),
      attributes,
      children,
      selfClosing,
    };
    this.offset = openEnd + 1;
    let closeRaw = '';
    if (!selfClosing) {
      while (this.offset < this.source.length && !this.source.startsWith('</', this.offset)) {
        const child = this.source[this.offset] === '<'
          ? this.parseMarkup(element, namespaces)
          : this.parseText(element);
        children.push(child);
      }
      if (!this.source.startsWith('</', this.offset)) this.fail(`元素 <${name}> 未闭合`);
      const closeStart = this.offset;
      const closeEnd = this.source.indexOf('>', closeStart + 2);
      if (closeEnd < 0) this.fail(`元素 <${name}> 未闭合`);
      const closeName = this.source.slice(closeStart + 2, closeEnd).trim();
      if (closeName !== name) this.fail(`闭合标签 </${closeName}> 与 <${name}> 不匹配`);
      this.offset = closeEnd + 1;
      closeRaw = this.source.slice(closeStart, this.offset);
    }
    const state: XmlElementState = {
      raw: this.source.slice(start, this.offset),
      parent,
      dirty: false,
      openRaw,
      closeRaw,
      sourceSelfClosing: selfClosing,
      // 源属性表必须与公开的当前属性表分离；删除/新增只改当前表，序列化仍靠源表定位原始字节。
      sourceAttributes: [...attributes],
      namespaces,
    };
    nodeStates.set(element, state);
    elementStates.set(element, state);
    return element;
  }

  private scanOpenEnd(start: number): number {
    let quote = '';
    for (let index = start + 1; index < this.source.length; index++) {
      const char = this.source[index];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') return index;
    }
    this.fail('开始标签未闭合');
  }

  private scanNameEnd(start: number, end: number): number {
    let index = start;
    while (index < end && !isNameDelimiter(this.source[index])) index++;
    return index;
  }

  private parseAttributes(openRaw: string, offset: number): RawAttribute[] {
    const attributes: RawAttribute[] = [];
    const names = new Set<string>();
    let index = offset;
    while (index < openRaw.length - 1) {
      const spacingStart = index;
      while (isXmlWhitespace(openRaw[index])) index++;
      if (openRaw[index] === '/' || openRaw[index] === '>' || index >= openRaw.length - 1) break;
      if (index === spacingStart) this.fail('属性前缺少空白');
      const nameStart = index;
      while (index < openRaw.length && !isNameDelimiter(openRaw[index])) index++;
      const name = openRaw.slice(nameStart, index);
      if (!isXmlQName(name)) this.fail(`非法属性名 ${name || '(空)'}`);
      if (names.has(name)) this.fail(`属性 ${name} 重复`);
      names.add(name);
      while (isXmlWhitespace(openRaw[index])) index++;
      if (openRaw[index++] !== '=') this.fail(`属性 ${name} 缺少等号`);
      while (isXmlWhitespace(openRaw[index])) index++;
      const quote = openRaw[index++] as XmlQuote;
      if (quote !== '"' && quote !== "'") this.fail(`属性 ${name} 必须使用引号`);
      const valueStart = index;
      const valueEnd = openRaw.indexOf(quote, valueStart);
      if (valueEnd < 0) this.fail(`属性 ${name} 未闭合`);
      index = valueEnd + 1;
      attributes.push({
        name,
        value: openRaw.slice(valueStart, valueEnd),
        quote,
        state: {
          source: true,
          present: true,
          changed: false,
          start: spacingStart,
          nameStart,
          valueStart,
          valueEnd,
          end: index,
        },
      });
    }
    return attributes;
  }

  private fail(message: string): never {
    throw new Error(`XML 解析失败（偏移 ${this.offset}）：${message}`);
  }
}

function serializeNode(node: XmlNode): string {
  const state = nodeState(node);
  if (!state.dirty || node.type !== 'element') return state.raw;
  const element = elementStates.get(node)!;
  const close = element.sourceSelfClosing && node.children.length ? `</${node.name}>` : element.closeRaw;
  return serializeElementOpen(node) + node.children.map(serializeNode).join('') + close;
}

/** 解析为可定点修改的保留型树；不依赖 DOM，可在 Worker 中运行。 */
export function parseXmlTree(source: string | Uint8Array): XmlDocument {
  if (typeof source === 'string') return new PreservingXmlParser(source).parse();
  const decoded = decodeBytes(source);
  const document = new PreservingXmlParser(decoded.text).parse();
  byteStates.set(document, { encoding: decoded.encoding, bom: decoded.bom, source });
  return document;
}

/** 未修改树逐字节回环；修改后的节点只重写自身最小语法片段。 */
export function serializeXmlTree(document: XmlDocument): string {
  const state = nodeState(document);
  if (!state.dirty) return state.raw;
  return document.children.map(serializeNode).join('');
}

/** 按输入 part 的 UTF-8 / UTF-16 字节序与 BOM 编码；未修改时连原始字节也不重建。 */
export function serializeXmlTreeBytes(document: XmlDocument): Uint8Array {
  const bytes = byteStates.get(document);
  if (bytes && !nodeState(document).dirty) return bytes.source.slice();
  const output = bytes ?? declaredByteEncoding(document);
  const text = serializeXmlTree(document).replace(/^\uFEFF/, '');
  return encodeBytes(text, output.encoding, output.bom);
}
