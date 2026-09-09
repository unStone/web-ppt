import { readFileSync } from 'node:fs';

export async function testSharedGrowthCollaboration({ core, edit, chart, collab, assert }) {
  for (const otherPart of [false, true]) {
    const input = readFileSync('fixtures/sample-chart-shared.pptx');
    const listeners = new Map(), messages = [], errors = [];
    const peers = await Promise.all(['a', 'b'].map(async (replicaId, index) => {
      const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
      const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'growth-peer-' }), { origin: replicaId });
      const binding = collab.bindCollaboration(editor, {
        documentId: 'shared-growth', replicaId, replicaSlot: index + 1,
        provider: {
          send: message => { for (const [id] of listeners) if (id !== replicaId) messages.push([id, structuredClone(message)]); },
          subscribe: listener => { listeners.set(replicaId, listener); return () => listeners.delete(replicaId); },
        }, onError: error => errors.push(error),
      });
      return { presentation, editor, binding, api: chart.createChartDataEditor(editor) };
    }));
    const views = peer => chart.listEditableCharts(peer.editor.doc).map(frame => chart.queryChartData(peer.editor.doc, frame.id));
    const flush = () => { for (const [id, message] of messages.splice(0).reverse()) {
      listeners.get(id)(message); listeners.get(id)(structuredClone(message));
    } };
    const [a, b] = peers, left = views(a)[0], right = views(b)[otherPart ? 1 : 2];
    const first = a.api.addSeries(left.chartId, 'A series');
    const second = b.api.addSeries(right.chartId, 'B series');
    a.api.setValue(left.chartId, first, left.categories[1].id, 611);
    b.api.setValue(right.chartId, second, right.categories[2].id, 722); flush();
    assert.deepEqual(views(a), views(b), '创建与字段修改乱序重复投递后共享新增系列收敛');
    const all = views(a).slice(0, 2).flatMap(data => data.series).filter(series => [first, second].includes(series.id));
    assert.equal(new Set(all.map(series => series.bindings.values.formula)).size, 2,
      '共享工作簿为不同部件或相同部件的并发系列分配不同区域');
    assert.deepEqual(views(a).map(data => data.series.length), otherPart ? [3, 3, 3] : [4, 2, 4]);
    a.api.removeCategory(left.chartId, left.categories[0].id);
    b.api.setValue(right.chartId, second, right.categories[2].id, 833); flush();
    for (const peer of peers) {
      const value = views(peer)[otherPart ? 1 : 2].series.find(series => series.id === second).points[1].value;
      assert.equal(value, 833, '并发删行保持新增系列的类别身份');
    }
    a.editor.undo(); flush();
    for (const peer of peers) {
      const saved = await peer.editor.save();
      const reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
      const actual = chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id));
      assert.ok(actual.every(data => data.binding.mode === 'workbook'));
      assert.equal(actual[otherPart ? 1 : 2].series.find(series => series.id === second).points[2].value, 833,
        '保存重开保留并发新系列以及撤销后的远端值');
      edit.disposeDoc(doc); reopened.dispose();
    }
    assert.deepEqual(errors, []);
    peers.forEach(peer => { peer.binding.dispose(); peer.editor.dispose(); peer.presentation.dispose(); });
  }
}
