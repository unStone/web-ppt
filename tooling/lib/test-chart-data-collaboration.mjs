import { unzipSync, zipSync } from 'fflate';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

class Hub {
  listeners = new Map();
  queue = [];

  endpoint(id) {
    return {
      send: (message) => {
        for (const peer of this.listeners.keys()) if (peer !== id) {
          this.queue.push({ to: peer, message: structuredClone(message) });
        }
      },
      subscribe: (listener) => {
        this.listeners.set(id, listener);
        return () => this.listeners.delete(id);
      },
    };
  }

  deliver(to, from) {
    const index = this.queue.findIndex((item) =>
      item.to === to && item.message.replicaId === from);
    if (index < 0) throw new Error(`缺少 ${from} → ${to} 协同消息`);
    const [item] = this.queue.splice(index, 1);
    this.listeners.get(to)?.(structuredClone(item.message));
  }

  flush(reverse = false) {
    const messages = this.queue.splice(0);
    if (reverse) messages.reverse();
    for (const item of messages) this.listeners.get(item.to)?.(structuredClone(item.message));
  }
}

async function peers(core, edit, collab, bytes, count, prefix) {
  const ids = ['a', 'b', 'c'].slice(0, count);
  const values = await Promise.all(ids.map(async (id) => {
    const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(presentation, { idPrefix: prefix });
    return { id, presentation, doc, editor: new edit.Editor(doc, { origin: id }) };
  }));
  const hub = new Hub();
  const errors = [];
  const bindings = values.map((peer, index) => collab.bindCollaboration(peer.editor, {
    documentId: prefix, replicaId: peer.id, replicaSlot: index + 1,
    provider: hub.endpoint(peer.id), onError: (error) => errors.push(error),
  }));
  return {
    values, hub, errors,
    dispose: () => {
      bindings.forEach((binding) => binding.dispose());
      values.forEach((peer) => peer.presentation.dispose());
    },
  };
}

function chartIdForPart(chart, doc, part) {
  return chart.listEditableCharts(doc).find((item) =>
    chart.queryChartData(doc, item.id).binding.chartPart === part)?.id;
}

function lastRowFixture(bytes) {
  const parts = unzipSync(bytes);
  parts['ppt/charts/chart1.xml'] = encoder.encode(
    decoder.decode(parts['ppt/charts/chart1.xml'])
      .replace('Sheet1!$B$2:$B$5', 'Sheet1!$B$1048573:$B$1048576'),
  );
  return zipSync(parts, { level: 0 });
}

function leafPatches(id, path, value, origin, output = []) {
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      leafPatches(id, [...path, key], child, origin, output);
    } else output.push({
      op: 'set', path: ['elements', id, 'ovr', 'extensions', 'chart-data', ...path, key],
      value: child, origin,
    });
  }
  return output;
}

async function testConcurrentInsertion(context) {
  const { core, edit, chart, collab, bytes, check, eq } = context;
  const group = await peers(core, edit, collab, bytes, 2, 'chart-concurrent-add');
  const [left, right] = group.values;
  const chartId = chart.listEditableCharts(left.doc)[0].id;
  const leftId = chart.createChartDataEditor(left.editor).addSeries(chartId, '并发左系列');
  const rightId = chart.createChartDataEditor(right.editor).addSeries(chartId, '并发右系列');
  check('类别系列新增使用紧凑原子消息', group.hub.queue.every((item) => item.message.patches.length < 100));
  group.hub.flush(true);
  const leftData = chart.queryChartData(left.doc, chartId);
  const rightData = chart.queryChartData(right.doc, chartId);
  check('同序并发新增系列按身份稳定收敛', JSON.stringify(leftData) === JSON.stringify(rightData)
    && leftData.series.some((item) => item.id === leftId)
    && leftData.series.some((item) => item.id === rightId));
  const [leftSaved, rightSaved] = await Promise.all([left.editor.save(), right.editor.save()]);
  const leftParts = unzipSync(leftSaved);
  const rightParts = unzipSync(rightSaved);
  check('并发新增系列保存产物收敛',
    Buffer.from(leftParts['ppt/charts/chart1.xml']).equals(Buffer.from(rightParts['ppt/charts/chart1.xml']))
      && Buffer.from(leftParts['ppt/embeddings/chart-data.xlsx'])
        .equals(Buffer.from(rightParts['ppt/embeddings/chart-data.xlsx'])));
  eq('并发新增系列无协同错误', group.errors.length, 0);
  group.dispose();
}

async function testCategoryMatrix(context) {
  const { core, edit, chart, collab, bytes, check, eq } = context;
  const added = await peers(core, edit, collab, bytes, 2, 'chart-category-add');
  const [left, right] = added.values;
  const chartId = chart.listEditableCharts(left.doc)[0].id;
  const categoryId = chart.createChartDataEditor(left.editor).addCategory(chartId, '并发类别');
  const seriesId = chart.createChartDataEditor(right.editor).addSeries(chartId, '并发系列');
  added.hub.flush(true);
  const leftData = chart.queryChartData(left.doc, chartId);
  const rightData = chart.queryChartData(right.doc, chartId);
  const addedSeries = leftData.series.find((item) => item.id === seriesId);
  check('addCategory × addSeries 补齐矩阵交点',
    addedSeries?.points.some((point) => point.id === categoryId)
      && JSON.stringify(leftData) === JSON.stringify(rightData));
  eq('并发补齐类别矩阵无协同错误', added.errors.length, 0);
  added.dispose();

  const removed = await peers(core, edit, collab, bytes, 2, 'chart-category-remove');
  const [removeLeft, removeRight] = removed.values;
  const removeChart = chart.listEditableCharts(removeLeft.doc)[0].id;
  const removedCategory = chart.queryChartData(removeLeft.doc, removeChart).categories[0].id;
  chart.createChartDataEditor(removeLeft.editor).removeCategory(removeChart, removedCategory);
  const concurrentSeries = chart.createChartDataEditor(removeRight.editor)
    .addSeries(removeChart, '删除交叉系列');
  removed.hub.flush(true);
  const removedLeft = chart.queryChartData(removeLeft.doc, removeChart);
  const removedRight = chart.queryChartData(removeRight.doc, removeChart);
  check('removeCategory × addSeries 不遗留孤儿点',
    !removedLeft.series.find((item) => item.id === concurrentSeries)?.points
      .some((point) => point.id === removedCategory)
      && JSON.stringify(removedLeft) === JSON.stringify(removedRight));
  eq('并发删除类别矩阵无协同错误', removed.errors.length, 0);
  removed.dispose();
}

async function testCausalChildren(context) {
  const { core, edit, chart, collab, bytes, check, eq } = context;
  const group = await peers(core, edit, collab, bytes, 3, 'chart-scatter-causal');
  const [a, b, c] = group.values;
  const chartId = chartIdForPart(chart, a.doc, 'ppt/charts/chart7.xml');
  const seriesId = chart.createChartDataEditor(a.editor).addSeries(chartId, '乱序散点', 'scatter');
  group.hub.deliver('b', 'a');
  const pointId = chart.createChartDataEditor(b.editor)
    .addPoint(chartId, seriesId, { x: 12, value: 34 });
  group.hub.deliver('c', 'b');
  check('散点后代先到时保持 deferred',
    !chart.queryChartData(c.doc, chartId).series.some((item) => item.id === seriesId));
  group.hub.deliver('c', 'a');
  const result = chart.queryChartData(c.doc, chartId).series.find((item) => item.id === seriesId);
  check('散点父系列后到后恢复完整点', result?.points.some((point) =>
    point.id === pointId && point.x === 12 && point.value === 34));
  eq('散点父子乱序无协同错误', group.errors.length, 0);
  group.dispose();

  const ordered = await Promise.all(['x', 'y'].map(async (suffix) => {
    const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(presentation, { idPrefix: `chart-order-${suffix}-` });
    return { presentation, doc, editor: new edit.Editor(doc) };
  }));
  const targetIds = ordered.map((item) => chart.listEditableCharts(item.doc)[0].id);
  const pointIds = ordered.map((item, index) => chart.queryChartData(item.doc, targetIds[index]).categories[0].id);
  const makeParent = (targetId, pointId) => {
    const series = {
      id: 'arrival-series', order: edit.initialFractionalIndex(20), sourceIndex: 20,
      plotKind: 'bar', name: '到达顺序系列', points: {},
      bindings: { name: { formula: null, cache: 'literal' },
        categories: { formula: null, cache: 'literal' }, values: { formula: null, cache: 'literal' } },
    };
    return [...leafPatches(targetId, ['series', series.id], series, 'peer'), {
      op: 'set', path: ['elements', targetId, 'ovr', 'extensions', 'chart-data',
        'series', series.id, 'pointsReady'], value: true, origin: 'peer',
    }];
  };
  const xPatch = (targetId, pointId) => ({
    op: 'set', path: ['elements', targetId, 'ovr', 'extensions', 'chart-data',
      'series', 'arrival-series', 'points', pointId, 'x'], value: 9, origin: 'peer',
  });
  ordered[0].editor.applyExternalPatches([xPatch(targetIds[0], pointIds[0])]);
  ordered[0].editor.applyExternalPatches(makeParent(targetIds[0], pointIds[0]));
  ordered[1].editor.applyExternalPatches(makeParent(targetIds[1], pointIds[1]));
  ordered[1].editor.applyExternalPatches([xPatch(targetIds[1], pointIds[1])]);
  const states = ordered.map((item, index) => chart.queryChartData(item.doc, targetIds[index])
    .series.find((series) => series.id === 'arrival-series'));
  check('不适用点字段按最终图种确定性隔离', states.every((state) => state?.points.length === 4
    && state.points.every((point) => point.x === undefined)));
  ordered.forEach((item) => item.presentation.dispose());
}

async function testReadonlyAndGenericOrdering(context) {
  const { core, edit, chart, collab, bytes, check, eq } = context;
  const group = await peers(core, edit, collab, lastRowFixture(bytes), 2, 'chart-readonly-causal');
  const [left, right] = group.values;
  const chartId = chart.listEditableCharts(left.doc)[0].id;
  const data = chart.queryChartData(left.doc, chartId);
  chart.createChartDataEditor(left.editor).setValue(
    chartId, data.series[0].id, data.categories[0].id, 8181,
  );
  chart.createChartDataEditor(right.editor).addCategory(chartId, '触发末行只读');
  group.hub.flush(true);
  const leftData = chart.queryChartData(left.doc, chartId);
  const rightData = chart.queryChartData(right.doc, chartId);
  check('远端补丁不受瞬时只读合并态阻断', leftData.binding.mode === 'readonly'
    && JSON.stringify(leftData) === JSON.stringify(rightData)
    && leftData.series[0].points[0].value === 8181);
  eq('瞬时只读交叉编辑无协同错误', group.errors.length, 0);
  group.dispose();

  const documents = await Promise.all(['a', 'b'].map(async (suffix) => {
    const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(presentation, { idPrefix: `generic-${suffix}-` });
    return { presentation, doc, editor: new edit.Editor(doc) };
  }));
  const genericIds = documents.map((item) => chart.listEditableCharts(item.doc)[0].id);
  const parent = (id) => ({
    op: 'set', path: ['elements', id, 'ovr', 'extensions', 'cold-order', 'root'],
    value: 0, origin: 'peer',
  });
  const child = (id) => ({
    op: 'set', path: ['elements', id, 'ovr', 'extensions', 'cold-order', 'root', 'leaf'],
    value: 1, origin: 'peer',
  });
  documents[0].editor.applyExternalPatches([parent(genericIds[0]), child(genericIds[0])]);
  documents[1].editor.applyExternalPatches([child(genericIds[1]), parent(genericIds[1])]);
  check('冷态扩展父标量与子叶逆序结果一致', documents.every((item, index) =>
    item.doc.elements[genericIds[index]].ovr.extensions['cold-order'].root === 0));
  documents.forEach((item) => item.presentation.dispose());
}

export async function testChartDataCollaboration(context) {
  await testConcurrentInsertion(context);
  await testCategoryMatrix(context);
  await testCausalChildren(context);
  await testReadonlyAndGenericOrdering(context);
}
