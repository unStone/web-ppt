import { openLegacy, release, setValue, views } from './chart-shared-legacy-migration-contract.mjs';

export async function assertUnresolvedChart(context, peer, reason) {
  const { basic, shared, assert } = context;
  const before = JSON.stringify({ elements: peer.editor.doc.elements, extensions: peer.editor.doc.extensions });
  for (const data of views(basic, peer)) {
    assert.equal(data.binding.mode, 'readonly');
    assert.equal(data.binding.unresolved, true, '读取结果必须明确指出旧编辑尚未恢复');
    assert.match(data.binding.reason, reason);
    assert.deepEqual(data.categories, [], '来源标签不能冒充恢复后的类别');
    assert.deepEqual(data.series, [], '来源数值不能冒充恢复后的数据');
    const projected = peer.editor.effectiveElement(data.chartId);
    assert.equal(projected.kind, 'unsupported', '画布必须显示可辨认的恢复失败占位');
    assert.match(projected.label, /图表编辑未恢复/);
    assert.equal(projected.preview, undefined, '占位不能继续携带误导性的来源图表预览');
    assert.throws(() => shared.chartProjection(peer.editor.doc, data.chartId), reason,
      '独立 XML 消费者也不能拿到伪装成当前数据的来源缓存');
    assert.throws(() => shared.createChartDataEditor(peer.editor).addCategory(data.chartId, '不可写'), reason);
  }
  await assert.rejects(peer.editor.save(), reason);
  assert.equal(JSON.stringify({ elements: peer.editor.doc.elements, extensions: peer.editor.doc.extensions }), before,
    '查询、预览和被拒绝的写入不能丢弃未恢复的旧覆盖');
}

export async function runLegacyBareModel(context) {
  const { edit, basic, shared, assert } = context, peer = await openLegacy(context);
  try {
    setValue(peer, 919);
    const source = peer.editor.doc.elements[peer.data.chartId].parent;
    peer.editor.exec({ type: 'DuplicateSlide', id: source });
    peer.editor.exec({ type: 'RemoveSlide', id: source });
    peer.editor.dispose();
    // 旧裸模型只有活树：没有结构日志，也没有后来新增的来源身份保留表。
    peer.editor.doc.removedElements = {};
    delete peer.editor.doc.retainedElementOrigins;
    peer.editor = new edit.Editor(peer.editor.doc);
    const before = JSON.stringify({ elements: peer.editor.doc.elements, extensions: peer.editor.doc.extensions });
    shared.registerSharedChartEditing();
    assert.equal(JSON.stringify({ elements: peer.editor.doc.elements, extensions: peer.editor.doc.extensions }), before);
    await assertUnresolvedChart(context, peer, /原页身份已不可定位/);
    const other = basic.listEditableCharts(peer.editor.doc).find(frame => frame.binding.chartPart !== peer.data.binding.chartPart);
    assert.ok(other && !basic.queryChartData(peer.editor.doc, other.id).binding.unresolved,
      '无关图表不受这组缺失来源记录影响');
    assert.notEqual(peer.editor.effectiveElement(other.id).kind, 'unsupported');
  } finally { release(peer); }
}
