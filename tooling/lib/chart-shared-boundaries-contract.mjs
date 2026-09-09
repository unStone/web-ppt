import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate';

export async function testSharedBoundaries({ core, edit, chart, input, assert }) {
  const parts = unzipSync(input);
  parts['ppt/charts/chart2.xml'] = strToU8(strFromU8(parts['ppt/charts/chart2.xml'])
    .replace(/(<c:val>[\s\S]*?<c:pt idx="1"><c:v>)10/, '$1999'));
  const presentation = await core.parse(zipSync(parts), { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation)), charts = chart.listEditableCharts(editor.doc);
  assert.ok(charts.every(item => item.binding.mode === 'readonly'), '共享缓存与工作簿不一致时拒绝猜测数据来源');
  assert.match(charts[0].binding.reason, /Sheet1!C3.*不一致/);
  const data = chart.queryChartData(editor.doc, charts[0].id);
  assert.throws(() => chart.createChartDataEditor(editor).setValue(charts[0].id, data.series[0].id, data.series[0].points[1].id, 999));
  const cellPatch = { op: 'set', path: ['document', 'extensions', 'chart-shared', 'ppt/embeddings/hierarchy1.xlsx', 'cells', 'Sheet1!C3'],
    value: JSON.stringify({ value: 999 }), origin: 'peer' };
  assert.throws(() => editor.applyExternalPatches([cellPatch]), /不一致/, '原始协同补丁也不能绕过共享来源一致性校验');
  assert.equal(editor.isDirty(), false);
  editor.dispose(); presentation.dispose();
  const healthy = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const atomic = new edit.Editor(edit.createDoc(healthy));
  const ids = chart.listEditableCharts(atomic.doc).map(item => item.id);
  const before = ids.map(id => JSON.stringify(atomic.effectiveElement(id)));
  assert.throws(() => atomic.applyExternalPatches([cellPatch, { ...cellPatch, path: [...cellPatch.path.slice(0, 5), 'Sheet1!D3'],
    value: JSON.stringify({ value: 'invalid numeric cell' }) }]), /类型无效/);
  assert.deepEqual(atomic.doc.extensions, undefined, '共享多单元格事务验证失败不留下半份覆盖');
  assert.equal(atomic.isDirty(), false);
  assert.deepEqual(ids.map(id => JSON.stringify(atomic.effectiveElement(id))), before, '失败批次不污染任何关联投影');
  const source = chart.queryChartData(atomic.doc, ids[0]);
  assert.throws(() => atomic.applyExternalPatches([{ op: 'set', origin: 'peer', value: 123,
    path: ['elements', ids[0], 'ovr', 'extensions', 'chart-data', 'series', source.series[0].id,
      'points', source.categories[0].id, 'value'] }]), /文档级/, '共享工作簿不能经旧元素字段补丁产生局部半更新');
  atomic.dispose(); healthy.dispose();
  for (const [key, value] of [['Sheet1!C3', 'invalid json'], ['Sheet1!Z99', JSON.stringify({ value: 42 })]]) {
    const cold = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(cold);
    doc.extensions = { 'chart-shared': { 'ppt/embeddings/hierarchy1.xlsx': { cells: { [key]: value } } } };
    const recovering = new edit.Editor(doc), frames = chart.listEditableCharts(doc);
    assert.ok(frames.every(frame => frame.binding.mode === 'readonly'), '未加载时接收的无效共享字段在加载后隔离为只读');
    assert.doesNotThrow(() => frames.forEach(frame => recovering.effectiveElement(frame.id)), '无效共享恢复数据不击穿投影');
    await assert.rejects(recovering.save(), /共享/, '无效共享恢复数据不能静默保存');
    recovering.dispose(); cold.dispose();
  }
  const externalParts = unzipSync(input);
  externalParts['ppt/charts/_rels/chart1.xml.rels'] = strToU8(strFromU8(externalParts['ppt/charts/_rels/chart1.xml.rels'])
    .replace('Target="../embeddings/hierarchy1.xlsx"', 'Target="ppt/embeddings/hierarchy1.xlsx" TargetMode="External"'));
  const external = await core.parse(zipSync(externalParts), { edit: true, keepPackage: true, lazy: false });
  const externalDoc = edit.createDoc(external);
  assert.deepEqual(chart.listEditableCharts(externalDoc).map(item => item.binding.mode), ['readonly', 'workbook', 'readonly'],
    '外部工作簿与同名内嵌 part 是不同资源，不能混淆可写性与依赖关系');
  external.dispose();
}
