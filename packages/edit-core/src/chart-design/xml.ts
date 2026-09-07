import { cloneXmlNodeWithNamespaceClosure as clone, createXmlElement, createXmlText, insertXmlChildUnchecked as insert,
  removeXmlChild as remove, parseXmlTree, serializeXmlTree, setXmlAttribute } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import { chartXml, makeDataElement as make, xmlAttribute as attr } from '../chart/xml-data';
import { CHART_PLOTS } from '../chart/plot-kinds';
import { MAX_CHART_POINTS } from '../chart/validation';
import type { ChartDesign, ChartType } from './types';

const { child, children } = chartXml;
const plotNames: Record<ChartType, string> = { bar: 'barChart', line: 'lineChart', area: 'areaChart',
  pie: 'pieChart', doughnut: 'doughnutChart', radar: 'radarChart', scatter: 'scatterChart', bubble: 'bubbleChart' };
const axisless = (kind: ChartType) => kind === 'pie' || kind === 'doughnut';
const xy = (kind: string) => kind === 'scatter' || kind === 'bubble';
const add = (parent: XmlElement, name: string, value?: string) => {
  const node = make(parent, name, value === undefined ? [] : [['val', value]]); insert(parent, node); return node;
};
const beforeTail = (parent: XmlElement, name: string, tail: readonly string[]) => {
  const node = make(parent, name);
  insert(parent, node, children(parent).find((item) => tail.includes(item.localName)) ?? null);
  return node;
};
const update = (parent: XmlElement, name: string, value: string) => {
  const node = child(parent, name) ?? add(parent, name); setXmlAttribute(node, 'val', value);
};
const drawing = (parent: XmlElement, name: string, attributes: [string, string][] = []) => {
  const namespace = parent.namespaceUri?.includes('purl.oclc.org')
    ? 'http://purl.oclc.org/ooxml/drawingml/main' : 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const node = createXmlElement(`a:${name}`, { attributes: [['xmlns:a', namespace], ...attributes] }); insert(parent, node); return node;
};

function seriesFor(source: XmlElement, plot: XmlElement, kind: ChartType) {
  const series = add(plot, 'ser');
  for (const name of ['idx', 'order', 'tx', 'spPr']) {
    const node = child(source, name); if (node) insert(series, clone(node, series));
  }
  if (kind === 'line' || kind === 'radar' || kind === 'scatter') {
    const marker = child(source, 'marker'); if (marker) insert(series, clone(marker, series));
  }
  for (const name of ['dPt', 'dLbls']) for (const node of children(source, name)) insert(series, clone(node, series));
  if (!axisless(kind) && kind !== 'radar') for (const name of ['trendline', 'errBars']) {
    for (const node of children(source, name)) insert(series, clone(node, series));
  }
  for (const name of xy(kind) ? ['xVal', 'yVal', 'bubbleSize'] : ['cat', 'val']) {
    if (name === 'bubbleSize' && kind !== 'bubble') continue;
    const node = child(source, name);
    if (node) insert(series, clone(node, series));
    else if (name === 'bubbleSize') {
      const holder = add(series, name), literal = add(holder, 'numLit');
      const values = child(child(source, 'yVal'), 'numRef');
      const cache = child(values, 'numCache') ?? child(child(source, 'yVal'), 'numLit');
      const count = Number(attr(child(cache, 'ptCount'), 'val')) || 0;
      if (!Number.isInteger(count) || count < 0 || count > MAX_CHART_POINTS) throw new Error('气泡数据点数量无效');
      add(literal, 'ptCount', String(count));
      for (let index = 0; index < count; index++) { const point = make(literal, 'pt', [['idx', String(index)]]); insert(literal, point); insert(add(point, 'v'), createXmlText('1')); }
    }
  }
  if (kind === 'line' || kind === 'scatter') add(series, 'smooth', '0');
  const extension = child(source, 'extLst'); if (extension) insert(series, clone(extension, series));
  return series;
}

function convert(plotArea: XmlElement, design: ChartDesign): XmlElement[] {
  const plots = children(plotArea).filter((node) => CHART_PLOTS[node.localName]);
  if (!plots.length) throw new Error('图表没有可编辑绘图区');
  const kind = design.type; if (!kind) return plots;
  if (plots.some((node) => xy(CHART_PLOTS[node.localName]) !== xy(kind))) throw new Error('类别图与 XY 图的数据轴不同，需要先提供对应的数据');
  const sources = plots.flatMap((node) => children(node, 'ser'));
  if (kind === 'pie' && sources.length > 1) throw new Error('饼图只支持一个数据系列');
  const plot = make(plotArea, plotNames[kind]); insert(plotArea, plot, plots[0] ?? null);
  if (kind === 'bar') add(plot, 'barDir', design.horizontal ? 'bar' : 'col');
  if (kind === 'bar' || kind === 'line' || kind === 'area') add(plot, 'grouping',
    groupingValue(kind, design.grouping));
  if (kind === 'radar') add(plot, 'radarStyle', 'marker');
  if (kind === 'scatter') add(plot, 'scatterStyle', 'lineMarker');
  add(plot, 'varyColors', axisless(kind) ? '1' : '0');
  for (const source of sources) seriesFor(source, plot, kind);
  if (design.labels !== undefined) add(add(plot, 'dLbls'), 'showVal', design.labels ? '1' : '0');
  if (kind === 'doughnut') add(plot, 'holeSize', '50');
  if (kind === 'bar' && design.grouping && design.grouping !== 'standard') add(plot, 'overlap', '100');
  if (!axisless(kind)) {
    const axes = chartAxes(plotArea, kind, design.horizontal === true);
    for (const axis of axes) add(plot, 'axId', attr(child(axis, 'axId'), 'val')!);
  } else for (const axis of children(plotArea).filter((n) => n.localName.endsWith('Ax'))) remove(plotArea, axis);
  for (const source of plots) remove(plotArea, source);
  return [plot];
}

const groupingValue = (kind: string, value?: string) =>
  value && value !== 'standard' ? value : kind === 'bar' ? 'clustered' : 'standard';

function chartAxes(area: XmlElement, kind: ChartType, horizontal: boolean): XmlElement[] {
  const source = children(area).filter((node) => node.localName.endsWith('Ax'));
  const axes: XmlElement[] = [];
  for (const [index, axisKind] of [xy(kind) ? 'valAx' : 'catAx', 'valAx'].entries()) {
    let axis = source.find((node) => !axes.includes(node) && (node.localName === axisKind
      || axisKind === 'catAx' && node.localName === 'dateAx'));
    if (!axis) {
      axis = beforeTail(area, axisKind, ['dTable', 'spPr', 'extLst']);
      add(axis, 'axId', String(1001 + index)); add(add(axis, 'scaling'), 'orientation', 'minMax');
      add(axis, 'delete', '0'); add(axis, 'axPos', 'b');
      add(axis, 'crossAx', '0'); add(axis, 'crosses', 'autoZero');
      if (axisKind === 'catAx') { add(axis, 'auto', '1'); add(axis, 'lblAlgn', 'ctr'); add(axis, 'lblOffset', '100'); }
    }
    update(axis, 'axId', String(1001 + index));
    update(axis, 'crossAx', String(index ? 1001 : 1002));
    update(axis, 'axPos', (index === 0) === (kind === 'bar' && horizontal) ? 'l' : 'b');
    axes.push(axis);
  }
  for (const axis of source) if (!axes.includes(axis)) remove(area, axis);
  return axes;
}

function recolor(series: XmlElement, color: string) {
  let properties = child(series, 'spPr');
  if (!properties) { properties = make(series, 'spPr'); insert(series, properties,
    children(series).find((n) => series.localName === 'dPt' ? n.localName === 'extLst'
      : !['idx', 'order', 'tx'].includes(n.localName)) ?? null); }
  for (const node of [...properties.children]) if (node.type === 'element'
    && ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill', 'ln'].includes(node.localName)) remove(properties, node);
  const fill = drawing(properties, 'solidFill'), line = drawing(properties, 'ln', [['w', '19050']]);
  drawing(fill, 'srgbClr', [['val', color.slice(1)]]);
  drawing(drawing(line, 'solidFill'), 'srgbClr', [['val', color.slice(1)]]);
  remove(properties, fill); remove(properties, line);
  const tail = properties.children.find((node) => node.type === 'element'
    && ['effectLst', 'effectDag', 'scene3d', 'sp3d', 'extLst'].includes(node.localName)) ?? null;
  insert(properties, fill, tail); insert(properties, line, tail);
}

export function applyChartDesign(xml: string | Uint8Array, design: ChartDesign): string {
  const tree = parseXmlTree(xml), chart = child(tree.root, 'chart'), area = child(chart, 'plotArea');
  if (!chart || !area) throw new Error('经典图表绘图区缺失');
  const plots = convert(area, design);
  if (!design.type) for (const plot of plots) {
    const kind = CHART_PLOTS[plot.localName];
    if (design.horizontal !== undefined && kind === 'bar') {
      update(plot, 'barDir', design.horizontal ? 'bar' : 'col');
      const ids = children(plot, 'axId').map((node) => attr(node, 'val'));
      for (const axis of children(area).filter((node) => ids.includes(attr(child(node, 'axId'), 'val')))) {
        update(axis, 'axPos', (axis.localName !== 'valAx') === design.horizontal ? 'l' : 'b');
      }
    }
    if (design.grouping !== undefined && ['bar', 'line', 'area'].includes(kind)) {
      const group = child(plot, 'grouping') ?? beforeTail(plot, 'grouping', ['varyColors', 'ser', 'dLbls', 'axId', 'extLst']);
      setXmlAttribute(group, 'val', groupingValue(kind, design.grouping));
      if (kind === 'bar') {
        const overlap = child(plot, 'overlap') ?? beforeTail(plot, 'overlap', ['serLines', 'axId', 'extLst']);
        setXmlAttribute(overlap, 'val', design.grouping === 'standard' ? '0' : '100');
      }
    }
  }
  const palette = design.palette;
  if (palette?.length) {
    let index = 0;
    for (const plot of plots) for (const series of children(plot, 'ser')) {
      const color = palette[index++ % palette.length]; recolor(series, color);
      if (['pie', 'doughnut', 'ofPie'].includes(CHART_PLOTS[plot.localName])) {
        const val = child(series, 'val'), cache = child(child(val, 'numRef'), 'numCache') ?? child(val, 'numLit');
        for (const point of children(cache, 'pt')) {
          const idx = attr(point, 'idx') ?? '0';
          let pointStyle = children(series, 'dPt').find((node) => attr(child(node, 'idx'), 'val') === idx);
          if (!pointStyle) { pointStyle = beforeTail(series, 'dPt', ['dLbls', 'cat', 'val', 'extLst']); add(pointStyle, 'idx', idx); }
          recolor(pointStyle, palette[Number(idx) % palette.length] ?? color);
        }
      } else for (const point of children(series, 'dPt')) recolor(point, color);
    }
  }
  if (design.labels !== undefined && !design.type) for (const plot of plots) {
    const labels = child(plot, 'dLbls') ?? beforeTail(plot, 'dLbls', ['dropLines', 'hiLowLines', 'upDownBars',
      'gapWidth', 'overlap', 'serLines', 'firstSliceAng', 'holeSize', 'bubble3D', 'bubbleScale', 'showNegBubbles', 'sizeRepresents', 'marker', 'smooth', 'axId', 'extLst']);
    const show = child(labels, 'showVal') ?? beforeTail(labels, 'showVal', ['showCatName', 'showSerName', 'showPercent', 'showBubbleSize', 'separator', 'showLeaderLines', 'leaderLines', 'extLst']);
    setXmlAttribute(show, 'val', design.labels ? '1' : '0');
  }
  if (design.legend !== undefined) {
    const previous = child(chart, 'legend'); if (previous) remove(chart, previous);
    if (design.legend !== 'none') {
      const legend = make(chart, 'legend'); insert(chart, legend, children(chart).find((n) => ['plotVisOnly', 'dispBlanksAs', 'showDLblsOverMax', 'extLst'].includes(n.localName)) ?? null);
      add(legend, 'legendPos', { left: 'l', right: 'r', top: 't', bottom: 'b' }[design.legend]); add(legend, 'overlay', '0');
    }
  }
  if (design.title !== undefined) {
    const previous = child(chart, 'title'); if (previous) remove(chart, previous);
    const auto = child(chart, 'autoTitleDeleted') ?? beforeTail(chart, 'autoTitleDeleted', ['pivotFmts', 'view3D', 'floor', 'sideWall', 'backWall', 'plotArea', 'legend', 'plotVisOnly', 'extLst']);
    setXmlAttribute(auto, 'val', design.title ? '0' : '1');
    if (!design.title) return serializeXmlTree(tree);
    const title = make(chart, 'title'); insert(chart, title, chart.children[0] ?? null);
    const rich = add(add(title, 'tx'), 'rich'); drawing(rich, 'bodyPr'); drawing(rich, 'lstStyle');
    const run = drawing(drawing(rich, 'p'), 'r'); insert(drawing(run, 't'), createXmlText(design.title));
    add(title, 'overlay', '0');
  }
  return serializeXmlTree(tree);
}
