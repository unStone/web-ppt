export async function testSharedCacheCollaboration({ core, edit, chart, collab, input, assert }) {
  const listeners = new Map(), messages = [], errors = [];
  const peers = await Promise.all(['a', 'b'].map(async (replicaId, index) => {
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'cache-peer-' }), { origin: replicaId });
    const binding = collab.bindCollaboration(editor, {
      documentId: 'shared-cache', replicaId, replicaSlot: index + 1,
      provider: {
        send: message => { for (const [id] of listeners) if (id !== replicaId) messages.push([id, structuredClone(message)]); },
        subscribe: listener => { listeners.set(replicaId, listener); return () => listeners.delete(replicaId); },
      }, onError: error => errors.push(error),
    });
    return { presentation, editor, binding, api: chart.createChartDataEditor(editor) };
  }));
  const views = peer => chart.listEditableCharts(peer.editor.doc).filter(frame => frame.binding.chartPart === 'ppt/charts/chart1.xml')
    .map(frame => chart.queryChartData(peer.editor.doc, frame.id));
  const flush = () => { for (const [id, message] of messages.splice(0).reverse()) {
    listeners.get(id)(message); listeners.get(id)(structuredClone(message));
  } };
  const [a, b] = peers, left = views(a)[0], right = views(b)[1];
  a.api.setValue(left.chartId, left.series[0].id, left.categories[1].id, 100);
  b.api.setValue(right.chartId, right.series[0].id, right.categories[1].id, 200); flush();
  for (const peer of peers) assert.deepEqual(views(peer).map(data => data.series[0].points[1].value), [200, 200],
    '不同框架命中同一缓存字段，重复乱序投递后收敛');
  const series = a.api.addSeries(left.chartId, 'Concurrent series');
  const category = b.api.addCategory(right.chartId, ['Concurrent group', 'Concurrent category']); flush();
  for (const peer of peers) assert.deepEqual(views(peer).map(data => data.series.at(-1).points.at(-1))
    .map(({ id, value }) => ({ id, value })), [{ id: category, value: null }, { id: category, value: null }],
  '并发新增系列与类别按稳定身份补齐共享矩阵');
  b.api.setValue(right.chartId, series, category, 400); flush();
  a.api.removeCategory(left.chartId, left.categories[0].id);
  b.api.setCategoryLevel(right.chartId, right.categories[2].id, 0, 'Concurrent South'); flush();
  for (const peer of peers) assert.deepEqual(views(peer).map(data => data.categories[1].levels[0]),
    ['Concurrent South', 'Concurrent South'], '共享缓存删行不改变并发标签编辑的身份');
  a.editor.undo(); flush();
  for (const peer of peers) {
    assert.deepEqual(views(peer).map(data => data.categories[2].levels[0]), ['Concurrent South', 'Concurrent South']);
    assert.deepEqual(views(peer).map(data => data.series.at(-1).points.at(-1).value), [400, 400], '本地撤销保留远端字段');
  }
  assert.deepEqual(errors, []);
  peers.forEach(peer => { peer.binding.dispose(); peer.editor.dispose(); peer.presentation.dispose(); });
}
