import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

export async function testSharedGrowth({ core, edit, chart, assert }) {
  for (const variant of ['', '-views', '-disjoint', '-sheets', '-occupied', '-horizontal', '-flat', '-metadata', '-merged', '-array-formula']) for (const released of [false, true]) {
    const input = readFileSync(`fixtures/sample-chart-shared${variant}.pptx`);
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(presentation)), api = chart.createChartDataEditor(editor);
    const frames = chart.listEditableCharts(editor.doc), views = () => frames.map(frame => chart.queryChartData(editor.doc, frame.id));
    const original = views(), first = original[0], third = original[2];
    const series = api.addSeries(first.chartId, 'Added shared series');
    assert.deepEqual(views().map(data => data.series.length), [3, 2, 3], '新增系列属于图表部件，同部件框架共享成员关系');
    assert.equal(views()[2].series.at(-1).id, series, '新增系列身份不依附于单一框架');
    api.setValue(first.chartId, series, first.categories[1].id, 785);
    api.setSeriesName(third.chartId, series, 'Renamed shared series');
    api.removeCategory(first.chartId, first.categories[0].id);
    const added = views().filter((_, index) => index !== 1).map(data => data.series.find(item => item.id === series));
    assert.ok(added.every(item => item.name === 'Renamed shared series' && item.points[0].value === 785),
      '来源删行后新增系列仍按稳定类别身份取值');
    if (released) presentation.dispose();
    const saved = await editor.save(), parts = unzipSync(saved);
    writeFileSync(`out/chart-shared/growth${variant}-${released ? 'generated' : 'patched'}.pptx`, saved);
    const reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
    const actual = chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id));
    assert.ok(actual.every(data => data.binding.mode === 'workbook'), `${variant} 新增系列保存重开后仍可同步工作簿`);
    assert.deepEqual(actual.map(data => data.series.length), [3, 2, 3]);
    assert.ok(actual.filter((_, index) => index !== 1).every(data => data.series.at(-1).id === series
      && data.series.at(-1).points[0].value === 785 && data.series.at(-1).name === 'Renamed shared series'));
    const book = unzipSync(parts['ppt/embeddings/hierarchy1.xlsx']), sheet = strFromU8(book['xl/worksheets/sheet1.xml']);
    if (variant === '-occupied') {
      assert.match(sheet, /<c r="E3"><v>909<\/v><\/c>/, '系列分配避开无关占用单元格');
      assert.match(actual[0].series.at(-1).bindings.values.formula, /\$F\$/);
    }
    if (variant === '-metadata') {
      assert.match(sheet, /<c r="E3" cm="1"\/>/, '无数值的元数据单元格保持原样');
      assert.match(actual[0].series.at(-1).bindings.values.formula, /\$F\$/);
    }
    if (variant === '-merged') {
      assert.match(sheet, /<mergeCell ref="E2:E4"\/>/, '新系列跳过空的合并单元格');
      assert.match(actual[0].series.at(-1).bindings.values.formula, /\$F\$/);
    }
    if (variant === '-array-formula') {
      assert.match(sheet, /<f t="array" ref="E2:G6">1<\/f>/, '阵列公式连同覆盖范围保持原样');
      assert.match(actual[0].series.at(-1).bindings.values.formula, /\$H\$/);
    }
    const beforeBook = unzipSync(unzipSync(input)['ppt/embeddings/hierarchy1.xlsx']);
    for (const part of Object.keys(beforeBook).filter(part => !['xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml'].includes(part))) {
      assert.deepEqual(book[part], beforeBook[part], '新增系列不改其他工作簿部件');
    }
    edit.disposeDoc(doc); reopened.dispose();
    editor.undo(); editor.undo(); editor.undo(); editor.undo();
    assert.deepEqual(views(), original, '新增系列与删行的全部撤销恢复原模型');
    assert.deepEqual(unzipSync(await editor.save())['ppt/embeddings/hierarchy1.xlsx'], unzipSync(input)['ppt/embeddings/hierarchy1.xlsx'],
      '保存后撤销新增系列恢复原工作簿字节');
    editor.dispose(); presentation.dispose();
  }
}
