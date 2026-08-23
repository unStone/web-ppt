import { elementStates, markXmlDirty, nodeState, nodeStates } from './state';
import type { XmlElementState } from './state';
import { setXmlAttribute } from './mutate';
import { rebindXmlNamespaces } from './namespace';
import { assertXmlQName, splitQName } from './qname';
import type { XmlAttribute, XmlDocument, XmlElement, XmlNode, XmlQuote } from './types';

export interface CreateXmlElementOptions {
  attributes?: readonly (readonly [name: string, value: string, quote?: XmlQuote])[];
  selfClosing?: boolean;
}

/** 创建尚未挂树的 XML 元素；限定名由调用方决定，不强行改写文件已有前缀。 */
export function createXmlElement(name: string, options: CreateXmlElementOptions = {}): XmlElement {
  if ('namespaceUri' in options) {
    throw new Error('namespaceUri 由 QName 与 xmlns 声明决定，不能脱离序列化文本覆盖');
  }
  assertXmlQName(name, '元素');
  const parts = splitQName(name);
  const selfClosing = options.selfClosing !== false;
  const attributes: XmlAttribute[] = [];
  const children: XmlNode[] = [];
  const element: XmlElement = {
    type: 'element',
    name,
    prefix: parts.prefix,
    localName: parts.localName,
    namespaceUri: null,
    attributes,
    children,
    selfClosing,
  };
  const state: XmlElementState = {
    raw: selfClosing ? `<${name}/>` : `<${name}></${name}>`,
    parent: null,
    dirty: true,
    openRaw: selfClosing ? `<${name}/>` : `<${name}>`,
    closeRaw: selfClosing ? '' : `</${name}>`,
    sourceSelfClosing: selfClosing,
    sourceAttributes: [],
    namespaces: new Map(),
  };
  nodeStates.set(element, state);
  elementStates.set(element, state);
  for (const [attrName, value, quote] of options.attributes ?? []) {
    setXmlAttribute(element, attrName, value, quote);
  }
  return element;
}

function assertCanAttach(parent: XmlElement, child: XmlNode): void {
  const childState = nodeState(child);
  if (childState.parent) throw new Error('XML 节点已经属于另一棵树；请先显式移除');
  let current: XmlDocument | XmlNode | null = parent;
  while (current) {
    if (current === child) throw new Error('不能把 XML 节点插入自身后代');
    current = nodeState(current).parent;
  }
}

function adoptNamespaces(parent: XmlElement, child: XmlNode): void {
  if (child.type !== 'element') return;
  rebindXmlNamespaces(child, elementStates.get(parent)!.namespaces);
}

/** 在指定节点前插入；before 省略时追加。格式化空白由原父节点保持，不凭空重排已有内容。 */
export function insertXmlChildUnchecked(
  parent: XmlElement,
  child: XmlNode,
  before: XmlNode | null = null,
): number {
  assertCanAttach(parent, child);
  const children = parent.children as XmlNode[];
  let index = before === null ? children.length : children.indexOf(before);
  if (index < 0) throw new Error('before 不是该父元素的子节点');
  // 缩进空白位于“前一个元素与目标元素之间”。插入到目标前时复制这段空白，
  // 让新节点和原目标各得一份；既不格式化整棵树，也不会把两个标签粘在一起。
  let spacing = before !== null && index > 0 ? children[index - 1] : null;
  let inherited = spacing?.type === 'text' && !spacing.value.trim()
    ? createXmlText(spacing.value)
    : null;
  if (before === null && index > 0) {
    const closingSpacing = children[index - 1];
    if (closingSpacing.type === 'text' && !closingSpacing.value.trim()) {
      // 结束标签前的空白通常只有换行，没有子节点缩进；向前找上一位兄弟使用的缩进。
      spacing = [...children.slice(0, -1)].reverse()
        .find((node) => node.type === 'text' && !node.value.trim()) ?? null;
      const value = spacing?.type === 'text'
        ? spacing.value
        : closingSpacing.value.replace(/([^\r\n])?$/, '  $&');
      inherited = createXmlText(value);
      index--;
      children.splice(index, 0, inherited, child);
      index++;
    } else {
      children.splice(index, 0, child);
    }
  } else {
    children.splice(index, 0, child, ...(inherited ? [inherited] : []));
  }
  adoptNamespaces(parent, child);
  nodeState(child).parent = parent;
  if (inherited) nodeState(inherited).parent = parent;
  (parent as { selfClosing: boolean }).selfClosing = false;
  markXmlDirty(parent);
  return index;
}

/** 从父元素移除节点；节点可随后重新挂载。 */
export function removeXmlChild(parent: XmlElement, child: XmlNode): boolean {
  const children = parent.children as XmlNode[];
  const index = children.indexOf(child);
  if (index < 0) return false;
  const previous = children[index - 1];
  const next = children[index + 1];
  const ownsIndent = child.type === 'element'
    && previous?.type === 'text' && !previous.value.trim() && /[\r\n]/.test(previous.value)
    && next?.type === 'text' && !next.value.trim();
  if (ownsIndent) {
    children.splice(index - 1, 2);
    nodeState(previous).parent = null;
  } else {
    children.splice(index, 1);
  }
  nodeState(child).parent = null;
  (parent as { selfClosing: boolean }).selfClosing =
    elementStates.get(parent)!.sourceSelfClosing && children.length === 0;
  markXmlDirty(parent);
  return true;
}

/** 创建纯文本节点；序列化时按 XML 文本规则转义。 */
export function createXmlText(value: string): XmlNode {
  const node = { type: 'text', value } as const;
  const raw = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  nodeStates.set(node, { raw, parent: null, dirty: true });
  return node;
}
