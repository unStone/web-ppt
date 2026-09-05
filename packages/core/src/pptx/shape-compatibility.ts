import { kids } from '../xml';
import type { SlideElement } from '../types';
import { MC_NAMESPACE, selectAlternateContent } from './markup-compatibility';

const SHAPE_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/presentationml/2006/main',
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://schemas.openxmlformats.org/officeDocument/2006/math',
  'http://schemas.microsoft.com/office/powerpoint/2010/main',
  'http://schemas.microsoft.com/office/drawing/2010/main',
]);

function hasUnsupported(elements: readonly SlideElement[]): boolean {
  return elements.some((element) => element.kind === 'unsupported'
    || element.kind === 'group' && hasUnsupported(element.children));
}

function sourceShapes(alternate: Element): Element[] {
  return Array.from(alternate.children).filter((branch) => branch.namespaceURI === MC_NAMESPACE)
    .flatMap((branch) => Array.from(branch.children).flatMap((node) =>
      node.namespaceURI === MC_NAMESPACE && node.localName === 'AlternateContent' ? sourceShapes(node) : [node]));
}

export function parseCompatibleShapes(
  alternate: Element,
  parse: (branch: Element) => SlideElement[],
  placeholder: (source: Element) => SlideElement | null,
  edit: boolean,
): SlideElement[] {
  if (alternate.namespaceURI !== MC_NAMESPACE) return [];
  const selected = selectAlternateContent(alternate, SHAPE_NAMESPACES);
  const source = kids(alternate, 'Choice').find((node) => node.namespaceURI === MC_NAMESPACE);
  let elements = selected ? parse(selected) : Array.from(source?.children ?? []).flatMap((node) => {
    const missing = placeholder(node);
    return missing ? [missing] : [];
  });
  // hook 已接入不代表当前数据能被解释；组内占位也算失败，不能再次用“非空”冒充支持。
  if (selected?.localName === 'Choice' && hasUnsupported(elements)) {
    const fallback = kids(alternate, 'Fallback').find((node) => node.namespaceURI === MC_NAMESPACE);
    const recovered = fallback ? parse(fallback) : [];
    if (recovered.length && !hasUnsupported(recovered)) elements = recovered;
  }
  // 分支只是同一源对象的投影，改内部内容会让其他 Office 版本显示不同结果。
  if (edit) {
    const moveLocked = sourceShapes(alternate).some((source) => placeholder(source)?.editInfo?.moveLocked);
    for (const element of elements) element.editInfo = {
      ...element.editInfo, editable: element.editInfo?.editable === 'none' ? 'none' : 'frame',
      requiresOriginal: true,
      ...(moveLocked ? { moveLocked: true } : {}),
    };
  }
  return elements;
}
