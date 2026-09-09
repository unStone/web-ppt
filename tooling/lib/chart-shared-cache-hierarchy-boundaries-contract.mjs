import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

export async function testSharedCacheHierarchyBoundaries({ core, edit, chart, assert }) {
  const parse = input => core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const changeHint = (input, value) => {
    const parts = unzipSync(input), part = 'ppt/charts/chart1.xml';
    parts[part] = strToU8(strFromU8(parts[part]).replace(/"categoryOrientation":"(?:rows|columns)",/,
      value === undefined ? '' : `"categoryOrientation":${JSON.stringify(value)},`));
    return zipSync(parts);
  };
  for (const [variant, depth, orientation] of [['', 2, 'rows'], ['-horizontal', 2, 'columns'], ['-three-level', 3, 'rows']]) {
    for (const hint of [undefined, 'diagonal', null]) {
      const bytes = changeHint(readFileSync(`out/chart-shared/cache-square${variant}-patched.pptx`), hint);
      const p = await parse(bytes), editor = new edit.Editor(edit.createDoc(p));
      const frames = chart.listEditableCharts(editor.doc);
      for (const frame of frames.filter(frame => frame.binding.chartPart === 'ppt/charts/chart1.xml')) {
        assert.equal(frame.binding.mode, 'readonly', '缺少合法方向的方形 literal 缓存保持只读');
        assert.match(frame.binding.reason, /方向/);
      }
      assert.equal(frames[1].binding.mode, 'cache', '损坏方向不影响独立图表');
      assert.deepEqual(await editor.save(), bytes, '不编辑损坏方向时原包不变');
      editor.dispose(); p.dispose();
    }
    const input = readFileSync(`fixtures/sample-chart-shared-cache${variant}.pptx`);
    const p = await parse(input), editor = new edit.Editor(edit.createDoc(p)), api = chart.createChartDataEditor(editor);
    const first = chart.queryChartData(editor.doc, chart.listEditableCharts(editor.doc)[0].id);
    for (const category of first.categories.slice(depth)) api.removeCategory(first.chartId, category.id);
    const wrong = changeHint(await editor.save(), orientation === 'rows' ? 'columns' : 'rows');
    const native = await parse(wrong), nativeDoc = edit.createDoc(native);
    const checked = chart.queryChartData(nativeDoc, chart.listEditableCharts(nativeDoc)[0].id);
    assert.equal(checked.binding.mode, 'cache');
    assert.equal(checked.series[0].bindings.categories.hierarchy.orientation, orientation, '明确的原生数值向量优先于附加方向提示');
    edit.disposeDoc(nativeDoc); native.dispose();
    for (const category of chart.queryChartData(editor.doc, first.chartId).categories) api.removeCategory(first.chartId, category.id);
    for (const series of first.series) api.removeSeries(first.chartId, series.id);
    const empty = await parse(await editor.save()), rebuilt = new edit.Editor(edit.createDoc(empty));
    const target = chart.listEditableCharts(rebuilt.doc)[0], rebuilding = chart.createChartDataEditor(rebuilt);
    assert.equal(target.binding.mode, 'cache', '类别和系列都删空后仍保留可重建的定义');
    for (let index = 0; index < depth; index++) rebuilding.addCategory(target.id,
      Array.from({ length: depth }, (_, level) => level === depth - 1 ? `Leaf ${index}` : index ? null : `Group ${level}`));
    rebuilding.addSeries(target.id, 'After empty');
    const roundtrip = await parse(await rebuilt.save()), doc = edit.createDoc(roundtrip);
    const actual = chart.queryChartData(doc, chart.listEditableCharts(doc)[0].id);
    assert.equal(actual.binding.mode, 'cache');
    assert.equal(actual.categories.length, depth);
    assert.deepEqual(actual.series[0].bindings.categories.hierarchy, { levels: depth, orientation });
    edit.disposeDoc(doc); roundtrip.dispose(); rebuilt.dispose(); empty.dispose(); editor.dispose(); p.dispose();
  }
}
