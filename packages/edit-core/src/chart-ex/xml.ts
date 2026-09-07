import { createXmlElement, createXmlText, insertXmlChildUnchecked as append, parseXmlTree,
  removeXmlChild, setXmlAttribute, serializeXmlTree, xmlElementChildren, cloneXmlNodeWithNamespaceClosure as clone } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import type { ChartExDataset } from '@web-ppt/core/chart-ex';

export const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const children = (node: XmlElement | null, name?: string) => node ? xmlElementChildren(node)
  .filter((n) => n.namespaceUri === node.namespaceUri && (!name || n.localName === name)) : [];
export const child = (node: XmlElement | null, name: string) => children(node, name)[0] ?? null;
export const attr = (node: XmlElement | null, name: string) => node?.attributes.find((a) => a.localName === name && !a.namespaceUri)?.value;
export const add = (parent: XmlElement, name: string, attrs: readonly (readonly [string, string])[] = [], value?: string) => {
  const node = createXmlElement(parent.prefix ? `${parent.prefix}:${name}` : name, { attributes: attrs });
  append(parent, node, child(parent, 'extLst'));
  if (value !== undefined) append(node, createXmlText(value));
  return node;
};

export interface ChartExState { data: ChartExDataset[]; rows: Record<string, (number | null)[]> }
export type DimensionFormula = (data: number, dimension: number) => string | undefined;

export function writeChartExData(source: string, state: ChartExState, formula?: DimensionFormula): string {
  const tree = parseXmlTree(source), data = child(tree.root, 'chartData');
  for (const [dataIndex, dataset] of state.data.entries()) {
    const target = children(data, 'data').find((n) => attr(n, 'id') === dataset.id);
    if (!target) throw new Error('ChartEx 数据源缺失');
    const dimensions = children(target).filter((n) => ['numDim', 'strDim'].includes(n.localName));
    for (const [dimIndex, dim] of dataset.dimensions.entries()) {
      const node = dimensions[dimIndex]; if (!node) throw new Error('ChartEx 维度源缺失');
      const originals = children(node, 'lvl').map((level) => clone(level, node));
      for (const item of children(node).filter((n) => ['f', 'lvl'].includes(n.localName))) removeXmlChild(node, item);
      const reference = formula?.(dataIndex, dimIndex);
      if (reference) {
        const f = add(node, 'f', [['dir', 'col']], reference);
        removeXmlChild(node, f); append(node, f, node.children[0] ?? null);
      } else { const nf = child(node, 'nf'); if (nf) removeXmlChild(node, nf); }
      for (const [at, values] of dim.levels.entries()) {
        const level = originals[at] ?? add(node, 'lvl');
        if (originals[at]) append(node, level, child(node, 'extLst'));
        setXmlAttribute(level, 'ptCount', String(values.length));
        for (const point of children(level, 'pt')) removeXmlChild(level, point);
        if (!originals[at] && dim.format) setXmlAttribute(level, 'formatCode', dim.format);
        for (const [index, value] of values.entries()) if (value !== null) add(level, 'pt', [['idx', String(index)]], String(value));
      }
    }
  }
  const region = child(child(child(tree.root, 'chart'), 'plotArea'), 'plotAreaRegion');
  for (const series of children(region, 'series')) {
    const map = state.rows[attr(child(series, 'dataId'), 'val') ?? '']; if (!map) continue;
    const remap = (parent: XmlElement | null, name: string, attribute: string) => {
      for (const node of children(parent, name)) {
        const index = map.indexOf(Number(attr(node, attribute)));
        if (index < 0) removeXmlChild(parent!, node); else setXmlAttribute(node, attribute, String(index));
      }
    };
    remap(series, 'dataPt', 'idx');
    remap(child(child(series, 'layoutPr'), 'subtotals'), 'idx', 'val');
    remap(child(series, 'dataLabels'), 'dataLabel', 'idx');
  }
  return serializeXmlTree(tree);
}
