import { readFileSync } from 'node:fs';

export async function testSharedJointCollaboration({ core, edit, chart, collab, assert }) {
  for (const name of ['mixed-records', 'mixed-records-horizontal']) {
    const input = readFileSync(`fixtures/sample-chart-shared-${name}.pptx`), listeners = new Map(), queue = [], errors = [];
    const peers = await Promise.all(['a', 'b'].map(async (replicaId, index) => {
      const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
      const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'joint-peer-' }), { origin: replicaId });
      const frames = []; editor.subscribeRecovery(frame => frames.push(frame));
      const binding = collab.bindCollaboration(editor, { documentId: name, replicaId, replicaSlot: index + 1,
        provider: {
          send: message => { for (const [id] of listeners) if (id !== replicaId) queue.push([id, structuredClone(message)]); },
          subscribe: listener => { listeners.set(replicaId, listener); return () => listeners.delete(replicaId); },
        }, onError: error => errors.push(error) });
      return { presentation, editor, binding, frames, api: chart.createChartDataEditor(editor) };
    }));
    const views = peer => chart.listEditableCharts(peer.editor.doc).map(frame => chart.queryChartData(peer.editor.doc, frame.id));
    const flush = () => { for (const [id, message] of queue.splice(0).reverse()) {
      listeners.get(id)(message); listeners.get(id)(structuredClone(message));
    } };
    const [a, b] = peers, first = views(a)[0], third = views(b)[2];
    const snapshot = () => JSON.stringify([a.editor.doc.extensions, a.editor.doc.identity, views(a),
      a.editor.history.undoEntries, a.editor.history.redoEntries, a.binding.checkpoint(), a.frames, queue]);
    for (const series of [first.series[0], first.series[2]]) {
      const before = snapshot();
      const command = pointId => ({ type: 'Extension', namespace: 'chart-data', id: first.chartId,
        payload: { op: 'set-point', seriesId: series.id, pointId, value: 999 } });
      assert.throws(() => a.editor.transaction(tx => {
        tx.exec(command(series.points[0].id)); tx.exec(command('missing-joint-record'));
      }, '共同记录失败批次'));
      assert.equal(snapshot(), before, '类别与 XY 任一入口失败不能留下半更新、历史、时钟或恢复帧');
    }
    const left = a.api.addCategory(first.chartId, ['Concurrent group', 'From category']);
    const right = b.api.addPoint(third.chartId, third.series[2].id, { x: 51, value: 52, size: 53 });
    flush(); assert.deepEqual(views(a), views(b), '共同记录经两个入口并发新增、乱序重复消息后收敛');
    for (const view of views(a)) {
      assert.equal(view.categories.length, 7); assert.equal(view.series[2].points.length, 7);
      let group = null;
      for (const category of view.categories) {
        if (category.levels[0] !== null) group = category.levels[0];
        if (category.id === right) assert.equal(group, '', '并发 XY 新记录保留创建时的父组，不能依附他端新组');
      }
    }
    b.api.setPoint(third.chartId, third.series[2].id, left, { x: 821, value: 822, size: 823 });
    a.api.setValue(first.chartId, first.series[0].id, right, 931); flush();
    a.api.removeCategory(first.chartId, first.categories[0].id);
    b.api.removePoint(third.chartId, third.series[2].id, third.series[2].points[1].id);
    flush(); assert.deepEqual(views(a), views(b));
    assert.ok(views(a).every(view => view.categories.length === 5 && view.series[2].points.length === 5));
    a.editor.undo(); flush();
    assert.ok(views(a).every(view => view.categories.length === 6 && view.series[2].points.length === 6));
    b.editor.undo(); flush();
    a.api.removeCategory(first.chartId, left);
    b.api.setPoint(third.chartId, third.series[2].id, left, { x: 824, value: 825, size: 826 });
    flush(); a.editor.undo(); flush();
    assert.deepEqual(views(a), views(b));
    assert.ok(views(a).every(view => view.series[0].points.find(point => point.id === left).value === 824
      && view.series[2].points.find(point => point.id === right).x === 931), '复活共同记录保留其他端对任一视图的字段修改');
    const restoredSource = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const restored = new edit.Editor(edit.createDoc(restoredSource, { idPrefix: 'joint-peer-' }), { recoveryFrames: b.frames });
    const restoredBinding = collab.bindCollaboration(restored, { documentId: name, replicaId: 'b', replicaSlot: 2,
      checkpoint: b.binding.checkpoint(), provider: { send() {}, subscribe() { return () => {}; } } });
    assert.deepEqual(chart.listEditableCharts(restored.doc).map(frame => chart.queryChartData(restored.doc, frame.id)), views(b));
    restoredBinding.dispose(); restored.dispose(); restoredSource.dispose();
    assert.deepEqual(errors, []);
    peers.forEach(peer => { peer.binding.dispose(); peer.editor.dispose(); peer.presentation.dispose(); });
  }
}
