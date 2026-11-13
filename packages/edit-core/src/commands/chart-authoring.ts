/**
 * AddChart 命令：在页面上插入一张原生可编辑图表。
 *
 * 补丁形态与 AddMedia 同型（元素树 insert + meta.insertion 携带 graphicFrame
 * 片段与关系）；图表部件与内嵌工作簿不走资源命名（ppt/media/*），而是像嵌入
 * 字体一样在 doc.chartResources 登记，由保存计划按 ppt/charts/chartN.xml 约定
 * 命名写出。生成在命令边界一次完成并 fast-fail，历史只存结构补丁与资源表。
 */
import type { EditDoc, ElementInsertionSource, ElementRecord } from '../types';
import type { ChartResourcePatch, CommandPatches, ExtensionCommand, Patch } from './types';
import { assertDataObject } from '../data-validation';
import { allocateElementId } from '../document';
import { elementOrder } from '../element-order';
import { fractionalIndexBetween } from '../fractional-index';
import { assertInsertionRect } from './insertion-rect';
import { resolveInsertionCanvas } from './insertion-host';
import { allocateElementSpid } from './spid';
import { relationshipIdAllocator } from './paste-resources';
import { relativeTarget } from '../clipboard-source';
import { bytesToBase64 } from '../clipboard-binary';
import { assertChartName, assertChartNumber } from '../chart/validation';
import { MAX_CHART_CELLS, MAX_CHART_POINTS, MAX_CHART_SERIES } from '../chart/limits';
import { CLASSIC_CHART_KINDS, CHARTEX_KINDS } from '../chart-authoring/types';
import type { AddChartCommand, AddChartData } from '../chart-authoring/types';
import type { ChartAuthoringResource } from '../types';
import { seedClassicChartXml } from '../chart-authoring/seed';
import { seedChartExXml } from '../chart-authoring/seed-chartex';
import { seedChartWorkbook } from '../chart-authoring/workbook';
import { seedGraphicFrameMarkup } from '../chart-authoring/frame';

const KINDS = new Set<string>([...CLASSIC_CHART_KINDS, ...CHARTEX_KINDS]);
const CHART_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const CHARTEX_TYPE = 'application/vnd.ms-office.chartex+xml';
const WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 股价图按 OHLC 顺序成组；饼族与复合饼单系列；曲面至少两个系列 */
function seriesRules(chart: AddChartData): string | null {
  const count = chart.series.length;
  if (chart.kind === 'stock' && count % 4 !== 0) return '股价图系列必须按 4 的倍数（开盘/最高/最低/收盘）';
  if ((chart.kind === 'pie' || chart.kind === 'pie3D' || chart.kind === 'ofPie') && count !== 1) return '饼族图表只支持一个数据系列';
  if ((chart.kind === 'surface' || chart.kind === 'surface3D') && count < 2) return '曲面图至少需要两个数据系列';
  return null;
}

function validateChart(chart: AddChartData): void {
  if (!chart || !KINDS.has(chart.kind)) throw new Error('图表类型无效');
  assertChartName(chart.title ?? '图表标题', '图表标题');
  if (!Array.isArray(chart.categories) || !chart.categories.length) throw new Error('图表类别不能为空');
  for (const category of chart.categories) assertChartName(category, '图表类别');
  if (!Array.isArray(chart.series) || !chart.series.length || chart.series.length > MAX_CHART_SERIES) throw new Error('图表系列数量无效');
  if (chart.barDir !== undefined && chart.barDir !== 'col' && chart.barDir !== 'bar') throw new Error('柱 / 条方向无效');
  if (chart.grouping !== undefined && !['clustered', 'stacked', 'percentStacked', 'standard'].includes(chart.grouping))
    throw new Error('图表分组无效');
  if (chart.ofPieType !== undefined && chart.ofPieType !== 'pie' && chart.ofPieType !== 'bar') throw new Error('复合饼次图形态无效');
  const hierarchical = chart.kind === 'sunburst' || chart.kind === 'treemap';
  const xy = chart.kind === 'scatter' || chart.kind === 'bubble';
  const stock = chart.kind === 'stock';
  let cells = 0;
  for (const series of chart.series) {
    assertChartName(series.name, '图表系列名称');
    if (!Array.isArray(series.values) || !series.values.length || series.values.length > MAX_CHART_POINTS)
      throw new Error('图表系列数据点数量无效');
    // 直方图 / 帕累托线只有数值列（分箱由查看器计算），不做类目对齐
    if (!xy && chart.kind !== 'histogram' && chart.kind !== 'paretoLine' && series.values.length !== chart.categories.length)
      throw new Error('图表系列数据点数与类别不匹配');
    const arrays = [series.values, ...(xy ? [series.x] : []), ...(chart.kind === 'bubble' ? [series.sizes] : [])];
    if (arrays.some((values) => !Array.isArray(values) || values.length !== series.values.length))
      throw new Error('图表 X/Y/大小数组形状不匹配');
    for (const values of arrays) for (const value of values!) assertChartNumber(value, '图表数值');
    if (hierarchical)
      for (const category of chart.categories)
        if (category.includes('/') && category.split('/').length > 8) throw new Error('分层类目最多 8 层');
    cells += series.values.length;
  }
  if (cells > MAX_CHART_CELLS) throw new Error('图表数据超过编辑器安全容量');
  const problem = seriesRules(chart);
  if (problem) throw new Error(problem);
  if (stock) {
    const length = chart.series[0].values.length;
    if (chart.series.some((series) => series.values.length !== length)) throw new Error('股价图各系列长度必须一致');
  }
}

/** 在现有包上分配约定命名的图表部件路径；生成保存（无原包）不支持插入图表。 */
/** 在现有包上分配约定命名的图表部件路径；生成保存（无原包）不支持插入图表。 */
function chartPartAllocator(doc: EditDoc): () => string {
  const used = new Set(Object.keys(doc.package!.parts));
  return () => {
    let serial = 1;
    while (used.has(`ppt/charts/chart${serial}.xml`)) serial++;
    used.add(`ppt/charts/chart${serial}.xml`);
    return `ppt/charts/chart${serial}.xml`;
  };
}

export function addChartPatches(doc: EditDoc, extension: ExtensionCommand, origin: string): CommandPatches {
  if (doc.meta.readonly || doc.meta.source !== 'pptx' || !doc.package) {
    throw new Error('只读、非 OOXML 或生成保存的编辑文档不能插入图表');
  }
  assertDataObject(extension.payload, ['type', 'slideId', 'rect', 'chart'], '图表命令');
  const command = extension.payload as AddChartCommand;
  if (command.type !== 'AddChart') throw new Error('不支持的图表命令');
  if (extension.id !== command.slideId) throw new Error('图表命令的画布身份不一致');
  assertInsertionRect(command.rect, 'AddChart.rect');
  validateChart(command.chart);
  const canvas = resolveInsertionCanvas(doc, command, '新增图表');
  const chart = command.chart;
  const classic = CLASSIC_CHART_KINDS.includes(chart.kind as never);
  const modern = CHARTEX_KINDS.includes(chart.kind as never);
  if (!classic && !modern) throw new Error('图表类型无效');

  // 部件分配：经典图一个图部件；现代图占 chartEx 与经典回退两个图部件。
  // 工作簿只有一份（经典图自带 externalData；现代图的回退经典图引用它）。
  const allocatePart = chartPartAllocator(doc);
  const chartPart = allocatePart();
  const fallbackPart = modern ? allocatePart() : null;
  const workbookPart = `ppt/embeddings/${chartPart.slice('ppt/charts/'.length, -'.xml'.length)}.xlsx`;
  if (doc.package!.parts[workbookPart]) throw new Error('图表工作簿部件路径与现有部件冲突');
  const workbook = seedChartWorkbook(classic ? chart : fallbackChart(chart));
  const style = {};
  const chartBytes = classic ? seedClassicChartXml(chart, workbook.series, workbook.categories, style) : seedChartExXml(chart, style);
  const fallback = fallbackPart
    ? { part: fallbackPart, bytes: seedClassicChartXml(fallbackChart(chart), workbook.series, workbook.categories, style) }
    : null;

  const id = allocateElementId(doc);
  const part = canvas.part;
  const spid = part ? allocateElementSpid(doc, part) : undefined;
  if (!part) throw new Error('图表命令缺少宿主部件');
  const allocateRelationshipId = relationshipIdAllocator(doc, part);
  const targetId = allocateRelationshipId();

  const markup = seedGraphicFrameMarkup({
    // 片段用占位 id 1，保存物化时经 spids 映射换成真实 spid
    shapeId: 1,
    name: chart.title ?? '图表',
    rect: command.rect,
    relationshipId: targetId,
    fallbackRelationshipId: fallback ? allocateRelationshipId() : undefined,
    modern,
  });
  const insertion: ElementInsertionSource = {
    markup: markup.value,
    namespaces: {
      'xmlns:p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'xmlns:c': 'http://schemas.openxmlformats.org/drawingml/2006/chart',
      'xmlns:cx': 'http://schemas.microsoft.com/office/drawing/2014/chartex',
      'xmlns:mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    },
    spids: spid === undefined ? {} : { '1': spid },
    relationships: [
      {
        sourceId: 'rIdChartSeed',
        targetId,
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
        target: relativeTarget(part, chartPart),
      },
      ...(fallback
        ? [
            {
              sourceId: 'rIdChartSeedFallback',
              targetId: markup.fallbackRelationshipId!,
              type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
              target: relativeTarget(part, fallback.part),
            },
          ]
        : []),
    ],
    resources: [],
  };

  const resource = {
    part: chartPart,
    mime: classic ? CHART_TYPE : CHARTEX_TYPE,
    kind: chart.kind,
    bytes: bytesToBase64(chartBytes),
    workbook: {
      part: workbookPart,
      mime: WORKBOOK_TYPE,
      bytes: bytesToBase64(workbook.bytes),
    },
    ...(fallback
      ? {
          fallback: {
            part: fallback.part,
            mime: CHART_TYPE,
            bytes: bytesToBase64(fallback.bytes),
          },
        }
      : {}),
  };
  const record: ElementRecord = {
    id,
    parent: canvas.id,
    z: (() => {
      const siblings = canvas.children;
      const previous = siblings.length ? elementOrder(doc.elements[siblings[siblings.length - 1]]) : null;
      return fractionalIndexBetween(previous, null, id);
    })(),
    ovr: {},
    src: {
      kind: 'group',
      ...(spid === undefined ? {} : { id: spid }),
      name: '图表',
      ...command.rect,
      rot: 0,
      flipH: false,
      flipV: false,
      childX: 0,
      childY: 0,
      scaleX: 1,
      scaleY: 1,
      children: [],
    },
    meta: {
      editable: 'frame',
      created: true,
      ...(part && spid !== undefined ? { origin: { part, spid }, insertion } : {}),
    },
    children: [],
  };
  const value = { root: record.id, parent: canvas.id, records: { [record.id]: record } };
  const resourcePath = ['chartResources', chartPart] as const;
  return {
    selection: { kind: 'elements', ids: [id], enteredGroup: null },
    forward: [
      { op: 'insert', path: ['elements', record.id], value, origin },
      { op: 'set', path: resourcePath, value: resource, origin },
    ],
    inverse: [
      { op: 'del', path: resourcePath, origin },
      { op: 'remove', path: ['elements', record.id], value, origin },
    ],
  };
}

/** 现代图的经典回退沿用同一份数据，退化为柱状图；分层类目拍平为单层 */
function fallbackChart(chart: AddChartData): AddChartData {
  const hierarchical = chart.kind === 'sunburst' || chart.kind === 'treemap';
  return {
    kind: 'bar',
    title: chart.title,
    categories: hierarchical ? chart.categories.map((path) => path.split('/').join(' ')) : chart.categories,
    series: chart.series.map((series) => ({ ...series })),
  };
}

export function isChartResourcePatch(patch: Patch): patch is ChartResourcePatch {
  return patch.path.length === 2 && patch.path[0] === 'chartResources';
}

export function applyChartResourcePatch(doc: EditDoc, patch: ChartResourcePatch): void {
  if (!doc.chartResources) doc.chartResources = {};
  if (patch.op === 'set') doc.chartResources[patch.path[1]] = patch.value as ChartAuthoringResource;
  else delete doc.chartResources[patch.path[1]];
}

export function validateChartResourcePatch(patch: ChartResourcePatch, index: number): void {
  if (patch.op === 'del') return;
  const resource = patch.value as Partial<ChartAuthoringResource> | undefined;
  if (!resource || typeof resource !== 'object') throw new Error(`Patch ${index} 的图表资源无效`);
  if (!/^ppt\/charts\/chart[^/]*\.xml$/.test(resource.part ?? '')) throw new Error(`Patch ${index} 的图表部件路径无效`);
  if (typeof resource.mime !== 'string' || !resource.mime) throw new Error(`Patch ${index} 的图表 MIME 无效`);
  if (typeof resource.kind !== 'string' || !KINDS.has(resource.kind)) throw new Error(`Patch ${index} 的图表类型无效`);
  if (typeof resource.bytes !== 'string' || !resource.bytes) throw new Error(`Patch ${index} 的图表字节无效`);
  if (!resource.workbook || typeof resource.workbook.part !== 'string' || typeof resource.workbook.bytes !== 'string')
    throw new Error(`Patch ${index} 的图表工作簿无效`);
  if (resource.fallback && (typeof resource.fallback.part !== 'string' || typeof resource.fallback.bytes !== 'string'))
    throw new Error(`Patch ${index} 的回退图部件无效`);
}
