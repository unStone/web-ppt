/**
 * 最小 XML 解析器，产出与 DOM 兼容的只读节点。
 *
 * 存在的唯一理由：Web Worker 里没有 `DOMParser`（它是 Window-only API），
 * 而我们想把解析放进 Worker 让主线程零阻塞。
 * 只实现解析器实际用到的那几个 DOM 成员，不追求规范完备。
 */

export interface LiteAttr {
  name: string;
  localName: string;
  value: string;
}

export class LiteElement {
  readonly localName: string;
  readonly tagName: string;
  readonly attributes: LiteAttr[] = [];
  readonly childNodes: (LiteElement | string)[] = [];
  nextElementSibling: LiteElement | null = null;

  constructor(tagName: string) {
    this.tagName = tagName;
    const i = tagName.indexOf(':');
    this.localName = i < 0 ? tagName : tagName.slice(i + 1);
  }

  get firstElementChild(): LiteElement | null {
    for (const c of this.childNodes) if (typeof c !== 'string') return c;
    return null;
  }

  get children(): LiteElement[] {
    return this.childNodes.filter((c): c is LiteElement => typeof c !== 'string');
  }

  getAttribute(name: string): string | null {
    for (const a of this.attributes) if (a.name === name) return a.value;
    return null;
  }

  get textContent(): string {
    let out = '';
    for (const c of this.childNodes) out += typeof c === 'string' ? c : c.textContent;
    return out;
  }

  /** 只支持 '*'，与解析器里的用法一致 */
  getElementsByTagName(name: string): LiteElement[] {
    const out: LiteElement[] = [];
    const walk = (el: LiteElement): void => {
      for (const c of el.children) {
        if (name === '*' || c.localName === name || c.tagName === name) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function decode(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X'
        ? parseInt(ref.slice(2), 16)
        : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code >= 0 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[ref] ?? m;
  });
}

/** 解析 XML 文本；失败抛 Error（与 parseXml 的契约一致） */
export function parseXmlLite(text: string): LiteElement {
  let i = 0;
  const n = text.length;
  const stack: LiteElement[] = [];
  let root: LiteElement | null = null;

  const link = (parent: LiteElement, el: LiteElement): void => {
    const kids = parent.children;
    if (kids.length) kids[kids.length - 1].nextElementSibling = el;
    parent.childNodes.push(el);
  };

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;

    if (lt > i) {
      const raw = text.slice(i, lt);
      // 元素之间的纯空白不产生文本节点，避免 textContent 混入缩进
      if (stack.length && raw.trim()) stack[stack.length - 1].childNodes.push(decode(raw));
      else if (stack.length && raw.includes(' ')) stack[stack.length - 1].childNodes.push(raw);
    }

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      const body = text.slice(lt + 9, end < 0 ? n : end);
      if (stack.length) stack[stack.length - 1].childNodes.push(body);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
      continue;
    }

    // 闭合标签
    if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt);
      if (end < 0) break;
      stack.pop();
      i = end + 1;
      continue;
    }

    // 开标签：先切出标签体
    let gt = lt + 1;
    let quote = '';
    while (gt < n) {
      const c = text[gt];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      gt++;
    }
    if (gt >= n) break;

    const selfClose = text[gt - 1] === '/';
    const body = text.slice(lt + 1, selfClose ? gt - 1 : gt);

    // 标签名
    let p = 0;
    while (p < body.length && !/[\s/]/.test(body[p])) p++;
    const el = new LiteElement(body.slice(0, p));

    // 属性
    const attrRe = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    attrRe.lastIndex = p;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(body)) !== null) {
      const name = m[1];
      const ci = name.indexOf(':');
      el.attributes.push({
        name,
        localName: ci < 0 ? name : name.slice(ci + 1),
        value: decode(m[3] ?? m[4] ?? ''),
      });
    }

    if (stack.length) link(stack[stack.length - 1], el);
    else if (!root) root = el;

    if (!selfClose) stack.push(el);
    i = gt + 1;
  }

  if (!root) throw new Error('XML 解析失败：未找到根元素');
  return root;
}
