import { readFileSync } from 'node:fs';
import { transitionCases } from './chart-shared-transition-contract.mjs';

export async function testSharedTransitionCollaboration({ core, edit, chart, collab, assert }) {
  for (const [name, fixture, index] of transitionCases) {
    const input = readFileSync(`fixtures/${fixture}.pptx`), listeners = new Map(), messages = [], errors = [];
    const peers = await Promise.all(['a', 'b'].map(async (replicaId, slot) => {
      const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
      const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'transition-peer-' }), { origin: replicaId });
      const binding = collab.bindCollaboration(editor, { documentId: name, replicaId, replicaSlot: slot + 1,
        provider: { send: message => { for (const id of listeners.keys()) if (id !== replicaId) messages.push([id, structuredClone(message)]); },
          subscribe: listener => { listeners.set(replicaId, listener); return () => listeners.delete(replicaId); } },
        onError: error => errors.push(error),
      });
      const data = chart.queryChartData(editor.doc, chart.listEditableCharts(editor.doc)[index].id);
      return { editor, presentation, binding, data, api: chart.createChartDataEditor(editor) };
    }));
    const flush = () => { for (const [id, message] of messages.splice(0).reverse()) {
      listeners.get(id)(message); listeners.get(id)(structuredClone(message));
    } };
    const [a, b] = peers;
    const views = peer => chart.listEditableCharts(peer.editor.doc).filter(frame => frame.binding.chartPart === a.data.binding.chartPart)
      .map(frame => chart.queryChartData(peer.editor.doc, frame.id));
    a.api.setValue(a.data.chartId, a.data.series[0].id, a.data.series[0].points[0].id, 551);
    b.editor.exec({ type: 'DuplicateSlide', id: b.editor.doc.elements[b.data.chartId].parent });
    flush();
    for (const peer of peers) assert.deepEqual(views(peer).map(data => data.series[0].points[0].value), [551, 551],
      `${name} 编辑与复制并发时不依赖复制快照中的旧值`);
    const second = views(b)[1];
    a.api.setValue(a.data.chartId, a.data.series[0].id, a.data.series[0].points[0].id, 661);
    b.api.setValue(second.chartId, second.series[0].id, second.series[0].points[0].id, 771);
    flush();
    for (const peer of peers) assert.deepEqual(views(peer).map(data => data.series[0].points[0].value), [771, 771],
      '复制前后始终使用同一个字段寄存器，重复乱序消息收敛');
    a.editor.undo(); flush();
    for (const peer of peers) assert.deepEqual(views(peer).map(data => data.series[0].points[0].value), [771, 771],
      '撤销复制前框架的本地旧编辑保留另一个框架的较新远端值');
    a.editor.exec({ type: 'RemoveElement', id: a.data.chartId }); flush();
    const remaining = views(b)[0];
    b.api.setSeriesName(remaining.chartId, remaining.series[0].id, 'Surviving reference'); flush();
    a.editor.undo(); flush();
    for (const peer of peers) {
      assert.deepEqual(views(peer).map(data => data.series[0].name), ['Surviving reference', 'Surviving reference']);
      await peer.editor.save();
    }
    assert.deepEqual(errors, []);
    peers.forEach(peer => { peer.binding.dispose(); peer.editor.dispose(); peer.presentation.dispose(); });
  }
}
