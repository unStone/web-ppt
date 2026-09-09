export async function testSharedCacheBoundaries({ core, edit, chart, input, assert }) {
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation));
  const part = 'ppt/charts/chart1.xml';
  const path = ['document', 'extensions', 'chart-shared', part, 'dataset', 'series', 's0', 'points', 'c0', 'value'];
  const good = { op: 'set', origin: 'peer', path, value: 84 };
  assert.throws(() => editor.applyExternalPatches([good, { ...good, value: 'bad' }]), /有限数字/);
  assert.equal(editor.doc.extensions, undefined, '共享缓存批次失败没有部分覆盖');
  assert.throws(() => editor.applyExternalPatches([{ ...good, path: [...path.slice(0, 6), 's999', ...path.slice(7)] }]), /来源身份/);
  assert.throws(() => editor.applyExternalPatches([{ op: 'del', origin: 'peer', path: path.slice(0, 5) }]), /数据集字段/);
  editor.dispose(); presentation.dispose();
  for (const dataset of [
    { series: { s0: { points: { c0: { value: 'bad' } } } } },
    { categories: { c0: { label: { unexpected: 'bad' } } } },
    { unknown: {} },
  ]) {
    const cold = await core.parse(input, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(cold);
    doc.extensions = { 'chart-shared': { [part]: { dataset } } };
    const restored = new edit.Editor(doc), frames = chart.listEditableCharts(doc).filter(frame => frame.binding.chartPart === part);
    assert.ok(frames.every(frame => frame.binding.mode === 'readonly'), '异常缓存覆盖隔离为只读');
    assert.ok(frames.every(frame => frame.binding.unresolved === true));
    assert.ok(frames.every(frame => chart.queryChartData(doc, frame.id).series.length === 0));
    assert.doesNotThrow(() => frames.forEach(frame => restored.effectiveElement(frame.id)));
    assert.ok(frames.every(frame => restored.effectiveElement(frame.id).kind === 'unsupported'));
    await assert.rejects(restored.save(), /共享缓存|图表/, '异常缓存覆盖不允许静默丢弃后保存');
    restored.dispose(); cold.dispose();
  }
}
