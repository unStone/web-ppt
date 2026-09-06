import { JSDOM } from 'jsdom';
import { unzipSync } from 'fflate';

// 系列标题与类别缓存是不同的 OOXML 类型；自家解析器能重开并不能证明 Office 能打开。
export async function testChartSeriesSchema({ core, edit, chart, bytes, cacheBytes, check }) {
  for (const [label, source] of [['工作簿', bytes], ['纯缓存', cacheBytes]]) {
    const presentation = await core.parse(source, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(presentation, { idPrefix: 'schema-' });
    const editor = new edit.Editor(doc);
    const api = chart.createChartDataEditor(editor);
    const touched = [];
    for (const item of chart.listEditableCharts(doc)) {
      const data = chart.queryChartData(doc, item.id);
      if (data.binding.mode === 'readonly') continue;
      for (const kind of data.plotKinds) api.addSeries(item.id, '新增 & <系列>', kind);
      touched.push(data.binding.chartPart);
    }
    const parts = unzipSync(await editor.save());
    for (const part of touched) {
      const dom = new JSDOM(new TextDecoder().decode(parts[part]), { contentType: 'application/xml' });
      const xml = dom.window.document;
      const ns = xml.documentElement.namespaceURI;
      const series = [...xml.getElementsByTagNameNS(ns, 'ser')];
      check(`${label} ${part} 系列标题只含 strRef 或 v`, series.every((node) => {
        const tx = [...node.children].find((child) => child.localName === 'tx');
        return tx && tx.children.length === 1 && ['strRef', 'v'].includes(tx.firstElementChild.localName);
      }));
      check(`${label} ${part} 所有系列在绘图区尾部设置之前`, series.every((node) => {
        const siblings = [...node.parentNode.children];
        return siblings.slice(0, siblings.indexOf(node)).every((child) =>
          !['dLbls', 'marker', 'gapWidth', 'overlap', 'axId', 'smooth', 'holeSize',
            'bubbleScale', 'dropLines', 'hiLowLines', 'upDownBars', 'extLst'].includes(child.localName));
      }));
      dom.window.close();
    }
    presentation.dispose();
  }
}
