import { readFileSync } from 'node:fs';

export async function testSharedSourceXYCollaboration({ core, edit, chart, collab, assert }) {
  for (const layout of ['vertical', 'horizontal', 'crossed']) {
    const input = readFileSync(`fixtures/sample-chart-shared-xy${layout === 'horizontal' ? '-horizontal' : ''}-${layout === 'crossed' ? 'crossed' : 'shared-x'}.pptx`);
    const listeners = new Map(), queue = [], errors = [];
    const peers = await Promise.all(['a', 'b'].map(async (replicaId, index) => {
      const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
      const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'xy-peer-' }), { origin: replicaId });
      const binding = collab.bindCollaboration(editor, { documentId: 'shared-source-xy', replicaId, replicaSlot: index + 1,
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
    if (layout === 'crossed') {
      for (let index = 0; index < 2; index++) a.api.addPoint(first.chartId, first.series[0].id, { x: 11, value: 12, size: 13 });
      for (let index = 0; index < 2; index++) b.api.addPoint(third.chartId, third.series[1].id, { x: 21, value: 22, size: 23 });
      flush();
      assert.ok(views(a).every(data => data.binding.mode === 'readonly' && /记录扩展区域.*重叠/.test(data.binding.reason)),
        '两个副本分别占用同一空格后显式保留冲突，不覆盖任何一侧数据');
      assert.deepEqual(views(a), views(b));
      await assert.rejects(a.editor.save(), /记录扩展区域.*重叠/);
      await assert.rejects(b.editor.save(), /记录扩展区域.*重叠/);
      b.editor.undo(); flush();
      assert.ok(views(a).every(data => data.binding.mode === 'workbook'), '撤销冲突插点后恢复可写');
      assert.deepEqual(views(a), views(b));
      assert.deepEqual(views(a)[0].series.map(series => series.points.length), [4, 3]);
      await a.editor.save(); await b.editor.save();
      assert.deepEqual(errors, []);
      peers.forEach(peer => { peer.binding.dispose(); peer.editor.dispose(); peer.presentation.dispose(); });
      continue;
    }
    const left = a.api.addPoint(first.chartId, first.series[0].id, { x: 51, value: 61, size: 71 });
    const right = b.api.addPoint(third.chartId, third.series[1].id, { x: 52, value: 62, size: 72 });
    flush();
    assert.deepEqual(views(a), views(b), '同一记录轴并发插点在乱序重复投递后收敛');
    assert.ok(views(a).every(data => data.series.every(series => series.points.length === 6)));
    a.api.setPoint(first.chartId, first.series[1].id, left, { value: 161, size: 171 });
    b.api.setPoint(third.chartId, third.series[0].id, left, { x: 151 }); flush();
    const joined = views(a)[0].series.map(series => series.points.find(point => point.id === left));
    assert.deepEqual(joined.map(({ x, value, size }) => [x, value, size]), [[151, 61, 71], [151, 161, 171]],
      '跨系列并发写入不同维度只合并共享单元格');
    a.api.removePoint(first.chartId, first.series[0].id, first.series[0].points.at(-1).id);
    b.api.setPoint(third.chartId, third.series[1].id, third.series[1].points.at(-1).id, { x: 999 }); flush();
    assert.deepEqual(views(a), views(b));
    a.editor.undo(); flush();
    assert.equal(views(a)[0].series[0].points[3].x, 999, '撤销来源点删除保留并发单元格修改');
    b.api.removePoint(third.chartId, third.series[1].id, left); flush();
    assert.ok(views(a).every(data => data.series.every(series => !series.points.some(point => point.id === left))));
    const series = a.api.addSeries(first.chartId, 'Concurrent allocation'); flush();
    b.api.addPoint(third.chartId, series, { x: 431, value: 432, size: 433 }); flush();
    assert.deepEqual(views(a), views(b), '原有记录增长与独立新增系列分配共同收敛');
    for (const peer of peers) {
      const expected = views(peer).map(data => data.series.map(series => series.points.map(({ id, x, value, size }) => [id, x, value, size])));
      const saved = await peer.editor.save(), reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
      const actual = chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id));
      assert.ok(actual.every(data => data.binding.mode === 'workbook'));
      assert.deepEqual(actual.map(data => data.series.map(series => series.points.map(({ id, x, value, size }) => [id, x, value, size]))), expected);
      edit.disposeDoc(doc); reopened.dispose();
    }
    b.editor.undo(); b.editor.undo(); flush();
    assert.ok(views(a)[0].series[0].points.some(point => point.id === left), '保存后仍可撤销新点删除');
    assert.ok(views(a)[0].series[0].points.some(point => point.id === right));
    assert.deepEqual(views(a), views(b));
    assert.deepEqual(errors, []);
    peers.forEach(peer => { peer.binding.dispose(); peer.editor.dispose(); peer.presentation.dispose(); });
  }
}
