/**
 * 新建 ChartEx 图表的 cx:chartSpace 生成（七类）。
 *
 * 数据维度沿用样本语料核实的口径：treemap / sunburst 用 size 维度与「/」分层
 * 类目（每层一个 cx:lvl），waterfall / funnel / boxWhisker 用 val；histogram 与
 * paretoLine 只给 numDim（分箱由查看器计算）。多系列时每系列一份 cx:data
 * （id 顺增、series 以 dataId 引用），与 PowerPoint 存出的结构一致。
 */
import { serializeXmlTreeBytes } from '../xml';
import type { XmlElement } from '../xml';
import type { AddChartData, AddChartSeries, ChartExKind } from './types';
import { SEED_NS as NS, seedDocument, seedElement as element } from './seed-xml';
import type { SeedChartOptions } from './seed';

const LAYOUT_IDS: Record<ChartExKind, string> = {
  boxWhisker: 'boxWhisker',
  funnel: 'funnel',
  histogram: 'histogram',
  paretoLine: 'paretoLine',
  sunburst: 'sunburst',
  treemap: 'treemap',
  waterfall: 'waterfall',
};

const NUM_DIM: Record<ChartExKind, 'size' | 'val'> = {
  boxWhisker: 'val',
  funnel: 'val',
  histogram: 'val',
  paretoLine: 'val',
  sunburst: 'size',
  treemap: 'size',
  waterfall: 'val',
};

const HIERARCHICAL: ReadonlySet<string> = new Set(['sunburst', 'treemap']);
const NEEDS_CAT: ReadonlySet<string> = new Set(['boxWhisker', 'funnel', 'sunburst', 'treemap', 'waterfall']);

/** 「A/B/C」→ 各层取值；平铺类目只有一层 */
function levels(categories: readonly string[], kind: ChartExKind): string[][] {
  if (!HIERARCHICAL.has(kind)) return [categories.slice()];
  const depth = Math.max(...categories.map((path) => path.split('/').length), 1);
  return Array.from({ length: depth }, (_, level) =>
    categories.map((path) => path.split('/')[level] ?? path.split('/')[path.split('/').length - 1]),
  );
}

function strDim(kind: ChartExKind, categories: readonly string[]): XmlElement {
  return element('cx:strDim', { type: 'cat' }, [
    ...levels(categories, kind).map((level) =>
      element('cx:lvl', { ptCount: level.length }, [...level.map((value, index) => element('cx:pt', { idx: index }, [value]))]),
    ),
  ]);
}

function numDim(type: 'size' | 'val', values: readonly (number | null)[]): XmlElement {
  return element('cx:numDim', { type }, [
    element('cx:lvl', { ptCount: values.length }, [
      ...values.map((value, index) => (value === null ? [] : [element('cx:pt', { idx: index }, [String(value)])])).flat(),
    ]),
  ]);
}

function dataEntry(id: number, kind: ChartExKind, chart: AddChartData, source: AddChartSeries): XmlElement {
  const categories = NEEDS_CAT.has(kind) ? [strDim(kind, chart.categories)] : [];
  return element('cx:data', { id }, [...categories, numDim(NUM_DIM[kind], source.values)]);
}

function seriesEntry(index: number, kind: ChartExKind, source: AddChartSeries, style: SeedChartOptions): XmlElement {
  const layoutPr = kind === 'boxWhisker' ? [element('cx:statistics', { quartileMethod: 'exclusive' })] : [];
  return element('cx:series', { layoutId: LAYOUT_IDS[kind], formatIdx: index }, [
    element('cx:tx', {}, [element('cx:txData', {}, [element('cx:v', {}, [source.name])])]),
    element('cx:dataId', { val: index }),
    element('cx:layoutPr', {}, layoutPr),
  ]);
}

function color(style: SeedChartOptions): XmlElement {
  return element('a:solidFill', {}, [
    style.textColor ? element('a:srgbClr', { val: style.textColor }) : element('a:schemeClr', { val: 'tx1' }),
  ]);
}

export function seedChartExXml(chart: AddChartData, style: SeedChartOptions): Uint8Array {
  const kind = chart.kind as ChartExKind;
  const document = seedDocument(
    'cx:chartSpace',
    {
      cx: NS.chartEx,
      a: NS.drawing,
      r: NS.office,
      mc: NS.markupCompat,
      modern: 'http://schemas.microsoft.com/office/drawing/2015/10/21/chartex',
    },
    [
      element(
        'cx:chartData',
        {},
        chart.series.map((source, index) => dataEntry(index, kind, chart, source)),
      ),
      element('cx:chart', {}, [
        ...(chart.title
          ? [
              element('cx:title', {}, [
                element('cx:tx', {}, [
                  element('cx:rich', {}, [
                    element('a:bodyPr'),
                    element('a:p', {}, [
                      element('a:r', {}, [
                        element('a:rPr', { lang: 'zh-CN', sz: 1400 }, [color(style)]),
                        element('a:t', {}, [chart.title]),
                      ]),
                    ]),
                  ]),
                ]),
              ]),
            ]
          : []),
        element('cx:plotArea', {}, [
          element(
            'cx:plotAreaRegion',
            {},
            chart.series.map((source, index) => seriesEntry(index, kind, source, style)),
          ),
        ]),
      ]),
    ],
  );
  return serializeXmlTreeBytes(document);
}
