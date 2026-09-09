import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

const values = data => ({ categories: data.categories.map(({ id, levels, label }) => ({ id, levels, label })),
  series: data.series.map(({ id, name, points }) => ({ id, name, points: points.map(({ id, value }) => ({ id, value })) })) });

export async function testSharedCacheHierarchy({ core, edit, chart, assert }) {
  const parse = bytes => core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  for (const [variant, depth, orientation] of [['', 2, 'rows'], ['-horizontal', 2, 'columns'], ['-three-level', 3, 'rows']]) {
    const input = readFileSync(`fixtures/sample-chart-shared-cache${variant}.pptx`);
    for (const single of [false, true]) for (const emptyFirst of [false, true]) for (const released of [false, true]) {
      let presentation = await parse(input), editor = new edit.Editor(edit.createDoc(presentation));
      let api = chart.createChartDataEditor(editor), frames = chart.listEditableCharts(editor.doc);
      if (single) {
        editor.exec({ type: 'RemoveElement', id: frames[2].id }); frames = chart.listEditableCharts(editor.doc);
      }
      const first = chart.queryChartData(editor.doc, frames[0].id);
      for (const category of first.categories.slice(depth)) api.removeCategory(first.chartId, category.id);
      for (const series of first.series) api.removeSeries(first.chartId, series.id);
      if (released) presentation.dispose();
      if (emptyFirst) {
        const saved = await editor.save(); editor.dispose(); presentation.dispose();
        presentation = await parse(saved); editor = new edit.Editor(edit.createDoc(presentation));
        api = chart.createChartDataEditor(editor); frames = chart.listEditableCharts(editor.doc);
        assert.ok(frames.every(frame => frame.binding.mode === 'cache'), '删空系列的方形层级模板可重开');
        if (released) presentation.dispose();
      }
      const current = chart.queryChartData(editor.doc, frames[0].id), series = api.addSeries(current.chartId, 'Rebuilt');
      api.setValue(current.chartId, series, current.categories[0].id, 431);
      api.setValue(current.chartId, series, current.categories[1].id, 0);
      const expected = frames.filter(frame => frame.binding.chartPart === 'ppt/charts/chart1.xml')
        .map(frame => values(chart.queryChartData(editor.doc, frame.id)));
      const saved = await editor.save(), parts = unzipSync(saved);
      const stem = `cache-square${variant}${emptyFirst ? '-empty' : ''}`;
      if (!single) writeFileSync(`out/chart-shared/${stem}-${released ? 'generated' : 'patched'}.pptx`, saved);
      else if (!emptyFirst && !released) writeFileSync(`out/chart-shared/cache-square-single${variant}.pptx`, saved);
      assert.ok(!Object.keys(parts).some(part => part.endsWith('.xlsx')), '纯缓存重建不会创建工作簿');
      assert.match(strFromU8(parts['ppt/charts/chart1.xml']), /<c:val><c:numLit>/, '新系列继续使用 literal，不能伪造数值公式提供方向');
      assert.deepEqual(parts['ppt/charts/chart2.xml'], unzipSync(input)['ppt/charts/chart2.xml']);
      const reopened = await parse(saved), doc = edit.createDoc(reopened);
      const actual = chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id));
      assert.ok(actual.every(data => data.binding.mode === 'cache'), `${stem} 保存重开后仍可编辑`);
      const affected = actual.filter(data => data.binding.chartPart === 'ppt/charts/chart1.xml');
      assert.deepEqual(affected.map(values), expected, '方形类别的层级、身份与数值往返保持');
      for (const data of affected) {
        assert.deepEqual(data.series[0].bindings.categories.hierarchy, { levels: depth, orientation });
      }
      edit.disposeDoc(doc); reopened.dispose(); editor.dispose(); presentation.dispose();
    }
  }
}
