/**
 * 新建图表的原生内容生成：16 种经典绘图类型的 c:chartSpace。
 *
 * 结构与 PowerPoint 新建图表对齐：主题强调色（accent1..6 循环）、+mn 字体、
 * 右侧图例、类目 / 数值轴（3D 与曲面补系列轴）、externalData 指向内嵌工作簿。
 * 序列位全部按 dml-chart.xsd，产物要过 OOXML 门禁（桌面 005）。
 */
import { serializeXmlTreeBytes } from '../xml';
import type { XmlElement } from '../xml';
import type { AddChartSeries, AddChartData, ClassicChartKind } from './types';
import { SEED_NS as NS, seedDocument, seedElement as element } from './seed-xml';

export interface SeedSeriesReferences {
  readonly name: string;
  readonly values: string;
  readonly x?: string;
  readonly sizes?: string;
}

export interface SeedChartOptions {
  readonly textColor?: string;
  readonly fontFamily?: string;
}

const PLOT_TAGS: Record<ClassicChartKind, string> = {
  area: 'areaChart',
  area3D: 'area3DChart',
  bar: 'barChart',
  bar3D: 'bar3DChart',
  bubble: 'bubbleChart',
  doughnut: 'doughnutChart',
  line: 'lineChart',
  line3D: 'line3DChart',
  ofPie: 'ofPieChart',
  pie: 'pieChart',
  pie3D: 'pie3DChart',
  radar: 'radarChart',
  scatter: 'scatterChart',
  stock: 'stockChart',
  surface: 'surfaceChart',
  surface3D: 'surface3DChart',
};

/** 无类目轴的图组（饼族）；散点 / 气泡用双数值轴 */
const AXISLESS: ReadonlySet<string> = new Set(['pie', 'pie3D', 'doughnut', 'ofPie']);
const XY: ReadonlySet<string> = new Set(['scatter', 'bubble']);
/** 3D 图组带系列轴 */
const SERIES_AXIS: ReadonlySet<string> = new Set(['bar3D', 'line3D', 'surface', 'surface3D']);
/** 带 c:view3D 的图组（pie3D 的默认视角是正面的，PowerPoint 也不写 view3D） */
const VIEW_3D: ReadonlySet<string> = new Set(['bar3D', 'line3D', 'area3D', 'surface', 'surface3D']);
const STACKABLE: ReadonlySet<string> = new Set(['bar', 'bar3D', 'area', 'area3D']);

export const isAxislessKind = (kind: string): boolean => AXISLESS.has(kind);
export const isXyKind = (kind: string): boolean => XY.has(kind);

function dataReference(kind: 'str' | 'num', formula: string, values: readonly (string | number | null)[]): XmlElement {
  const cache = element(`c:${kind}Cache`, {}, [
    ...(kind === 'num' ? [element('c:formatCode', {}, ['General'])] : []),
    element('c:ptCount', { val: values.length }),
    ...values.flatMap((value, index) => (value === null ? [] : [element('c:pt', { idx: index }, [element('c:v', {}, [String(value)])])])),
  ]);
  return element(`c:${kind}Ref`, {}, [element('c:f', {}, [formula]), cache]);
}

function paint(style: SeedChartOptions): XmlElement {
  return element('a:solidFill', {}, [
    style.textColor ? element('a:srgbClr', { val: style.textColor }) : element('a:schemeClr', { val: 'tx1' }),
  ]);
}

function accent(index: number): XmlElement {
  return element('a:solidFill', {}, [element('a:schemeClr', { val: `accent${(index % 6) + 1}` })]);
}

function textProperties(style: SeedChartOptions): XmlElement {
  return element('c:txPr', {}, [
    element('a:bodyPr'),
    element('a:lstStyle'),
    element('a:p', {}, [
      element('a:pPr', {}, [
        element('a:defRPr', { sz: 1100 }, [
          paint(style),
          element('a:latin', { typeface: style.fontFamily ?? '+mn-lt' }),
          element('a:ea', { typeface: style.fontFamily ?? '+mn-ea' }),
          element('a:cs', { typeface: style.fontFamily ?? '+mn-cs' }),
        ]),
      ]),
      element('a:endParaRPr', { lang: 'zh-CN' }),
    ]),
  ]);
}

function axis(kind: 'cat' | 'val' | 'ser', id: number, cross: number, position: 'b' | 'l'): XmlElement {
  return element(`c:${kind}Ax`, {}, [
    element('c:axId', { val: id }),
    element('c:scaling', {}, [element('c:orientation', { val: 'minMax' })]),
    element('c:delete', { val: 0 }),
    element('c:axPos', { val: position }),
    ...(kind === 'val' ? [element('c:majorGridlines'), element('c:numFmt', { formatCode: 'General', sourceLinked: 0 })] : []),
    element('c:majorTickMark', { val: 'none' }),
    element('c:minorTickMark', { val: 'none' }),
    element('c:tickLblPos', { val: kind === 'ser' ? 'none' : 'nextTo' }),
    element('c:crossAx', { val: cross }),
    element('c:crosses', { val: 'autoZero' }),
    ...(kind === 'cat'
      ? [
          element('c:auto', { val: 1 }),
          element('c:lblAlgn', { val: 'ctr' }),
          element('c:lblOffset', { val: 100 }),
          element('c:noMultiLvlLbl', { val: 0 }),
        ]
      : kind === 'val'
        ? [element('c:crossBetween', { val: 'between' })]
        : []),
  ]);
}

function series(
  chart: AddChartData,
  source: AddChartSeries,
  index: number,
  references: SeedSeriesReferences,
  categoriesFormula: string,
): XmlElement {
  const kind = chart.kind as ClassicChartKind;
  const xy = XY.has(kind);
  const line = kind === 'line' || kind === 'line3D' || kind === 'scatter' || kind === 'radar';
  const smooth = kind === 'line' || kind === 'line3D' || kind === 'scatter';
  return element('c:ser', {}, [
    element('c:idx', { val: index }),
    element('c:order', { val: index }),
    element('c:tx', {}, [dataReference('str', references.name, [source.name])]),
    element('c:spPr', {}, [line ? element('a:ln', { w: 19050 }, [accent(index)]) : accent(index)]),
    ...(line ? [element('c:marker', {}, [element('c:symbol', { val: 'circle' }), element('c:size', { val: 5 })])] : []),
    ...(xy
      ? [
          element('c:xVal', {}, [dataReference('num', references.x!, source.x!)]),
          element('c:yVal', {}, [dataReference('num', references.values, source.values)]),
        ]
      : [
          element('c:cat', {}, [dataReference('str', categoriesFormula, chart.categories)]),
          element('c:val', {}, [dataReference('num', references.values, source.values)]),
        ]),
    ...(kind === 'bubble'
      ? [element('c:bubbleSize', {}, [dataReference('num', references.sizes!, source.sizes!)])]
      : smooth
        ? [element('c:smooth', { val: 0 })]
        : []),
  ]);
}

/** 图组标签内的独有子元素；序列位都在 ser 之前（barDir / grouping 等） */
function plotLeading(kind: ClassicChartKind, chart: AddChartData): XmlElement[] {
  if (kind === 'bar' || kind === 'bar3D')
    return [element('c:barDir', { val: chart.barDir ?? 'col' }), element('c:grouping', { val: chart.grouping ?? 'clustered' })];
  if (kind === 'area' || kind === 'area3D') return [element('c:grouping', { val: chart.grouping ?? 'standard' })];
  if (kind === 'line' || kind === 'line3D') return [element('c:grouping', { val: 'standard' })];
  if (kind === 'radar') return [element('c:radarStyle', { val: 'marker' })];
  if (kind === 'scatter') return [element('c:scatterStyle', { val: 'lineMarker' })];
  if (kind === 'ofPie') return [element('c:ofPieType', { val: chart.ofPieType ?? 'pie' })];
  return [];
}

/** 图组标签内 ser 之后的独有子元素 */
function plotTrailing(kind: ClassicChartKind, chart: AddChartData): XmlElement[] {
  const stackable = STACKABLE.has(kind) && chart.grouping !== undefined && chart.grouping !== 'clustered' && chart.grouping !== 'standard';
  return [
    ...(kind === 'bar' || kind === 'bar3D' ? [element('c:gapWidth', { val: 150 })] : []),
    ...(kind === 'bar' ? [element('c:overlap', { val: stackable ? 100 : 0 })] : []),
    ...(kind === 'pie' ? [element('c:firstSliceAng', { val: 0 })] : []),
    ...(kind === 'doughnut' ? [element('c:holeSize', { val: 50 })] : []),
    ...(kind === 'ofPie' ? [element('c:secondPieSize', { val: 75 }), element('c:serLines')] : []),
    ...(kind === 'bubble'
      ? [element('c:bubbleScale', { val: 100 }), element('c:showNegBubbles', { val: 0 }), element('c:sizeRepresents', { val: 'area' })]
      : []),
  ];
}

export function seedClassicChartXml(
  chart: AddChartData,
  references: readonly SeedSeriesReferences[],
  categoriesFormula: string,
  style: SeedChartOptions,
): Uint8Array {
  const kind = chart.kind as ClassicChartKind;
  const axisless = AXISLESS.has(kind);
  const xy = XY.has(kind);
  const hasSeriesAxis = SERIES_AXIS.has(kind);
  const xAxis = 48650001,
    yAxis = 48650002,
    serAxis = 48650003;
  const plot = element(`c:${PLOT_TAGS[kind]}`, {}, [
    ...plotLeading(kind, chart),
    ...(kind === 'stock' || kind === 'surface' || kind === 'surface3D'
      ? []
      : [element('c:varyColors', { val: AXISLESS.has(kind) ? 1 : 0 })]),
    ...chart.series.map((source, index) => series(chart, source, index, references[index], categoriesFormula)),
    ...plotTrailing(kind, chart),
    ...(axisless
      ? []
      : xy
        ? [element('c:axId', { val: xAxis }), element('c:axId', { val: yAxis })]
        : hasSeriesAxis
          ? [element('c:axId', { val: xAxis }), element('c:axId', { val: yAxis }), element('c:axId', { val: serAxis })]
          : [element('c:axId', { val: xAxis }), element('c:axId', { val: yAxis })]),
  ]);
  const title = chart.title
    ? [
        element('c:title', {}, [
          element('c:tx', {}, [
            element('c:rich', {}, [
              element('a:bodyPr'),
              element('a:lstStyle'),
              element('a:p', {}, [
                element('a:r', {}, [
                  element('a:rPr', { lang: 'zh-CN', sz: 1400 }, [
                    paint(style),
                    element('a:latin', { typeface: style.fontFamily ?? '+mn-lt' }),
                  ]),
                  element('a:t', {}, [chart.title]),
                ]),
              ]),
            ]),
          ]),
          element('c:overlay', { val: 0 }),
        ]),
      ]
    : [];
  const axes = axisless
    ? []
    : xy
      ? [axis('val', xAxis, yAxis, 'b'), axis('val', yAxis, xAxis, 'l')]
      : hasSeriesAxis
        ? [axis('cat', xAxis, yAxis, 'b'), axis('val', yAxis, serAxis, 'l'), axis('ser', serAxis, xAxis, 'b')]
        : [axis('cat', xAxis, yAxis, 'b'), axis('val', yAxis, xAxis, 'l')];
  const document = seedDocument('c:chartSpace', { c: NS.chart, a: NS.drawing, r: NS.office }, [
    element('c:date1904', { val: 0 }),
    element('c:lang', { val: 'zh-CN' }),
    element('c:roundedCorners', { val: 0 }),
    element('c:chart', {}, [
      ...title,
      element('c:autoTitleDeleted', { val: chart.title ? 0 : 1 }),
      ...(VIEW_3D.has(kind)
        ? [element('c:view3D', {}, [element('c:rotX', { val: 15 }), element('c:rotY', { val: 20 }), element('c:rAngAx', { val: 0 })])]
        : []),
      element('c:plotArea', {}, [element('c:layout'), plot, ...axes]),
      element('c:legend', {}, [element('c:legendPos', { val: 'r' }), element('c:layout'), element('c:overlay', { val: 0 })]),
      element('c:plotVisOnly', { val: 1 }),
      element('c:dispBlanksAs', { val: 'gap' }),
    ]),
    element('c:spPr', {}, [element('a:noFill'), element('a:ln', {}, [element('a:noFill')])]),
    textProperties(style),
    element('c:externalData', { 'r:id': 'rIdWorkbook' }, [element('c:autoUpdate', { val: 0 })]),
  ]);
  return serializeXmlTreeBytes(document);
}
