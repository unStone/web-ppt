import { readFileSync } from 'node:fs';

export async function testSharedTopology({ core, edit, chart, generate, assert }) {
  const source = await core.parse(readFileSync('fixtures/sample-chart-shared-mixed-records.pptx'),
    { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(source)), api = chart.createChartDataEditor(editor);
  const read = doc => chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id));
  const verify = (count, value) => {
    const views = read(editor.doc);
    assert.equal(views.length, count);
    assert.ok(views.every(view => view.binding.mode === 'workbook'
      && view.series[0].points[0].value === value && view.series[2].points[0].x === value),
    '结构变化后所有现存消费者立即保持共同记录关系');
    assert.deepEqual(read(editor.doc), read(edit.stageExternalPatches(editor.doc, [])),
      '预热文档与独立验证模型读取相同图表，不能沿用结构变化前的消费者');
    return views;
  };
  const first = verify(3, 0)[0], slide = editor.doc.elements[first.chartId].parent;
  editor.exec({ type: 'DuplicateSlide', id: slide });
  verify(4, 0);
  const duplicateSlide = editor.doc.slideOrder[editor.doc.slideOrder.indexOf(slide) + 1];
  const duplicate = read(editor.doc).find(view => editor.doc.elements[view.chartId].parent === duplicateSlide);
  assert.ok(duplicate);
  api.setValue(duplicate.chartId, duplicate.series[0].id, duplicate.categories[0].id, 617); verify(4, 617);
  editor.undo(); verify(4, 0);
  editor.exec({ type: 'RemoveSlide', id: duplicateSlide }); verify(3, 0);
  editor.undo(); verify(4, 0);
  editor.exec({ type: 'AddShape', slideId: duplicateSlide, preset: 'rect', rect: { x: 10, y: 10, w: 40, h: 40 } });
  editor.exec({ type: 'Group', ids: [...editor.doc.slides[duplicateSlide].children] }); verify(4, 0);
  editor.exec({ type: 'Ungroup', id: editor.doc.elements[duplicate.chartId].parent }); verify(4, 0);
  editor.exec({ type: 'RemoveElement', id: duplicate.chartId }); verify(3, 0);
  editor.undo(); verify(4, 0); editor.redo(); verify(3, 0); editor.undo(); verify(4, 0);
  const payload = generate.copyPortableElements(editor.doc, [first.chartId]);
  editor.exec({ type: 'PasteElements', payload, at: { parentId: slide, x: 30, y: 30 } }); verify(5, 0);
  editor.undo(); verify(4, 0); editor.redo(); verify(5, 0);
  await editor.save(); verify(5, 0);
  const current = read(editor.doc)[0];
  api.setValue(current.chartId, current.series[0].id, current.categories[0].id, 729); verify(5, 729);
  editor.undo(); verify(5, 0);
  const before = read(editor.doc), undo = editor.history.undoCount;
  assert.throws(() => editor.transaction(tx => {
    tx.exec({ type: 'DuplicateSlide', id: slide });
    tx.exec({ type: 'RemoveSlide', id: 'missing-slide' });
  }, '结构失败回滚'));
  assert.deepEqual(read(editor.doc), before); assert.equal(editor.history.undoCount, undo);

  for (const count of [10, 30]) {
    while (editor.doc.slideOrder.length < count) editor.exec({ type: 'DuplicateSlide', id: slide });
    const records = editor.doc.elements;
    let scans = 0;
    editor.doc.elements = new Proxy(records, { ownKeys(target) { scans++; return Reflect.ownKeys(target); } });
    const views = read(editor.doc); scans = 0;
    for (const view of views) chart.queryChartData(editor.doc, view.chartId);
    assert.equal(scans, 0, '逐框架读取预热的共享图表不应重新枚举整份文档');
    editor.doc.elements = records;
  }
  editor.dispose(); source.dispose();
}
