import { readFileSync } from 'node:fs';

export async function testSharedCategoryGrowthCollaboration({ core, edit, chart, collab, assert }) {
  const input = readFileSync('fixtures/sample-chart-shared.pptx'), listeners = new Map(), queue = [], errors = [];
  const peers = await Promise.all(['a', 'b'].map(async (replicaId, index) => {
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'category-peer-' }), { origin: replicaId });
    const binding = collab.bindCollaboration(editor, { documentId: 'shared-category', replicaId, replicaSlot: index + 1,
      provider: {
        send: message => { for (const [id] of listeners) if (id !== replicaId) queue.push([id, structuredClone(message)]); },
        subscribe: listener => { listeners.set(replicaId, listener); return () => listeners.delete(replicaId); },
      }, onError: error => errors.push(error) });
    return { presentation, editor, binding, api: chart.createChartDataEditor(editor) };
  }));
  const views = peer => chart.listEditableCharts(peer.editor.doc).map(frame => chart.queryChartData(peer.editor.doc, frame.id));
  const flush = () => { for (const [id, message] of queue.splice(0).reverse()) {
    listeners.get(id)(message); listeners.get(id)(structuredClone(message));
  } };
  const [a, b] = peers, first = views(a)[0], third = views(b)[2];
  const left = a.api.addCategory(first.chartId, ['A branch', 'From A']);
  const right = b.api.addCategory(third.chartId, [null, 'From B']);
  flush();
  const parent = (data, id) => {
    let value = null;
    for (const category of data.categories) {
      if (category.levels[0] !== null) value = category.levels[0];
      if (category.id === id) return value;
    }
  };
  assert.deepEqual(views(a), views(b), '不同框架并发新增类别在乱序重复投递后收敛');
  for (const data of views(a)) assert.equal(parent(data, right), '', '并发新增的空父级仍指向创建时的原组，不依附另一个新组');
  b.api.setValue(third.chartId, third.series[0].id, left, 451);
  const series = a.api.addSeries(first.chartId, 'Concurrent series'); flush();
  b.api.setValue(third.chartId, series, right, 733);
  a.api.removeCategory(first.chartId, first.categories[0].id); flush();
  assert.deepEqual(views(a), views(b));
  a.api.setCategoryLevel(first.chartId, first.categories[3].id, 0, 'Renamed tail'); flush();
  for (const data of views(a)) assert.equal(parent(data, right), 'Renamed tail', '源组改名同步到以该组为父级的新类别');
  b.api.removeCategory(third.chartId, left); flush();
  for (const peer of peers) {
    const saved = await peer.editor.save(), reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
    const actual = chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id));
    assert.ok(actual.every(data => data.binding.mode === 'workbook'));
    assert.ok(actual.every(data => !data.categories.some(category => category.id === left)));
    assert.ok(actual.filter((_, index) => index !== 1).every(data => data.series.find(item => item.id === series).points.find(point => point.id === right).value === 733));
    edit.disposeDoc(doc); reopened.dispose();
  }
  b.editor.undo(); flush();
  assert.equal(views(a)[0].series[0].points.find(point => point.id === left).value, 451, '撤销自己的新行删除保留其他字段修改');
  assert.deepEqual(errors, []);
  peers.forEach(peer => { peer.binding.dispose(); peer.editor.dispose(); peer.presentation.dispose(); });
}
