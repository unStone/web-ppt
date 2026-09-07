import type { PresentationEditAsset } from '../types';
import type { PptxPackageReader } from './slide-inheritance';

const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const retained = new WeakMap<PptxPackageReader, Map<string, PresentationEditAsset>>();

/** 只保留兼容外壳引用的依赖；沿整页关系遍历会意外把所有母版和主题常驻内存。 */
export function retainCompatibilitySource(pkg: PptxPackageReader, host: Element, part: string): void {
  const files = pkg.files;
  if (!files) return;
  let assets = retained.get(pkg);
  if (!assets) retained.set(pkg, assets = new Map());
  const keep = (path: string): void => {
    const bytes = files[path];
    if (bytes) assets!.set(path, { url: `web-ppt-source:${path}`, mime: 'application/octet-stream', bytes });
  };
  const relsPart = (path: string): string => {
    const index = path.lastIndexOf('/') + 1;
    return `${path.slice(0, index)}_rels/${path.slice(index)}.rels`;
  };
  const visited = new Set<string>();
  const visit = (path: string): void => {
    if (visited.has(path) || !files[path]) return;
    visited.add(path);
    keep(path);
    keep(relsPart(path));
    for (const relation of Object.values(pkg.rels(path))) visit(relation.target);
  };
  keep(part);
  keep(relsPart(part));
  keep('[Content_Types].xml');
  const relations = pkg.rels(part);
  const scan = (node: Element): void => {
    // drawing 的 rId 藏在另一个 dataModel part 的非 r: 属性里，frame 自身并不引用它。
    if (node.localName === 'relIds' && node.namespaceURI?.endsWith('/diagram')) {
      for (const relation of Object.values(relations)) if (relation.type.endsWith('/diagramDrawing')) visit(relation.target);
    }
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.namespaceURI === OFFICE_REL_NS) {
        const relation = relations[attribute.value];
        if (relation) visit(relation.target);
      }
    }
    for (const child of Array.from(node.children)) scan(child);
  };
  scan(host);
}

export function compatibilityAssets(pkg: PptxPackageReader): PresentationEditAsset[] {
  return [...retained.get(pkg)?.values() ?? []];
}

export function releaseCompatibilitySource(pkg: PptxPackageReader): void {
  retained.delete(pkg);
}
