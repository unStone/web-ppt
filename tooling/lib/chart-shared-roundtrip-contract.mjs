import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

const values = data => ({ categories: data.categories.map(({ label, levels }) => ({ label, levels })),
  series: data.series.map(({ name, plotKind, points }) => ({ name, plotKind,
    points: points.map(({ value, x, size }) => ({ value, x, size })) })) });

export async function testSharedRoundTrips({ core, edit, chart, assert }) {
  for (const variant of ['', '-views', '-disjoint', '-sheets', '-flat', '-cache']) {
    const input = readFileSync(`fixtures/sample-chart-shared${variant}.pptx`);
    for (const released of [false, true]) {
      const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
      const editor = new edit.Editor(edit.createDoc(presentation)), api = chart.createChartDataEditor(editor);
      const frames = chart.listEditableCharts(editor.doc), first = chart.queryChartData(editor.doc, frames[0].id);
      api.setValue(first.chartId, first.series[0].id, first.categories[1].id, 651);
      api.setCategoryLabel(first.chartId, first.categories[3].id, 'Round trip leaf');
      api.setSeriesName(first.chartId, first.series[0].id, 'Round trip series');
      const expected = frames.map(frame => values(chart.queryChartData(editor.doc, frame.id)));
      if (released) presentation.dispose();
      const saved = await editor.save();
      assert.deepEqual(await editor.save(), saved, '共享编辑连续保存字节稳定');
      const reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
      const actual = chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id));
      assert.deepEqual(actual.map(values), expected, `${variant || 'overlap'} ${released ? '释放来源后的生成保存' : '补丁保存'} 保留共享数据`);
      assert.ok(actual.every(data => data.binding.mode === (variant === '-cache' ? 'cache' : 'workbook')));
      const parts = unzipSync(saved);
      assert.match(strFromU8(parts['ppt/slides/_rels/slide3.xml.rels']), /charts\/chart1.xml/, '生成与补丁保存均保留原生共享引用');
      if (!variant) writeFileSync(`out/chart-shared/${released ? 'generated' : 'patched'}.pptx`, saved);
      if (variant === '-cache') assert.ok(!parts['ppt/embeddings/hierarchy1.xlsx']);
      edit.disposeDoc(doc); reopened.dispose(); editor.dispose(); presentation.dispose();
    }
  }
}
