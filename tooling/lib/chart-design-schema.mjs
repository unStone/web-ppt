import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// 核对 Office 定义的序列与轴引用；重开成功无法捕获宽容解析器跳过的无效 XML。
export function verifyChartDesignXml(xml) {
  const dom = new JSDOM(xml, { contentType: 'application/xml' });
  const chart = dom.window.document, ns = chart.documentElement.namespaceURI;
  const sequences = {
    chart: 'title autoTitleDeleted pivotFmts view3D floor sideWall backWall plotArea legend plotVisOnly dispBlanksAs showDLblsOverMax extLst',
    barChart: 'barDir grouping varyColors ser dLbls gapWidth overlap serLines axId extLst',
    lineChart: 'grouping varyColors ser dLbls dropLines hiLowLines upDownBars marker smooth axId extLst',
    areaChart: 'grouping varyColors ser dLbls dropLines axId extLst',
    doughnutChart: 'varyColors ser dLbls firstSliceAng holeSize extLst',
    pieChart: 'varyColors ser dLbls firstSliceAng extLst',
    radarChart: 'radarStyle varyColors ser dLbls axId extLst',
    scatterChart: 'scatterStyle varyColors ser dLbls axId extLst',
    bubbleChart: 'varyColors ser dLbls bubble3D bubbleScale showNegBubbles sizeRepresents axId extLst',
  };
  for (const [name, sequence] of Object.entries(sequences)) {
    const order = sequence.split(' ');
    for (const node of chart.getElementsByTagNameNS(ns, name)) {
      const indices = [...node.children].filter((c) => c.namespaceURI === ns).map((c) => order.indexOf(c.localName));
      assert(indices.every((value, i) => value >= 0 && (i === 0 || value >= indices[i - 1])), `${name} 子节点顺序`);
    }
  }
  for (const area of chart.getElementsByTagNameNS(ns, 'plotArea')) {
    const children = [...area.children].filter((n) => n.namespaceURI === ns);
    const tail = children.findIndex((n) => ['dTable', 'spPr', 'extLst'].includes(n.localName));
    assert(tail < 0 || children.slice(tail).every((n) => !n.localName.endsWith('Ax')), '坐标轴在绘图区属性之前');
    const axes = children.filter((n) => n.localName.endsWith('Ax'));
    const ids = axes.map((n) => n.getElementsByTagNameNS(ns, 'axId')[0].getAttribute('val'));
    assert.equal(new Set(ids).size, ids.length, '坐标轴身份唯一');
    for (const axis of axes) assert(ids.includes(axis.getElementsByTagNameNS(ns, 'crossAx')[0].getAttribute('val')), '交叉轴指向现存轴');
  }
  dom.window.close();
}
