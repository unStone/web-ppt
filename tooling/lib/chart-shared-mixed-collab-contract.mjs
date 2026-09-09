import { readFileSync } from 'node:fs';

export async function testSharedMixedCollaboration({ core, edit, chart, collab, assert }) {
  for (const name of ['mixed', 'mixed-horizontal', 'mixed-crossed']) {
    const input = readFileSync(`fixtures/sample-chart-shared-${name}.pptx`), listeners = new Map(), queue = [], errors = [];
    const peers = await Promise.all(['a', 'b'].map(async (replicaId, index) => {
      const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
      const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'mixed-peer-' }), { origin: replicaId });
      const binding = collab.bindCollaboration(editor, { documentId: name, replicaId, replicaSlot: index + 1,
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
    const category = a.api.addCategory(first.chartId, 'Concurrent category');
    const point = b.api.addPoint(third.chartId, third.series[2].id, { x: 51, value: 52, size: 53 });
    flush(); assert.deepEqual(views(a), views(b), '混合图的独立类别轴和 XY 轴可以并发新增');
    b.api.setValue(third.chartId, third.series[0].id, category, 821);
    a.api.setPoint(first.chartId, first.series[2].id, point, { x: 91, value: 92, size: 93 });
    flush(); assert.deepEqual(views(a), views(b));
    a.api.removeCategory(first.chartId, first.categories[0].id);
    b.api.removePoint(third.chartId, third.series[2].id, third.series[2].points[0].id);
    flush(); assert.deepEqual(views(a), views(b), '不同记录轴并发删除按各自稳定来源身份收敛');
    a.editor.undo(); flush();
    assert.ok(views(a).every(data => data.categories.length === 6 && data.series[2].points.length === 4));
    b.editor.undo(); flush();
    assert.ok(views(a).every(data => data.series[0].points.at(-1).value === 821 && data.series[2].points.at(-1).x === 91));
    for (const peer of peers) {
      const reopened = await core.parse(await peer.editor.save(), { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
      const data = chart.queryChartData(doc, chart.listEditableCharts(doc)[0].id);
      assert.equal(data.series[0].points.at(-1).value, 821); assert.equal(data.series[2].points.at(-1).x, 91);
      edit.disposeDoc(doc); reopened.dispose(); peer.binding.dispose(); peer.editor.dispose(); peer.presentation.dispose();
    }
    assert.deepEqual(errors, []);
  }
}
