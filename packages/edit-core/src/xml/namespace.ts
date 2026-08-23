import { elementState } from './state';
import { namespaceForQName } from './qname';
import type { XmlElement } from './types';

function contextFrom(
  inherited: ReadonlyMap<string, string>,
  element: XmlElement,
): Map<string, string> {
  const namespaces = new Map(inherited);
  for (const attribute of element.attributes) {
    if (attribute.name === 'xmlns') namespaces.set('', attribute.value);
    else if (attribute.name.startsWith('xmlns:')) {
      namespaces.set(attribute.name.slice(6), attribute.value);
    }
  }
  return namespaces;
}

function inheritedContext(element: XmlElement): ReadonlyMap<string, string> {
  const parent = elementState(element).parent;
  return parent?.type === 'element' ? elementState(parent).namespaces : new Map();
}

/** 返回节点挂入指定父元素后限定名所代表的 URI，不要求先改变树结构。 */
export function namespaceUriOnAttach(parent: XmlElement, child: XmlElement): string | null {
  return namespaceForQName(child.name, contextFrom(elementState(parent).namespaces, child), false);
}

/** xmlns 改变会影响整棵后代；集中重绑，避免查询读到陈旧的展开名。 */
export function rebindXmlNamespaces(
  element: XmlElement,
  inherited: ReadonlyMap<string, string> = inheritedContext(element),
): void {
  const state = elementState(element);
  const namespaces = contextFrom(inherited, element);
  state.namespaces = namespaces;
  (element as { namespaceUri: string | null }).namespaceUri =
    namespaceForQName(element.name, namespaces, false);
  for (const attribute of element.attributes) {
    (attribute as { namespaceUri: string | null }).namespaceUri =
      namespaceForQName(attribute.name, namespaces, true);
  }
  for (const child of element.children) {
    if (child.type === 'element') rebindXmlNamespaces(child, namespaces);
  }
}
