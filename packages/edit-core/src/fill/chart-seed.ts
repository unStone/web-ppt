import { unzipSync } from 'fflate';
import type { OpcPackage } from '@web-ppt/core';
import {
  findXmlAttribute, findXmlChild, insertXmlChild, parseXmlTree, serializeXmlTreeBytes,
  xmlElementChildren,
} from '@web-ppt/edit-core/xml';
import type { XmlDocument, XmlElement } from '@web-ppt/edit-core/xml';
import { disposeOpcPackage, patchOpcPackage } from '../opc/patch';
import { relativeTarget, relationshipPartFor } from '../clipboard-source';
import { assertInsertionRect } from '../commands/insertion-rect';
import { assertChartName, assertChartNumber } from '../chart/validation';
import { MAX_CHART_CELLS, MAX_CHART_POINTS, MAX_CHART_SERIES } from '../chart/limits';
import type { TemplateFillChart } from './types';
import { TemplateFillError } from './errors';
import { seedChartWorkbook } from './chart-seed-workbook';
import { seedChartXml } from './chart-seed-chart';
import type { SeedChartStyle } from './chart-seed-chart';
import { SEED_NS as NS, seedDocument, seedElement as element } from './chart-seed-xml';

export interface TemplateChartPlacement extends SeedChartStyle {
  readonly slidePart: string;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly chart: TemplateFillChart;
  readonly rot?: number;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
}

const CHART_TYPES = new Set(['bar', 'line', 'pie', 'doughnut', 'area', 'scatter', 'radar', 'bubble']);
const CHART_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const attribute = (node: XmlElement, localName: string) =>
  findXmlAttribute(node, { localName, namespaceUri: null })?.value;

function invalid(message: string): never {
  throw new TemplateFillError('invalid-chart-data', message);
}

function validatePlacement(placement: TemplateChartPlacement): void {
  const { chart, rect } = placement;
  try { assertInsertionRect(rect, '图表框架'); }
  catch (error) { invalid(error instanceof Error ? error.message : String(error)); }
  if (placement.rot !== undefined && (!Number.isFinite(placement.rot)
    || Math.round(placement.rot * 60000) < -2147483648
    || Math.round(placement.rot * 60000) > 2147483647)) invalid('图表旋转角必须可写入 OOXML 角度');
  if ([placement.flipH, placement.flipV].some(value => value !== undefined && typeof value !== 'boolean')) invalid('图表翻转必须是布尔值');
  if (placement.textColor !== undefined && (typeof placement.textColor !== 'string'
    || !/^[0-9A-Fa-f]{6}$/.test(placement.textColor))) invalid('图表文字色必须是六位 sRGB 十六进制');
  if (placement.fontFamily !== undefined) assertChartName(placement.fontFamily, '图表字体');
  if (!chart || !CHART_TYPES.has(chart.type) || !Array.isArray(chart.categories) || !Array.isArray(chart.series)
    || !chart.series.length || chart.series.length > MAX_CHART_SERIES) invalid('图表类型、类别或系列数量无效');
  if (chart.title !== undefined) assertChartName(chart.title, '图表标题');
  for (const category of chart.categories) assertChartName(category, '图表类别');
  const xy = chart.type === 'scatter' || chart.type === 'bubble';
  let cells = 0;
  for (const series of chart.series) {
    assertChartName(series.name, '图表系列名称');
    if (!Array.isArray(series.values) || !series.values.length || series.values.length > MAX_CHART_POINTS
      || !xy && series.values.length !== chart.categories.length) invalid('图表系列数据点数与类别不匹配');
    const numbers = [series.values,
      ...(xy ? [series.x] : []), ...(chart.type === 'bubble' ? [series.sizes] : [])];
    if (numbers.some(values => !Array.isArray(values) || values.length !== series.values.length)) invalid('图表 X/Y/大小的数据形状不匹配');
    for (const values of numbers) for (const value of values!) assertChartNumber(value, '图表数值');
    cells += series.values.length;
  }
  if (cells > MAX_CHART_CELLS) invalid('图表数据超过现有编辑器的安全容量');
}

function shapeId(tree: XmlDocument): number {
  const pending = [tree.root];
  let highest = 1;
  while (pending.length) {
    const node = pending.pop()!;
    if (node.localName === 'cNvPr' && node.namespaceUri === NS.presentation) {
      const value = Number(attribute(node, 'id'));
      if (!Number.isSafeInteger(value) || value < 1 || value >= 0xffff_ffff) {
        throw new TemplateFillError('unsupported-template', '图表目标页包含无效或耗尽的 shape id');
      }
      highest = Math.max(highest, value);
    }
    pending.push(...xmlElementChildren(node));
  }
  return highest + 1;
}

function frame(id: number, relationshipId: string, placement: TemplateChartPlacement): XmlElement {
  const { rect } = placement;
  const emu = (value: number) => Math.round(value * 9525);
  return element('p:graphicFrame', { 'xmlns:p': NS.presentation, 'xmlns:a': NS.drawing,
    'xmlns:r': NS.office, 'xmlns:c': NS.chart }, [
    element('p:nvGraphicFramePr', {}, [element('p:cNvPr', { id, name: placement.chart.title ?? `图表 ${id}` }),
      element('p:cNvGraphicFramePr', {}, [element('a:graphicFrameLocks', { noGrp: 1 })]), element('p:nvPr')]),
    element('p:xfrm', { ...(placement.rot ? { rot: Math.round(placement.rot * 60000) } : {}),
      ...(placement.flipH ? { flipH: 1 } : {}), ...(placement.flipV ? { flipV: 1 } : {}) }, [
      element('a:off', { x: emu(rect.x), y: emu(rect.y) }), element('a:ext', { cx: emu(rect.w), cy: emu(rect.h) }),
    ]), element('a:graphic', {}, [element('a:graphicData', { uri: NS.chart }, [
      element('c:chart', { 'r:id': relationshipId }),
    ])]),
  ]);
}

function appendRelationship(tree: XmlDocument, type: string, target: string): string {
  if (tree.root.namespaceUri !== NS.relationships) throw new TemplateFillError('unsupported-template', '目标页关系根命名空间无效');
  const nodes = xmlElementChildren(tree.root, { localName: 'Relationship', namespaceUri: NS.relationships });
  const used = new Set(nodes.map(node => attribute(node, 'Id')));
  let serial = 1;
  while (used.has(`rIdTemplateChart${serial}`)) serial++;
  const id = `rIdTemplateChart${serial}`;
  insertXmlChild(tree.root, element('Relationship', { Id: id, Type: type, Target: target }));
  return id;
}

/** 这是纯生成阶段；已有页面和包资源只经保留型 XML 与 OPC 写入，不修改调用方字节。 */
export function seedTemplateCharts(bytes: Uint8Array, placements: readonly TemplateChartPlacement[]): Uint8Array {
  for (const placement of placements) validatePlacement(placement);
  if (!placements.length) return bytes.slice();
  let total = 0, count = 0;
  const parts = unzipSync(bytes, { filter(file) {
    total += file.originalSize;
    if (++count > 20_000 || file.originalSize > 64 * 1024 * 1024 || total > 512 * 1024 * 1024) {
      throw new TemplateFillError('resource-limit', '图表生成输入包解压规模超过安全上限');
    }
    return true;
  } });
  const types = parts['[Content_Types].xml'] && parseXmlTree(parts['[Content_Types].xml']);
  if (!types || types.root.namespaceUri !== NS.types) throw new TemplateFillError('unsupported-template', 'PPTX 缺少有效内容类型目录');
  const used = new Set(Object.keys(parts));
  for (const node of xmlElementChildren(types.root, { localName: 'Override', namespaceUri: NS.types })) {
    const part = attribute(node, 'PartName');
    if (part?.startsWith('/')) used.add(part.slice(1));
  }
  const changes: Record<string, Uint8Array> = Object.create(null);
  const slides = new Map<string, XmlDocument>(), relationships = new Map<string, XmlDocument>();
  let serial = 1;
  for (const placement of placements) {
    const source = parts[placement.slidePart];
    if (!source) throw new TemplateFillError('target-not-found', `图表目标页不存在：${placement.slidePart}`);
    const slide = slides.get(placement.slidePart) ?? parseXmlTree(source);
    slides.set(placement.slidePart, slide);
    if (slide.root.namespaceUri !== NS.presentation || slide.root.localName !== 'sld') {
      throw new TemplateFillError('unsupported-template', `图表目标不是标准 OOXML 页面：${placement.slidePart}`);
    }
    const common = findXmlChild(slide.root, { localName: 'cSld', namespaceUri: NS.presentation });
    const shapes = common && findXmlChild(common, { localName: 'spTree', namespaceUri: NS.presentation });
    if (!shapes) throw new TemplateFillError('unsupported-template', `图表目标页缺少形状树：${placement.slidePart}`);
    let chartPart: string, workbookPart: string, chartRelationships: string;
    do {
      chartPart = `ppt/charts/template-fill-chart${serial}.xml`;
      workbookPart = `ppt/embeddings/template-fill-chart${serial}.xlsx`;
      chartRelationships = relationshipPartFor(chartPart);
      serial++;
    } while ([chartPart, workbookPart, chartRelationships].some(part => used.has(part)));
    [chartPart, workbookPart, chartRelationships].forEach(part => used.add(part));
    const workbook = seedChartWorkbook(placement.chart);
    changes[workbookPart] = workbook.bytes;
    changes[chartPart] = seedChartXml(placement.chart, workbook.series, workbook.categories, placement);
    changes[chartRelationships] = serializeXmlTreeBytes(seedDocument('Relationships', { '': NS.relationships }, [
      element('Relationship', { Id: 'rIdWorkbook', Type: `${NS.office}/package`, Target: relativeTarget(chartPart, workbookPart) }),
    ]));
    for (const [part, contentType] of [[chartPart, CHART_TYPE], [workbookPart, WORKBOOK_TYPE]]) {
      insertXmlChild(types.root, element('Override', { PartName: `/${part}`, ContentType: contentType }));
    }
    const relsPart = relationshipPartFor(placement.slidePart);
    const rels = relationships.get(relsPart) ?? (parts[relsPart] ? parseXmlTree(parts[relsPart])
      : seedDocument('Relationships', { '': NS.relationships }, []));
    relationships.set(relsPart, rels);
    const rid = appendRelationship(rels, `${NS.office}/chart`, relativeTarget(placement.slidePart, chartPart));
    insertXmlChild(shapes, frame(shapeId(slide), rid, placement));
  }
  for (const [part, tree] of [...slides, ...relationships]) changes[part] = serializeXmlTreeBytes(tree);
  changes['[Content_Types].xml'] = serializeXmlTreeBytes(types);
  const pkg: OpcPackage = { format: 'pptx', bytes, parts, disposed: false };
  const result = patchOpcPackage(pkg, changes);
  disposeOpcPackage(result.package);
  return result.bytes;
}
