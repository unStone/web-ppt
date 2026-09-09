import { readFileSync } from 'node:fs';

export async function testSharedGroupedClipboard({ core, edit, chart, assert }) {
  for (const suffix of ['', '-cache', '-xy']) {
    const input = readFileSync(`fixtures/sample-chart-shared${suffix}.pptx`);
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(presentation));
    const frames = [];
    editor.subscribeRecovery(frame => frames.push(frame));
    const slideId = editor.doc.slideOrder[0], sourceId = editor.doc.slides[slideId].children[0];
    editor.exec({ type: 'AddShape', slideId, preset: 'rect', rect: { x: 10, y: 10, w: 40, h: 40 } });
    editor.exec({ type: 'Group', ids: [...editor.doc.slides[slideId].children] });
    assert.ok(chart.listEditableCharts(editor.doc).some(frame => frame.id === sourceId),
      '组合后首次加载图表入口时，空组合容器不能遮蔽原生孩子来源');
    const data = chart.queryChartData(editor.doc, sourceId), api = chart.createChartDataEditor(editor);
    api.setValue(sourceId, data.series[0].id, data.series[0].points[1].id, 987);
    const original = new Set(chart.listEditableCharts(editor.doc).map(frame => frame.id));
    const group = editor.doc.elements[sourceId].parent;
    editor.exec({ type: 'PasteElements', payload: edit.copyElements(editor.doc, [group]), at: { parentId: slideId, x: 30, y: 30 } });
    const pasted = chart.listEditableCharts(editor.doc).find(frame => !original.has(frame.id));
    assert.ok(pasted, '复制整个组合后立即识别其原生图表后代');
    const copied = chart.queryChartData(editor.doc, pasted.id);
    assert.equal(copied.series[0].points[1].value, 987);
    api.setValue(pasted.id, copied.series[0].id, copied.series[0].points[1].id, 876);
    editor.exec({ type: 'Ungroup', id: editor.doc.elements[pasted.id].parent });
    assert.equal(chart.queryChartData(editor.doc, pasted.id).series[0].points[1].value, 876, '编辑后解组保留资源绑定及共享数据');
    assert.doesNotThrow(() => edit.copyElements(editor.doc, [pasted.id]), '已粘贴并解组的图表可再次复制');
    const recovering = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const restored = new edit.Editor(edit.createDoc(recovering, { idPrefix: editor.doc.identity.prefix }), { recoveryFrames: frames });
    assert.equal(chart.queryChartData(restored.doc, pasted.id).series[0].points[1].value, 876, '冷恢复重建组合、粘贴、共享修改与解组');
    const reopened = await core.parse(await restored.save(), { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(reopened);
    const linked = chart.listEditableCharts(doc).filter(frame => frame.binding.chartPart === data.binding.chartPart);
    assert.equal(linked.length, 3);
    assert.ok(linked.every(frame => chart.queryChartData(doc, frame.id).series[0].points[1].value === 876));
    edit.disposeDoc(doc); reopened.dispose(); restored.dispose(); recovering.dispose(); editor.dispose(); presentation.dispose();
  }
}
