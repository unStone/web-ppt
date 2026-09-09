import { readFileSync, writeFileSync } from 'node:fs';

const summary = data => ({ categories: data.categories.map(({ id, label, levels }) => ({ id, label, levels })),
  series: data.series.map(({ id, name, plotKind, points }) => ({ id, name, plotKind,
    points: points.map(({ id, x, value, size }) => ({ id, x, value, size })) })) });

export async function testSharedJoint({ core, edit, chart, assert }) {
  for (const name of ['mixed-records', 'mixed-records-horizontal']) for (const released of [false, true]) {
    const input = readFileSync(`fixtures/sample-chart-shared-${name}.pptx`);
    const source = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(source)), api = chart.createChartDataEditor(editor);
    const frames = chart.listEditableCharts(editor.doc), views = () => frames.map(frame => chart.queryChartData(editor.doc, frame.id));
    const initial = views(), first = initial[0], third = initial[2], log = [], changes = [];
    editor.subscribeRecovery(frame => log.push(frame)); editor.subscribe(change => changes.push(change));
    assert.equal(first.categories.length, first.series[2].points.length);
    const category = api.addCategory(first.chartId, ['Joint group', 'Joint category']);
    assert.ok(views().every(view => view.categories.at(-1).id === category && view.series[2].points.at(-1).id === category),
      '同一来源记录轴中的类别和 XY 新记录共用稳定身份');
    api.setValue(first.chartId, first.series[0].id, category, 617);
    api.setPoint(third.chartId, third.series[2].id, category, { value: 618, size: 619 });
    assert.ok(views().every(view => view.series[0].points.at(-1).value === 617
      && view.series[2].points.at(-1).x === 617 && view.series[2].points.at(-1).value === 618
      && view.series[2].points.at(-1).size === 619));
    const point = api.addPoint(first.chartId, first.series[2].id, { x: 71, value: 72, size: 73 });
    assert.deepEqual(views().map(view => ({ id: view.categories.at(-1).id, value: view.series[0].points.at(-1).value,
      mode: view.binding.mode, reason: view.binding.reason })), frames.map(() => ({ id: point, value: 71, mode: 'workbook', reason: undefined })));
    api.removeCategory(first.chartId, first.categories[0].id);
    api.removePoint(third.chartId, third.series[2].id, third.series[2].points[1].id);
    assert.ok(views().every(view => view.categories.length === first.categories.length
      && view.series[2].points.length === first.series[2].points.length));
    assert.ok(frames.every(frame => changes.at(-1).renderElements.has(frame.id)), '一次删除通知全部关联框架');
    assert.ok(views().every(view => view.categories[0].label === first.categories[2].label));
    for (const view of views()) {
      assert.deepEqual(view.series[0].points.map(point => point.value), [20, null, 40, 617, 71]);
      assert.deepEqual(view.series[2].points.map(({ x, value, size }) => [x, value, size]),
        [[20, 28, 1600], [null, 60, 2500], [40, null, null], [617, 618, 619], [71, 72, 73]],
        '共同记录的完整三维预期由来源数据与明确编辑命令推导');
    }
    const resource = Object.values(editor.doc.extensions['chart-shared'])[0];
    assert.equal(resource.xyRecords, undefined, '共同记录不另外持久化一份 XY 结构真值');
    assert.equal(Object.keys(resource.insertions).length, 1);
    const expected = views().map(summary);
    const recoverySource = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const recovered = new edit.Editor(edit.createDoc(recoverySource, { idPrefix: editor.doc.identity.prefix }), { recoveryFrames: log });
    assert.deepEqual(chart.listEditableCharts(recovered.doc).map(frame => chart.queryChartData(recovered.doc, frame.id)), views());
    recovered.dispose(); recoverySource.dispose();
    if (released) source.dispose();
    const bytes = await editor.save();
    writeFileSync(`out/chart-shared/${name}-${released ? 'generated' : 'patched'}.pptx`, bytes);
    const reopened = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
    assert.deepEqual(chart.listEditableCharts(doc).map(frame => summary(chart.queryChartData(doc, frame.id))), expected,
      '共享记录保存重开保留类别、XY 身份、分组和全部数值');
    edit.disposeDoc(doc); reopened.dispose();
    for (let index = 0; index < 6; index++) editor.undo();
    assert.deepEqual(views(), initial, '类别与 XY 的增删可以整次撤销');
    editor.dispose(); source.dispose();
  }
  await testPartialJoint({ core, edit, chart, assert });
}

async function testPartialJoint({ core, edit, chart, assert }) {
  for (const released of [false, true]) {
    const input = readFileSync('fixtures/sample-chart-shared-mixed-overlap.pptx');
    const source = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(source)), api = chart.createChartDataEditor(editor);
    const frames = chart.listEditableCharts(editor.doc), views = () => frames.map(frame => chart.queryChartData(editor.doc, frame.id));
    const first = views()[0], third = views()[2];
    const tail = api.addCategory(first.chartId, 'Outside range');
    assert.ok(views().every(view => view.categories.length === 6 && view.series[2].points.length === 4),
      '类别尾部超出 XY 来源子范围时，不向该子视图虚构记录');
    const point = api.addPoint(third.chartId, third.series[2].id, { x: 71, value: 72, size: 73 });
    assert.ok(views().every(view => view.categories[4].id === point && view.categories.at(-1).id === tail
      && view.series[2].points.at(-1).id === point), '部分 XY 视图尾插定位到完整类别轴中的来源锚点');
    api.setValue(first.chartId, first.series[0].id, point, 812);
    api.removeCategory(first.chartId, first.categories[1].id);
    api.removePoint(third.chartId, third.series[2].id, point); editor.undo();
    api.setPoint(third.chartId, third.series[2].id, third.series[2].points[2].id, { value: 845 });
    assert.ok(views().every(view => view.categories.length === 6 && view.series[2].points.length === 4
      && view.series[2].points.at(-1).x === 812));
    for (const view of views()) {
      assert.deepEqual(view.series[0].points.map(point => point.value), [0, 20, null, 812, 40, null]);
      assert.deepEqual(view.series[2].points.map(({ x, value, size }) => [x, value, size]),
        [[0, 20, 400], [20, 845, 1600], [null, 60, 2500], [812, 72, 73]]);
    }
    const expected = views().map(summary);
    if (released) source.dispose();
    const bytes = await editor.save();
    writeFileSync(`out/chart-shared/mixed-records-partial-${released ? 'generated' : 'patched'}.pptx`, bytes);
    const reopened = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
    assert.deepEqual(chart.listEditableCharts(doc).map(frame => summary(chart.queryChartData(doc, frame.id))), expected);
    edit.disposeDoc(doc); reopened.dispose(); editor.dispose(); source.dispose();
  }
}
