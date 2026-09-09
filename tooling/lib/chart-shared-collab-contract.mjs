export async function testSharedCollaboration({ core, edit, chart, collab, input, assert }) {
  const peers = await Promise.all(['a', 'b'].map(async replica => {
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'shared-' }), { origin: replica });
    return { replica, presentation, editor, api: chart.createChartDataEditor(editor) };
  }));
  const listeners = new Map(), queue = [], errors = [];
  const bindings = peers.map((peer, index) => collab.bindCollaboration(peer.editor, {
    documentId: 'shared', replicaId: peer.replica, replicaSlot: index + 1,
    provider: {
      send: message => { for (const id of listeners.keys()) if (id !== peer.replica) queue.push([id, structuredClone(message)]); },
      subscribe: listener => { listeners.set(peer.replica, listener); return () => listeners.delete(peer.replica); },
    }, onError: error => errors.push(error),
  }));
  const views = peer => chart.listEditableCharts(peer.editor.doc).map(item => chart.queryChartData(peer.editor.doc, item.id));
  const change = (peer, view, point, value) => {
    const data = views(peer)[view];
    peer.api.setValue(data.chartId, data.series[0].id, data.series[0].points[point].id, value);
  };
  const flush = () => { for (const [id, message] of queue.splice(0).reverse()) {
    listeners.get(id)(message); listeners.get(id)(structuredClone(message));
  } };
  const [a, b] = peers;
  change(a, 0, 1, 100); change(b, 1, 1, 200); flush();
  for (const peer of peers) assert.deepEqual(views(peer).map(data => data.series[0].points[1].value),
    [200, 200, 200], '从不同图表编辑同一单元格使用同一个 LWW 字段');
  change(a, 2, 0, 300); change(b, 1, 2, 400); flush();
  for (const peer of peers) assert.deepEqual(views(peer).map(data => data.series[0].points.slice(0, 3).map(point => point.value)),
    [[300, 200, 400], [300, 200, 400], [300, 200, 400]], '不同单元格并发编辑保留双方修改');
  a.editor.undo(); flush();
  for (const peer of peers) assert.deepEqual(views(peer).map(data => data.series[0].points.slice(0, 3).map(point => point.value)),
    [[0, 200, 400], [0, 200, 400], [0, 200, 400]], '撤销本地单元格不覆盖他人修改');
  const left = views(a)[0], right = views(b)[1];
  a.api.setCategoryLevel(left.chartId, left.categories[2].id, 0, null);
  b.api.setCategoryLevel(right.chartId, right.categories[0].id, 0, 'Concurrent North');
  flush();
  for (const peer of peers) assert.deepEqual(views(peer).map(data => data.categories.slice(0, 3).map(category => category.levels)),
    [[['Concurrent North', 'A'], [null, 'A'], [null, '']], [['Concurrent North', 'A'], [null, 'A'], [null, '']],
      [['Concurrent North', 'A'], [null, 'A'], [null, '']]], '清空组首与前组改名并发时延续同一组身份');
  a.api.removeCategory(left.chartId, left.categories[0].id);
  change(b, 1, 2, 777); flush();
  for (const peer of peers) assert.deepEqual(views(peer).map(data => data.series[0].points.map(point => point.value)),
    [[200, 777, null, 40], [200, 777, null, 40], [200, 777, null, 40]], '删行与另一行改值并发不改变单元格身份');
  a.api.removeCategory(left.chartId, left.categories[1].id);
  b.api.removeCategory(right.chartId, right.categories[2].id); flush();
  for (const peer of peers) assert.deepEqual(views(peer).map(data => data.series[0].points.map(point => point.value)),
    [[null, 40], [null, 40], [null, 40]], '不同共享行并发删除保留双方墓碑');
  a.editor.undo(); flush();
  for (const peer of peers) assert.deepEqual(views(peer).map(data => data.series[0].points.map(point => point.value)),
    [[200, null, 40], [200, null, 40], [200, null, 40]], '撤销自己的共享删行保留另一副本的删除');
  assert.deepEqual(errors, []);
  bindings.forEach(binding => binding.dispose());
  peers.forEach(peer => { peer.editor.dispose(); peer.presentation.dispose(); });
}
