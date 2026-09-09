import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

const content = data => ({ categories: data.categories.map(({ label, levels }) => ({ label, levels })),
  series: data.series.map(({ name, plotKind, points }) => ({ name, plotKind,
    points: points.map(({ value, x, size }) => ({ value, x, size })) })) });

export const transitionCases = [
  ['hierarchy', 'sample-chart-hierarchy', 0], ['horizontal', 'sample-chart-hierarchy', 2],
  ['cache', 'sample-chart-data', 1], ['cache-xy', 'sample-chart-data', 10],
  ['xy', 'sample-chart-shared-transition-xy', 0],
  ['xy-horizontal', 'sample-chart-shared-transition-xy-horizontal', 0],
];

export async function testSharedTransition({ core, edit, chart, assert }) {
  for (const [name, fixture, index] of transitionCases) for (const released of [false, true]) {
    const input = readFileSync(`fixtures/${fixture}.pptx`);
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: `transition-${name}-` }));
    const api = chart.createChartDataEditor(editor), frames = [], notifications = [];
    editor.subscribeRecovery(frame => frames.push(frame));
    editor.subscribe(change => notifications.push(change));
    const first = chart.queryChartData(editor.doc, chart.listEditableCharts(editor.doc)[index].id);
    const part = first.binding.chartPart, workbook = first.binding.workbookPart;
    const views = (doc = editor.doc) => chart.listEditableCharts(doc)
      .filter(frame => frame.binding.chartPart === part).map(frame => chart.queryChartData(doc, frame.id));
    const slide = editor.doc.elements[first.chartId].parent;
    api.setSeriesName(first.chartId, first.series[0].id, 'Before copy');
    assert.ok(editor.doc.extensions?.['chart-shared']?.[part]?.dataset,
      '共享入口从单框架首次编辑就按图表部件保存文档数据，复制不需要切换历史地址');
    assert.equal(editor.doc.elements[first.chartId].ovr.extensions?.['chart-data'], undefined);
    const point = first.kind === 'xy'
      ? api.addPoint(first.chartId, first.series[0].id, { value: 71, x: 17,
        ...(first.series[0].plotKind === 'bubble' ? { size: 7 } : {}) })
      : api.addCategory(first.chartId, first.categories[0].levels ? ['Copy group', 'Copy leaf'] : 'Copy leaf');
    api.setValue(first.chartId, first.series[0].id, point, 73);
    const series = api.addSeries(first.chartId, 'Before copy series');
    const expected = content(views()[0]);
    editor.exec({ type: 'DuplicateSlide', id: slide });
    assert.equal(views().length, 2);
    assert.deepEqual(views().map(content), [expected, expected], '复制页保留此前的标量与结构编辑');
    const second = views()[1];
    const projections = views().map(data => editor.effectiveElement(data.chartId));
    api.setValue(second.chartId, second.series[0].id, point, 79);
    assert.deepEqual(views().map(data => data.series[0].points.at(-1).value), [79, 79]);
    assert.ok(views().every((data, i) => editor.effectiveElement(data.chartId) !== projections[i]), `${name} 修改后两个框架投影缓存失效`);
    assert.ok(views().every(data => notifications.at(-1).renderElements.has(data.chartId)));
    editor.undo();
    assert.deepEqual(views().map(content), [expected, expected]);
    editor.redo();
    const copiedExpected = views().map(content);
    const beforeFailure = JSON.stringify(editor.doc.extensions), beforeEvents = notifications.length;
    assert.throws(() => editor.exec(
      { type: 'Extension', namespace: 'chart-data', id: second.chartId,
        payload: { op: 'set-series-name', seriesId: series, name: 'Rollback' } },
      { type: 'Extension', namespace: 'chart-data', id: second.chartId,
        payload: { op: 'set-point', seriesId: series, pointId: 'missing', value: 1 } }), /不存在/);
    assert.equal(JSON.stringify(editor.doc.extensions), beforeFailure);
    assert.equal(notifications.length, beforeEvents, '失败事务不发出半更新通知');
    if (released) presentation.dispose();
    const saved = await editor.save();
    assert.deepEqual(await editor.save(), saved, '复制页图表保存字节稳定');
    writeFileSync(`out/chart-shared/transition-${name}-${released ? 'generated' : 'patched'}.pptx`, saved);
    const reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false });
    const reopenedDoc = edit.createDoc(reopened);
    assert.deepEqual(views(reopenedDoc).map(content), copiedExpected);
    assert.ok(views(reopenedDoc).every(data => data.binding.mode === first.binding.mode));
    const parts = unzipSync(saved);
    const references = Object.entries(parts).filter(([name, bytes]) => /^ppt\/slides\/_rels\//.test(name)
      && strFromU8(bytes).includes(part.replace('ppt/', '../')));
    assert.equal(references.length, 2, '副本仍指向原来的图表部件');
    if (released) { edit.disposeDoc(reopenedDoc); reopened.dispose(); editor.dispose(); continue; }
    editor.exec({ type: 'RemoveElement', id: first.chartId });
    assert.deepEqual(views().map(content), [copiedExpected[1]], '删除原框架不影响共享文档数据');
    editor.exec({ type: 'RemoveElement', id: second.chartId });
    await editor.save();
    editor.undo(); editor.undo();
    assert.deepEqual(views().map(content), copiedExpected, '最后一个框架删除后保存仍允许恢复原数据');
    const recoverySource = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const recovery = new edit.Editor(edit.createDoc(recoverySource, { idPrefix: editor.doc.identity.prefix }), { recoveryFrames: frames });
    assert.deepEqual(views(recovery.doc).map(content), copiedExpected, '冷恢复跨越单框架、复制与删除阶段');
    editor.undo(); editor.undo();
    assert.equal(views().length, 1);
    editor.undo(); editor.undo(); editor.undo(); editor.undo();
    assert.deepEqual(views().map(content), [content(first)], '保存后可以一直撤销到复制前的最初数据');
    const undone = unzipSync(await editor.save()), original = unzipSync(input);
    assert.deepEqual(undone[part], original[part]);
    if (workbook) assert.deepEqual(undone[workbook], original[workbook], '撤销恢复工作簿原始字节');
    recovery.dispose(); recoverySource.dispose(); edit.disposeDoc(reopenedDoc); reopened.dispose();
    editor.dispose(); presentation.dispose();
  }
}
