import { serializeXmlTreeBytes } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import type { TemplateFillChart, TemplateFillChartSeries } from './types';
import type { SeedSeriesReferences } from './chart-seed-workbook';
import { SEED_NS as NS, seedDocument, seedElement as element } from './chart-seed-xml';

export interface SeedChartStyle {
  readonly textColor?: string;
  readonly fontFamily?: string;
}

function dataReference(kind: 'str' | 'num', formula: string, values: readonly (string | number | null)[]): XmlElement {
  const cache = element(`c:${kind}Cache`, {}, [
    ...(kind === 'num' ? [element('c:formatCode', {}, ['General'])] : []),
    element('c:ptCount', { val: values.length }),
    ...values.flatMap((value, index) => (value === null ? [] : [element('c:pt', { idx: index }, [element('c:v', {}, [String(value)])])])),
  ]);
  return element(`c:${kind}Ref`, {}, [element('c:f', {}, [formula]), cache]);
}

function color(style: SeedChartStyle): XmlElement {
  return element('a:solidFill', {}, [
    style.textColor ? element('a:srgbClr', { val: style.textColor }) : element('a:schemeClr', { val: 'tx1' }),
  ]);
}

function textProperties(style: SeedChartStyle): XmlElement {
  return element('c:txPr', {}, [
    element('a:bodyPr'),
    element('a:lstStyle'),
    element('a:p', {}, [
      element('a:pPr', {}, [
        element('a:defRPr', { sz: 1100 }, [
          color(style),
          element('a:latin', { typeface: style.fontFamily ?? '+mn-lt' }),
          element('a:ea', { typeface: style.fontFamily ?? '+mn-ea' }),
          element('a:cs', { typeface: style.fontFamily ?? '+mn-cs' }),
        ]),
      ]),
      element('a:endParaRPr', { lang: 'zh-CN' }),
    ]),
  ]);
}

function axis(kind: 'cat' | 'val', id: number, cross: number, position: 'b' | 'l'): XmlElement {
  return element(`c:${kind}Ax`, {}, [
    element('c:axId', { val: id }),
    element('c:scaling', {}, [element('c:orientation', { val: 'minMax' })]),
    element('c:delete', { val: 0 }),
    element('c:axPos', { val: position }),
    ...(kind === 'val' ? [element('c:majorGridlines'), element('c:numFmt', { formatCode: 'General', sourceLinked: 0 })] : []),
    element('c:majorTickMark', { val: 'none' }),
    element('c:minorTickMark', { val: 'none' }),
    element('c:tickLblPos', { val: 'nextTo' }),
    element('c:crossAx', { val: cross }),
    element('c:crosses', { val: 'autoZero' }),
    ...(kind === 'cat'
      ? [
          element('c:auto', { val: 1 }),
          element('c:lblAlgn', { val: 'ctr' }),
          element('c:lblOffset', { val: 100 }),
          element('c:noMultiLvlLbl', { val: 0 }),
        ]
      : [element('c:crossBetween', { val: 'between' })]),
  ]);
}

function series(
  chart: TemplateFillChart,
  source: TemplateFillChartSeries,
  index: number,
  references: SeedSeriesReferences,
  categoriesFormula: string,
): XmlElement {
  const xy = chart.type === 'scatter' || chart.type === 'bubble';
  const line = chart.type === 'line' || chart.type === 'scatter' || chart.type === 'radar';
  const paint = () => element('a:solidFill', {}, [element('a:schemeClr', { val: `accent${(index % 6) + 1}` })]);
  return element('c:ser', {}, [
    element('c:idx', { val: index }),
    element('c:order', { val: index }),
    element('c:tx', {}, [dataReference('str', references.name, [source.name])]),
    element('c:spPr', {}, [line ? element('a:ln', { w: 19050 }, [paint()]) : paint()]),
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
    ...(chart.type === 'bubble'
      ? [element('c:bubbleSize', {}, [dataReference('num', references.sizes!, source.sizes!)])]
      : chart.type === 'line' || chart.type === 'scatter'
        ? [element('c:smooth', { val: 0 })]
        : []),
  ]);
}

export function seedChartXml(
  chart: TemplateFillChart,
  references: readonly SeedSeriesReferences[],
  categoriesFormula: string,
  style: SeedChartStyle,
): Uint8Array {
  const pie = chart.type === 'pie' || chart.type === 'doughnut';
  const xy = chart.type === 'scatter' || chart.type === 'bubble';
  const xAxis = 48650001,
    yAxis = 48650002;
  const plot = element(`c:${chart.type}Chart`, {}, [
    ...(chart.type === 'bar'
      ? [element('c:barDir', { val: 'col' }), element('c:grouping', { val: 'clustered' })]
      : chart.type === 'line' || chart.type === 'area'
        ? [element('c:grouping', { val: 'standard' })]
        : chart.type === 'radar'
          ? [element('c:radarStyle', { val: 'marker' })]
          : chart.type === 'scatter'
            ? [element('c:scatterStyle', { val: 'lineMarker' })]
            : []),
    element('c:varyColors', { val: pie ? 1 : 0 }),
    ...chart.series.map((source, index) => series(chart, source, index, references[index], categoriesFormula)),
    ...(chart.type === 'bar' ? [element('c:gapWidth', { val: 150 })] : []),
    ...(pie ? [element('c:firstSliceAng', { val: 0 })] : []),
    ...(chart.type === 'doughnut' ? [element('c:holeSize', { val: 50 })] : []),
    ...(chart.type === 'bubble'
      ? [element('c:bubbleScale', { val: 100 }), element('c:showNegBubbles', { val: 0 }), element('c:sizeRepresents', { val: 'area' })]
      : []),
    ...(!pie ? [element('c:axId', { val: xAxis }), element('c:axId', { val: yAxis })] : []),
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
                    color(style),
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
  const document = seedDocument('c:chartSpace', { c: NS.chart, a: NS.drawing, r: NS.office }, [
    element('c:date1904', { val: 0 }),
    element('c:lang', { val: 'zh-CN' }),
    element('c:roundedCorners', { val: 0 }),
    element('c:chart', {}, [
      ...title,
      element('c:autoTitleDeleted', { val: chart.title ? 0 : 1 }),
      element('c:plotArea', {}, [
        element('c:layout'),
        plot,
        ...(!pie ? [axis(xy ? 'val' : 'cat', xAxis, yAxis, 'b'), axis('val', yAxis, xAxis, 'l')] : []),
      ]),
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
