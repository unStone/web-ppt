import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

export async function testSharedCategoryGrowth({ core, edit, chart, assert }) {
  for (const variant of ['', '-views', '-disjoint', '-sheets', '-flat', '-horizontal', '-three-level', '-flat-parent']) for (const released of [false, true]) {
    const input = readFileSync(`fixtures/sample-chart-shared${variant}.pptx`);
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(presentation)), api = chart.createChartDataEditor(editor);
    const frames = chart.listEditableCharts(editor.doc), views = () => frames.map(frame => chart.queryChartData(editor.doc, frame.id));
    const original = views(), [first, , third] = original;
    const category = api.addCategory(first.chartId, variant === '-three-level' ? ['New group', 'New middle', 'New leaf'] : ['New group', 'New leaf']);
    assert.deepEqual(views().map(data => data.categories.length), original.map((data, index) => data.categories.length
      + (index === 1 && ['-views', '-disjoint', '-sheets'].includes(variant) ? 0 : 1)), '新增类别只进入覆盖插入位置的关联视图');
    assert.equal(views()[2].categories.at(-1).id, category, '新增类别身份由共享记录持有');
    api.setValue(third.chartId, third.series[0].id, category, 451);
    const series = api.addSeries(first.chartId, 'Series after category');
    api.setValue(first.chartId, series, category, 733);
    api.removeCategory(first.chartId, first.categories[0].id);
    assert.deepEqual(views()[0].series.map(series => series.points.at(-1).value), [451, null, 733], '源行删除不改变新类别及新系列交叉单元格的身份');
    const semantic = data => ({ categories: data.categories, series: data.series.map(series => ({ id: series.id,
      name: series.name, points: series.points })) });
    const expected = views().map(semantic);
    if (released) presentation.dispose();
    const saved = await editor.save(), reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
    writeFileSync(`out/chart-shared/category-growth${variant}-${released ? 'generated' : 'patched'}.pptx`, saved);
    const actual = chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id));
    assert.ok(actual.every(data => data.binding.mode === 'workbook'), '新增类别两种保存后缓存与工作簿一致');
    // 来源类别的序号会因删行重新编码，公开稳定身份与值必须保留。
    const values = data => ({ categories: data.categories.map(({ id, label, levels }) => ({ id, label, levels })),
      series: data.series.map(series => ({ id: series.id, name: series.name,
        points: series.points.map(({ id, value }) => ({ id, value })) })) });
    assert.deepEqual(actual.map(values), views().map(values));
    edit.disposeDoc(doc); reopened.dispose();
    for (let index = 0; index < 5; index++) editor.undo();
    assert.deepEqual(views(), original, '完整撤销类别新增恢复来源模型');
    assert.deepEqual(unzipSync(await editor.save())['ppt/embeddings/hierarchy1.xlsx'], unzipSync(input)['ppt/embeddings/hierarchy1.xlsx']);
    for (let index = 0; index < 5; index++) editor.redo();
    assert.deepEqual(views().map(semantic), expected, '类别与系列新增重做保留全部语义');
    editor.dispose(); presentation.dispose();
  }
  for (const released of [false, true]) {
    const p = await core.parse(readFileSync('fixtures/sample-chart-shared-views.pptx'), { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(p)), api = chart.createChartDataEditor(editor);
    const frames = chart.listEditableCharts(editor.doc), right = chart.queryChartData(editor.doc, frames[1].id);
    const added = api.addCategory(right.chartId, ['Inserted', 'Between']);
    const full = chart.queryChartData(editor.doc, frames[0].id);
    assert.equal(full.categories[4].id, added, '部分视图追加类别对应在完整视图中间插入');
    assert.deepEqual(full.categories.slice(-2).map(category => category.levels), [['Inserted', 'Between'], ['', '0']],
      '插入的新父组不吞掉后面的原生父组跨度');
    assert.equal(full.series[0].points.at(-1).value, 40, '插入位置后的原单元格随行移动');
    const tail = full.categories.at(-1).id;
    api.setCategoryLevel(frames[0].id, tail, 0, null);
    assert.equal(chart.queryChartData(editor.doc, frames[0].id).categories.at(-1).levels[0], null,
      '来源类别可以清空父级并延续前面的新增组');
    api.setCategoryLevel(frames[1].id, added, 0, 'Renamed inserted');
    api.removeCategory(frames[1].id, added);
    assert.equal(chart.queryChartData(editor.doc, frames[0].id).categories.at(-1).levels[0], 'Renamed inserted',
      '删除新增组首后，延续该组的来源类别提升为组首');
    if (released) p.dispose();
    const mixedSaved = await editor.save(), mixedReopened = await core.parse(mixedSaved, { edit: true, keepPackage: true, lazy: false });
    writeFileSync(`out/chart-shared/category-parent-${released ? 'generated' : 'patched'}.pptx`, mixedSaved);
    const mixedDoc = edit.createDoc(mixedReopened);
    assert.ok(chart.listEditableCharts(mixedDoc).every(frame => frame.binding.mode === 'workbook'), '跨来源/新增组的延续关系保存后仍同步');
    edit.disposeDoc(mixedDoc); mixedReopened.dispose();
    editor.dispose(); p.dispose();
    const inherited = await core.parse(readFileSync('fixtures/sample-chart-shared-flat-parent.pptx'), { edit: true, keepPackage: true, lazy: false });
    const inheritedEditor = new edit.Editor(edit.createDoc(inherited)), inheritedApi = chart.createChartDataEditor(inheritedEditor);
    const frame = chart.listEditableCharts(inheritedEditor.doc)[0], before = chart.queryChartData(inheritedEditor.doc, frame.id);
    const child = inheritedApi.addCategory(frame.id, [null, 'Inherited leaf']);
    inheritedApi.setCategoryLevel(frame.id, before.categories[3].id, 0, 'Renamed tail');
    const current = chart.queryChartData(inheritedEditor.doc, frame.id);
    assert.equal(current.categories.find(category => category.id === child).levels[0], null, '来源组改名保留新行的延续槽');
    const flat = chart.listEditableCharts(inheritedEditor.doc)[1];
    assert.equal(chart.queryChartData(inheritedEditor.doc, flat.id).categories.at(-1).label, 'Renamed tail', '平面视图读取同一父级单元格的解析值');
    const flatRow = inheritedApi.addCategory(flat.id, 'Flat originated');
    assert.deepEqual(chart.queryChartData(inheritedEditor.doc, frame.id).categories.find(category => category.id === flatRow).levels,
      ['Flat originated', null], '平面父级视图新增行，其他多级视图保留空叶槽');
    if (released) inherited.dispose();
    const bytes = await inheritedEditor.save(), roundtrip = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
    writeFileSync(`out/chart-shared/category-inherited-${released ? 'generated' : 'patched'}.pptx`, bytes);
    const savedDoc = edit.createDoc(roundtrip);
    assert.ok(chart.listEditableCharts(savedDoc).every(frame => frame.binding.mode === 'workbook'));
    edit.disposeDoc(savedDoc); roundtrip.dispose(); inheritedEditor.dispose(); inherited.dispose();
  }
}
