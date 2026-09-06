type Lookup = (source: string) => string;
const attributes = ['content', 'aria-label', 'title', 'alt', 'placeholder'];
const localized = /\p{Script=Han}|[。，、；：！？（）“”]/u;
const normalized = (source: string): string => source.replace(/\s+/g, ' ').trim();

interface TextBinding {
  readonly source: string;
  read(): string | null;
  write(value: string): void;
  previous: string | null;
}

/** 只认领页面骨架一次。文稿内容与后续 DOM 不会被遍历或按词猜测翻译。 */
export function bindStaticText(document: Document): (lookup: Lookup) => void {
  const bindings: TextBinding[] = [];
  for (const element of document.querySelectorAll('*')) {
    if (element.closest('script,style,[data-site-language],[data-site-user-content]')) continue;
    if (element.closest('.sample-card') && !element.hasAttribute('data-site-message')) continue;
    const encoded = element.getAttribute('data-site-text');
    const texts: Record<string, string> = encoded ? JSON.parse(encoded) : {};
    // 空译文序列化后不再有 Text 节点，仍须保留原槽位才能从英文镜像切回中文。
    for (const index of Object.keys(texts).map(Number).sort((a, b) => a - b)) {
      const node = element.childNodes[index];
      if (!node || node.nodeType !== 3) element.insertBefore(document.createTextNode(''), node ?? null);
    }
    element.childNodes.forEach((node, index) => {
      if (node.nodeType !== 3) return;
      const source = texts[index] ?? node.nodeValue ?? '';
      if (!localized.test(source)) return;
      texts[index] = source;
      bindings.push({ source, read: () => node.nodeValue, write: (value) => { node.nodeValue = value; },
        previous: node.nodeValue });
    });
    if (Object.keys(texts).length) element.setAttribute('data-site-text', JSON.stringify(texts));
    const sourceAttributes: Record<string, string> = JSON.parse(element.getAttribute('data-site-attrs') ?? '{}');
    for (const name of attributes) {
      const source = sourceAttributes[name] ?? element.getAttribute(name);
      if (source === null || !localized.test(source)) continue;
      sourceAttributes[name] = source;
      bindings.push({ source, read: () => element.getAttribute(name),
        write: (value) => element.setAttribute(name, value),
        previous: element.getAttribute(name) });
    }
    if (Object.keys(sourceAttributes).length) element.setAttribute('data-site-attrs', JSON.stringify(sourceAttributes));
  }
  return (lookup) => {
    for (const binding of bindings) {
      // 暂时移出 select 的静态选项仍属同一绑定，重新插入时也必须使用当前语言。
      // 产品代码已接管的状态或输入则不再覆盖；这里只持有启动时认领的固定节点集合。
      if (binding.read() !== binding.previous) continue;
      const value = binding.source.replace(/\S(?:[\s\S]*\S)?/, () => lookup(normalized(binding.source)));
      binding.write(value);
      binding.previous = value;
    }
  };
}
