import { readFileSync } from 'node:fs';

export async function prepareSharedLegacyLoading({ core, edit, basicChart, assert }) {
  const cases = [];
  for (const index of [0, 1]) {
    const presentation = await core.parse(readFileSync('fixtures/sample-chart-data.pptx'), { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(presentation));
    const first = basicChart.queryChartData(editor.doc, basicChart.listEditableCharts(editor.doc)[index].id);
    const api = basicChart.createChartDataEditor(editor);
    api.setValue(first.chartId, first.series[0].id, first.series[0].points[0].id, 919);
    cases.push({ presentation, editor, first });
  }
  return async () => {
    for (const { presentation, editor, first } of cases) {
      const value = () => basicChart.queryChartData(editor.doc, first.chartId).series[0].points[0].value;
      assert.equal(value(), 919, '延迟加载共享入口保留已有单框架局部编辑');
      editor.undo(); assert.equal(value(), first.series[0].points[0].value);
      editor.redo(); assert.equal(value(), 919, '旧单框架历史地址在加载后仍可撤销重做');
      editor.exec({ type: 'DuplicateSlide', id: editor.doc.elements[first.chartId].parent });
      assert.notEqual(basicChart.queryChartData(editor.doc, first.chartId).binding.mode, 'readonly');
      assert.equal(value(), 919);
      assert.equal(editor.doc.elements[first.chartId].ovr.extensions?.['chart-data'], undefined,
        '唯一旧所有者的字段已迁移至文档数据，副本不再复制局部真值');
      const saved = await core.parse(await editor.save(), { edit: true, keepPackage: true, lazy: false });
      const savedDoc = edit.createDoc(saved);
      try {
        const copies = basicChart.listEditableCharts(savedDoc).filter(frame => frame.binding.chartPart === first.binding.chartPart);
        assert.equal(copies.length, 2);
        assert.deepEqual(copies.map(frame => basicChart.queryChartData(savedDoc, frame.id).series[0].points[0].value), [919, 919],
          '旧局部编辑复制后保存重开仍联动');
      } finally { edit.disposeDoc(savedDoc); saved.dispose(); }
      editor.exec({ type: 'RemoveElement', id: first.chartId });
      const survivor = basicChart.listEditableCharts(editor.doc).find(frame => frame.binding.chartPart === first.binding.chartPart);
      assert.notEqual(survivor.binding.mode, 'readonly');
      assert.equal(basicChart.queryChartData(editor.doc, survivor.id).series[0].points[0].value, 919,
        '原框架移除后旧字段继续由幸存框架读取');
      await editor.save();
      editor.undo();
      editor.undo(); editor.undo();
      assert.equal(value(), first.series[0].points[0].value, '撤销复制后可继续撤销旧历史');
      editor.dispose(); edit.disposeDoc(editor.doc); presentation.dispose();
    }
  };
}
