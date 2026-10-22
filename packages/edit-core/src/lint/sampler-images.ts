import { createXmlElement, findXmlChild, insertXmlChildUnchecked, parseXmlTree, serializeXmlTree, setXmlAttribute, xmlElementChildren } from '../xml/index';

/** 遮挡形状保留 alpha、统一绘黑；图片填充与普通图片同样不能泄漏 run 标记颜色。 */
export function blackenImages(svg: string): string {
  const tree = parseXmlTree(svg), root = tree.root;
  let defs = findXmlChild(root, { localName: 'defs' });
  if (!defs) { defs = createXmlElement('defs'); insertXmlChildUnchecked(root, defs, root.children[0] ?? null); }
  const id = 'lint-mask-image-black';
  const filter = createXmlElement('filter', { attributes: [['id', id], ['color-interpolation-filters', 'sRGB']] });
  insertXmlChildUnchecked(filter, createXmlElement('feColorMatrix', { attributes: [['type', 'matrix'], ['values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0']] }));
  insertXmlChildUnchecked(defs, filter);
  const visit = (node: typeof root): void => {
    if (node.localName === 'image') setXmlAttribute(node, 'filter', `url(#${id})`);
    for (const child of xmlElementChildren(node)) visit(child);
  };
  visit(root);
  return serializeXmlTree(tree);
}
