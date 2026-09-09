import { readFileSync } from 'node:fs';

export async function testSharedClipboardCollaboration({ core, edit, chart, collab, assert }) {
  for (const suffix of ['', '-cache', '-xy']) {
    const input = readFileSync(`fixtures/sample-chart-shared${suffix}.pptx`);
    const listeners = new Map(), queue = [], errors = [];
    const peers = await Promise.all(['a', 'b'].map(async (replicaId, slot) => {
      const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
      const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'clipboard-peer-' }), { origin: replicaId });
      const binding = collab.bindCollaboration(editor, { documentId: `clipboard${suffix}`, replicaId, replicaSlot: slot + 1,
        provider: { send: message => { for (const id of listeners.keys()) if (id !== replicaId) queue.push([id, structuredClone(message)]); },
          subscribe: listener => { listeners.set(replicaId, listener); return () => listeners.delete(replicaId); } },
        onError: error => errors.push(error),
      });
      const data = chart.queryChartData(editor.doc, chart.listEditableCharts(editor.doc)[0].id);
      return { editor, presentation, binding, data, api: chart.createChartDataEditor(editor) };
    }));
    const [a, b] = peers;
    const flush = () => { for (const [id, message] of queue.splice(0).reverse()) {
      listeners.get(id)(message); listeners.get(id)(structuredClone(message));
    } };
    const values = peer => chart.listEditableCharts(peer.editor.doc)
      .filter(frame => frame.binding.chartPart === a.data.binding.chartPart)
      .map(frame => chart.queryChartData(peer.editor.doc, frame.id).series[0].points[1].value);
    const change = (peer, id, value) => {
      const data = chart.queryChartData(peer.editor.doc, id);
      peer.api.setValue(id, data.series[0].id, data.series[0].points[1].id, value);
    };
    change(a, a.data.chartId, 551);
    const original = new Set(chart.listEditableCharts(b.editor.doc).map(frame => frame.id));
    b.editor.exec({ type: 'PasteElements', payload: edit.copyElements(b.editor.doc, [b.data.chartId]),
      at: { parentId: b.editor.doc.slideOrder[0], x: 30, y: 30 } });
    flush();
    for (const peer of peers) assert.deepEqual(values(peer), [551, 551, 551],
      '粘贴与远端编辑并发时，新框架立即读取文档真值，不能回退到剪贴板旧快照');
    const pasted = chart.listEditableCharts(b.editor.doc).find(frame => !original.has(frame.id));
    assert.ok(pasted);
    change(a, a.data.chartId, 661); change(b, pasted.id, 771); flush();
    for (const peer of peers) assert.deepEqual(values(peer), [771, 771, 771]);
    a.editor.undo(); flush();
    for (const peer of peers) assert.deepEqual(values(peer), [771, 771, 771], '旧本地编辑撤销保留粘贴框架上的较新远端值');
    a.editor.exec({ type: 'RemoveElement', id: a.data.chartId }); flush();
    for (const peer of peers) assert.deepEqual(values(peer), [771, 771], '删除来源框架不删除粘贴框架共享的数据');
    assert.deepEqual(errors, []);
    peers.forEach(peer => { peer.binding.dispose(); peer.editor.dispose(); peer.presentation.dispose(); });
  }
}
