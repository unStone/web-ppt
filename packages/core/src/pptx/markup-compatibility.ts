export const MC_NAMESPACE = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** 能力由调用方声明；Requires 引用命名空间而非固定前缀，全部满足才能选择整个分支。 */
export function selectAlternateContent(alternate: Element, capabilities: ReadonlySet<string>): Element | null {
  if (alternate.namespaceURI !== MC_NAMESPACE) return null;
  let fallback: Element | null = null;
  for (let branch = alternate.firstElementChild; branch; branch = branch.nextElementSibling) {
    if (branch.namespaceURI !== MC_NAMESPACE) continue;
    if (branch.localName === 'Fallback') fallback ??= branch;
    if (branch.localName !== 'Choice') continue;
    const requires = branch.getAttribute('Requires')?.trim().split(/\s+/).filter(Boolean) ?? [];
    if (requires.length && requires.every((prefix) => {
      const namespace = branch!.lookupNamespaceURI(prefix);
      return namespace !== null && capabilities.has(namespace);
    })) return branch;
  }
  return fallback;
}
