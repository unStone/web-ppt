import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

export async function testSharedMatrix({ core, edit, chart, assert }) {
  for (const variant of ['disjoint', 'sheets', 'flat']) {
    const input = readFileSync(`fixtures/sample-chart-shared-${variant}.pptx`);
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(presentation));
    const ids = chart.listEditableCharts(editor.doc).map(item => item.id), api = chart.createChartDataEditor(editor);
    const views = () => ids.map(id => chart.queryChartData(editor.doc, id));
    assert.ok(views().every(data => data.binding.mode === 'workbook'), `${variant} 的原生共享关系可编辑`);
    const data = views()[1];
    api.setValue(ids[1], data.series[0].id, data.categories[0].id, 100);
    assert.deepEqual(views().map(data => data.series[0].points[0].value),
      variant === 'flat' ? [100, 100, 100] : [0, 100, 0], `${variant} 只联动同工作表同单元格`);
    if (variant === 'flat') {
      const numericSave = await editor.save();
      const numericOpen = await core.parse(numericSave, { edit: true, keepPackage: true, lazy: false });
      const numericDoc = edit.createDoc(numericOpen);
      assert.ok(chart.listEditableCharts(numericDoc).every(item => item.binding.mode === 'workbook'),
        '只改数值时平面视图不能把共享的缺失叶槽改成空字符串');
      assert.match(new TextDecoder().decode(unzipSync(unzipSync(numericSave)['ppt/embeddings/hierarchy1.xlsx'])['xl/worksheets/sheet1.xml']),
        /<c r="B6"><v>0<\/v><\/c>/, '只改数值时保留类别单元格的原生数值零');
      numericOpen.dispose();
    }
    api.setCategoryLabel(ids[1], data.categories[4].id, 'Zero text');
    assert.deepEqual(views().map(data => data.categories[4].label),
      variant === 'flat' ? ['Zero text', 'Zero text', 'Zero text'] : ['0', 'Zero text', '0']);
    if (variant === 'flat') {
      api.setCategoryLabel(ids[1], data.categories[3].id, '');
      assert.equal(views()[0].categories[3].levels[1], '', '平面类别写入空字符串使共享层级叶槽从缺失变为显式空值');
    }
    const expected = views().map(data => ({ values: data.series[0].points.map(point => point.value),
      labels: data.categories.map(category => category.label) }));
    const saved = await editor.save();
    const beforeBook = unzipSync(unzipSync(input)['ppt/embeddings/hierarchy1.xlsx']);
    const afterBook = unzipSync(unzipSync(saved)['ppt/embeddings/hierarchy1.xlsx']);
    for (const part of Object.keys(beforeBook).filter(part => part !== 'xl/worksheets/sheet1.xml'
      && !(variant === 'sheets' && part === 'xl/worksheets/sheet3.xml'))) {
      assert.deepEqual(afterBook[part], beforeBook[part], `${variant} 保留无关工作簿部件 ${part}`);
    }
    const reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(reopened);
    const actual = chart.listEditableCharts(doc).map(item => chart.queryChartData(doc, item.id));
    assert.ok(actual.every(data => data.binding.mode === 'workbook'), `${variant} 重开缓存与工作簿仍一致`);
    assert.deepEqual(actual.map(data => ({ values: data.series[0].points.map(point => point.value),
      labels: data.categories.map(category => category.label) })), expected, `${variant} 共享视图保存闭环`);
    editor.dispose(); presentation.dispose(); reopened.dispose();
  }
}
