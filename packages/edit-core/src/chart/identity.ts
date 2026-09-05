import {
  cloneXmlNodeWithNamespaceClosure, createXmlElement, createXmlText, removeXmlChild,
  insertXmlChildUnchecked, setXmlAttribute, xmlElementChildren,
} from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import type { ChartDatasetState, ChartPlotKind, ChartPointId, ChartSeriesId } from './types';
import {
  assertChartIdentity, CHART_PLOT_KINDS, MAX_CHART_CELLS, MAX_CHART_IDENTITY,
  MAX_CHART_POINTS, MAX_CHART_SERIES,
} from './validation';
import { orderedChartRecords } from './ordering';
import { chartXml, xmlAttribute as attr } from './xml-data';

export const CHART_IDENTITY_URI = 'urn:web-ppt:chart-data-identities:v1';
// 合法领域状态的最坏情况也必须能重开；JSON 中引号和反斜杠最多让身份文本翻倍。
const MAX_MANIFEST_TEXT = (MAX_CHART_CELLS + MAX_CHART_POINTS + MAX_CHART_SERIES * 2)
  * (MAX_CHART_IDENTITY * 2 + 32);

export interface ChartIdentityManifest {
  readonly categories: readonly ChartPointId[];
  readonly series: readonly { readonly id: ChartSeriesId; readonly points: readonly ChartPointId[] }[];
  readonly templates: readonly ChartIdentityTemplate[];
}

export interface ChartIdentityTemplate {
  readonly id: ChartSeriesId;
  readonly plotKind: ChartPlotKind;
  readonly sourceIndex: number;
  readonly points: readonly ChartPointId[];
  readonly node: XmlElement;
}

const { child, children } = chartXml;
function content(node: XmlElement | null): string | null {
  if (!node) return '';
  const chunks: string[] = [];
  let length = 0;
  const visit = (current: XmlElement): boolean => {
    for (const item of current.children) {
      if (item.type === 'element') {
        if (!visit(item)) return false;
      } else if (item.type === 'text' || item.type === 'cdata') {
        length += item.value.length;
        if (length > MAX_MANIFEST_TEXT) return false;
        chunks.push(item.value);
      }
    }
    return true;
  };
  return visit(node) ? chunks.join('') : null;
}
const qname = (parent: XmlElement, localName: string): string =>
  parent.prefix ? `${parent.prefix}:${localName}` : localName;

function validIds(values: unknown, label: string): ChartPointId[] | null {
  if (!Array.isArray(values) || values.length > MAX_CHART_POINTS) return null;
  const result: ChartPointId[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    try { assertChartIdentity(value, value as string, label); } catch { return null; }
    if (seen.has(value)) return null;
    seen.add(value);
    result.push(value as ChartPointId);
  }
  return result;
}

export function readChartIdentityManifest(root: XmlElement): ChartIdentityManifest | null {
  const ext = children(child(root, 'extLst'), 'ext')
    .find((item) => attr(item, 'uri') === CHART_IDENTITY_URI);
  const ids = ext && xmlElementChildren(ext, {
    localName: 'ids', namespaceUri: CHART_IDENTITY_URI,
  })[0];
  if (!ids) return null;
  const sourceText = content(ids);
  if (sourceText === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(sourceText); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const source = parsed as { categories?: unknown; series?: unknown; templates?: unknown };
  const categories = validIds(source.categories, '持久化类别身份');
  if (!categories || !Array.isArray(source.series) || source.series.length > MAX_CHART_SERIES) return null;
  const series: ChartIdentityManifest['series'][number][] = [];
  const seen = new Set<string>();
  let cells = 0;
  for (const item of source.series) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const value = item as { id?: unknown; points?: unknown };
    try { assertChartIdentity(value.id, value.id as string, '持久化系列身份'); } catch { return null; }
    if (seen.has(value.id as string)) return null;
    const points = validIds(value.points, '持久化数据点身份');
    if (!points || (cells += points.length) > MAX_CHART_CELLS) return null;
    seen.add(value.id as string);
    series.push({ id: value.id as ChartSeriesId, points });
  }
  const templateValues = source.templates ?? [];
  if (!Array.isArray(templateValues) || templateValues.length > CHART_PLOT_KINDS.size) return null;
  const templateNodes = new Map<string, XmlElement>();
  for (const wrapper of xmlElementChildren(ext!, {
    localName: 'template', namespaceUri: CHART_IDENTITY_URI,
  })) {
    const id = attr(wrapper, 'id');
    if (!id || templateNodes.has(id)) return null;
    const node = xmlElementChildren(wrapper, {
      localName: 'ser', namespaceUri: root.namespaceUri,
    })[0];
    if (!node) return null;
    templateNodes.set(id, node);
  }
  const templates: ChartIdentityTemplate[] = [];
  const templateKinds = new Set<ChartPlotKind>();
  for (const item of templateValues) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const value = item as { id?: unknown; plotKind?: unknown; sourceIndex?: unknown; points?: unknown };
    try { assertChartIdentity(value.id, value.id as string, '持久化模板系列身份'); } catch { return null; }
    if (!CHART_PLOT_KINDS.has(value.plotKind as ChartPlotKind)
      || !Number.isInteger(value.sourceIndex) || Number(value.sourceIndex) < 0
      || Number(value.sourceIndex) > 0x7fff_ffff || seen.has(value.id as string)
      || templateKinds.has(value.plotKind as ChartPlotKind)) return null;
    const points = validIds(value.points, '持久化模板数据点身份');
    const node = templateNodes.get(value.id as string);
    if (!points || !node || (cells += points.length) > MAX_CHART_CELLS) return null;
    seen.add(value.id as string);
    templateKinds.add(value.plotKind as ChartPlotKind);
    templates.push({
      id: value.id as ChartSeriesId,
      plotKind: value.plotKind as ChartPlotKind,
      sourceIndex: Number(value.sourceIndex), points, node,
    });
  }
  if (templateNodes.size !== templates.length) return null;
  return { categories, series, templates };
}

export function writeChartIdentityManifest(
  root: XmlElement, state: ChartDatasetState, physicalSeriesOrder?: readonly ChartSeriesId[],
  templates: readonly ChartIdentityTemplate[] = [],
): void {
  let extList = child(root, 'extLst');
  if (!extList) {
    extList = createXmlElement(qname(root, 'extLst'), { selfClosing: false });
    insertXmlChildUnchecked(root, extList);
  }
  let ext = children(extList, 'ext').find((item) => attr(item, 'uri') === CHART_IDENTITY_URI);
  if (!ext) {
    ext = createXmlElement(qname(extList, 'ext'), { selfClosing: false });
    setXmlAttribute(ext, 'uri', CHART_IDENTITY_URI);
    insertXmlChildUnchecked(extList, ext);
  }
  for (const node of [...ext.children]) removeXmlChild(ext, node);
  const orderedCategories = orderedChartRecords(
    Object.values(state.categories).filter((item) => !item.removed),
  );
  const orderedSeries = physicalSeriesOrder
    ? physicalSeriesOrder.flatMap((id) => {
      const item = state.series[id];
      return item && !item.removed ? [item] : [];
    })
    : orderedChartRecords(Object.values(state.series).filter((item) => !item.removed));
  const manifest = {
    categories: orderedCategories.map((item) => item.id),
    series: orderedSeries.map((item) => ({
      id: item.id,
      points: item.plotKind === 'scatter' || item.plotKind === 'bubble'
        ? orderedChartRecords(Object.values(item.points).filter((point) => !point.removed))
          .map((point) => point.id)
        : [],
    })),
    templates: templates.map((item) => ({
      id: item.id, plotKind: item.plotKind, sourceIndex: item.sourceIndex,
      points: item.plotKind === 'scatter' || item.plotKind === 'bubble' ? item.points : [],
    })),
  };
  const sourceText = JSON.stringify(manifest);
  if (sourceText.length > MAX_MANIFEST_TEXT) throw new Error('图表身份清单超过安全上限');
  const ids = createXmlElement('wppt:ids', {
    attributes: [['xmlns:wppt', CHART_IDENTITY_URI]], selfClosing: false,
  });
  insertXmlChildUnchecked(ids, createXmlText(sourceText));
  insertXmlChildUnchecked(ext, ids);
  for (const template of templates) {
    const wrapper = createXmlElement('wppt:template', {
      attributes: [['xmlns:wppt', CHART_IDENTITY_URI], ['id', template.id]], selfClosing: false,
    });
    insertXmlChildUnchecked(wrapper, cloneXmlNodeWithNamespaceClosure(template.node));
    insertXmlChildUnchecked(ext, wrapper);
  }
}
