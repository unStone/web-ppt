import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { peers, release, views } from './chart-shared-legacy-migration-contract.mjs';

const options = { edit: true, keepPackage: true, lazy: false };
// 来源记录身份以当前框架为作用域；新增记录的创建者身份必须原样跨框架保留。
const content = (data, savedScopes = []) => {
  const scopedId = id => {
    const scope = [data.chartId, ...savedScopes].find(scope => id.startsWith(`${scope}:`));
    return scope ? id.slice(scope.length) : id;
  };
  return { categories: data.categories.map(({ id, label, levels }) => ({ id: scopedId(id), label, levels })),
    series: data.series.map(({ id, name, plotKind, points }) => ({ id: scopedId(id), name, plotKind,
      points: points.map(({ id, value, x, size }) => ({ id: scopedId(id), value, x, size })) })) };
};

export function runLegacyChartShapeMatrix(context) {
  const cases = JSON.parse(readFileSync('tooling/chart-legacy-shape-cases.json', 'utf8'));
  const results = [];
  for (const config of cases) for (const early of [false, true]) {
    context.freshProcess('shape-matrix', { ...config, early });
    results.push({ ...config, delivery: early ? 'after-migration' : 'before-migration' });
  }
  writeFileSync(join(context.outputDirectory, 'shape-matrix-result.json'), JSON.stringify(results, null, 2) + '\n');
}

function addRecord(peer, label, value) {
  const { data, api } = peer, series = data.series[0];
  if (data.kind === 'xy') return api.addPoint(data.chartId, series.id,
    { value, x: value + 1, ...(series.plotKind === 'bubble' ? { size: value + 2 } : {}) });
  const depth = data.categories[0].levels?.length;
  const id = api.addCategory(data.chartId, depth
    ? Array.from({ length: depth }, (_, index) => `${label} ${index}`) : label);
  api.setValue(data.chartId, series.id, id, value);
  return id;
}

function removeRecord(peer, id) {
  const { data, api } = peer;
  if (data.kind === 'xy') api.removePoint(data.chartId, data.series[0].id, id);
  else api.removeCategory(data.chartId, id);
}

function expectedShape(before, addedA, addedB, seriesA, seriesB) {
  const baseline = content(before), xy = before.kind === 'xy';
  const categories = baseline.categories.slice(2).map(category => structuredClone(category));
  const depth = before.categories[0]?.levels?.length;
  if (depth) {
    const active = Array(depth).fill(null);
    for (const category of baseline.categories.slice(0, 3)) for (let level = 0; level < depth; level++) {
      const value = category.levels[level];
      if (value !== null) { active.fill(null, level); active[level] = value; }
      else if (level === depth - 1) active[level] = null;
    }
    for (let level = 0; level < depth - 1; level++) categories[0].levels[level] ??= active[level];
  }
  if (!xy) for (const [id, label] of [[addedA, 'A category'], [addedB, 'B category']]) {
    categories.push({ id, label: depth ? `${label} ${depth - 1}` : label,
      levels: depth ? Array.from({ length: depth }, (_, index) => `${label} ${index}`) : undefined });
  }
  const series = baseline.series.filter((_, index) => index !== 1).map((series, index) => ({ ...series,
    name: index === 0 ? 'B renamed' : series.name,
    points: xy && index > 0 ? series.points : [
      ...series.points.slice(2), ...[[addedA, 211], [addedB, 322]].map(([id, value]) => ({ id,
        value: index === 0 ? value : null, ...(xy ? { x: value + 1,
          ...(series.plotKind === 'bubble' ? { size: value + 2 } : {}) } : {}) }))] }));
  for (const [id, name] of [[seriesA, 'A series'], [seriesB, 'B series']]) series.push({ id, name,
    plotKind: before.series[0].plotKind,
    points: xy ? [] : categories.map(category => ({ id: category.id, value: null })) });
  return JSON.parse(JSON.stringify({ categories, series }));
}

export async function runLegacyChartShape(context, config) {
  const input = readFileSync(`fixtures/${config.fixture}.pptx`);
  const documentId = `legacy-shapes-${config.name}-${config.early ? 'early' : 'late'}`;
  const network = await peers({ ...context, input, chartIndex: config.chartIndex, collab: context.migration }, documentId);
  const { assert, basic, shared } = context, [a, b] = network.result;
  const sourceId = (data, id) => `${data.chartId}${id.slice(a.data.chartId.length)}`;
  const all = peer => views(basic, peer);
  const flush = () => {
    for (const to of ['a', 'b']) for (const message of network.take(to).reverse()) {
      network.deliver(to, message); network.deliver(to, message);
    }
    assert.deepEqual(network.errors, [], '乱序和重复的真实旧消息必须完成原子迁移');
  };
  const converged = count => {
    const left = all(a), right = all(b);
    assert.equal(left.length, count); assert.equal(right.length, count);
    assert.ok([...left, ...right].every(data => data.binding.mode !== 'readonly'),
      [...left, ...right].map(data => data.binding.reason).join('; '));
    const expected = content(left[0]);
    for (const data of [...left, ...right]) assert.deepEqual(content(data), expected);
    return left[0];
  };
  try {
    const first = a.data.series[0], removed = first.points[0].id;
    assert.equal(a.data.binding.mode, config.mode, '固件确实覆盖声明的数据绑定模式');
    assert.ok(a.data.series.every(series => series.plotKind === config.plotKind), '固件必须包含声明的原生图种');
    assert.equal(a.data.categories[0]?.levels?.length, config.depth);
    assert.equal(first.bindings.categories?.hierarchy?.orientation, config.orientation);
    assert.ok(first.points.length > 1, '固件必须包含可独立并发删除的两个来源记录');
    a.api.setSeriesName(a.data.chartId, first.id, 'A renamed');
    b.api.setSeriesName(b.data.chartId, first.id, 'B renamed');
    const addedA = addRecord(a, 'A category', 211), addedB = addRecord(b, 'B category', 322);
    const seriesA = a.api.addSeries(a.data.chartId, 'A series'), seriesB = b.api.addSeries(b.data.chartId, 'B series');
    const second = a.data.series[1];
    if (second) {
      a.api.removeSeries(a.data.chartId, second.id);
      b.api.setSeriesName(b.data.chartId, second.id, 'B retained name');
    }
    removeRecord(a, removed);
    removeRecord(b, first.points[1].id);
    b.api.setPoint(b.data.chartId, first.id, removed, { value: 777,
      ...(a.data.kind === 'xy' ? { x: 778, ...(first.plotKind === 'bubble' ? { size: 779 } : {}) } : {}) });
    // 普通入口不接受形成共享关系后的旧字段写入；晚加载路径先在单框架上接收并发编辑。
    if (!config.early) flush();
    const sourceSlide = a.editor.doc.elements[a.data.chartId].parent;
    a.editor.exec({ type: 'DuplicateSlide', id: sourceSlide });
    a.editor.exec({ type: 'RemoveSlide', id: sourceSlide });
    assert.ok(a.binding.checkpoint().extensionOperations.length > 10,
      '迁移依据真实新增、删除及复制字段的原操作记录');
    shared.registerSharedChartEditing();
    flush();
    let data = converged(1), series = data.series.find(series => series.id === sourceId(data, first.id));
    const expected = expectedShape(a.data, addedA, addedB, seriesA, seriesB);
    assert.deepEqual(JSON.parse(JSON.stringify(content(data))), expected,
      '从原始固件与命令独立推导结果：保留所有未改动来源记录、层级槽位及 XY 三个维度');
    assert.equal(series.name, 'B renamed', '相同时钟由原副本 ID 裁决，复制不会提高旧名称版本');
    assert.ok(!series.points.some(point => [removed, first.points[1].id].map(id => sourceId(data, id)).includes(point.id)));
    assert.equal(series.points.find(point => point.id === addedA)?.value, 211);
    assert.equal(series.points.find(point => point.id === addedB)?.value, 322);
    assert.ok(data.series.some(series => series.id === seriesA));
    assert.ok(data.series.some(series => series.id === seriesB));
    if (second) assert.ok(!data.series.some(series => series.id === sourceId(data, second.id)));
    if (a.data.kind === 'xy') {
      assert.equal(series.points.find(point => point.id === addedA).x, 212);
      assert.equal(series.points.find(point => point.id === addedB).x, 323);
    } else {
      const depth = a.data.categories[0].levels?.length;
      if (depth) for (const [id, label] of [[addedA, 'A category'], [addedB, 'B category']]) {
        assert.deepEqual(data.categories.find(category => category.id === id).levels,
          Array.from({ length: depth }, (_, index) => `${label} ${index}`));
      }
    }
    assert.ok(a.editor.undo()); flush(); converged(2);
    assert.ok(a.editor.undo()); flush(); converged(1);
    assert.ok(a.editor.undo()); flush(); data = converged(1);
    const restored = data.series.find(series => series.id === sourceId(data, first.id)).points.find(point => point.id === sourceId(data, removed));
    assert.equal(restored.value, 777, '撤销迁移前的删除保留远端对隐藏来源记录的修改');
    if (a.data.kind === 'xy') {
      assert.equal(restored.x, 778);
      if (first.plotKind === 'bubble') assert.equal(restored.size, 779);
    }
    if (second) {
      assert.ok(a.editor.undo()); flush();
      data = converged(1);
      assert.equal(data.series.find(series => series.id === sourceId(data, second.id)).name, 'B retained name');
      assert.ok(a.editor.redo()); flush();
    }
    for (const count of [1, 2, 1]) { assert.ok(a.editor.redo()); flush(); converged(count); }
    const state = () => JSON.stringify([a.editor.doc.elements, a.editor.doc.extensions, a.editor.doc.identity,
      a.binding.checkpoint(), a.frames, a.editor.history.undoEntries, a.editor.history.redoEntries]);
    const before = state(), current = all(a)[0];
    assert.throws(() => a.editor.exec(
      { type: 'Extension', namespace: 'chart-data', id: current.chartId,
        payload: { op: 'set-series-name', seriesId: sourceId(current, first.id), name: 'Rollback' } },
      { type: 'Extension', namespace: 'chart-data', id: current.chartId,
        payload: { op: 'set-point', seriesId: sourceId(current, first.id), pointId: 'missing', value: 1 } }));
    assert.equal(state(), before, '迁移后的失败事务不改变字段、历史、原证据、身份或恢复记录');
    context.freshProcess('shape-matrix-cold', { ...config, documentId, frames: a.frames,
      checkpoint: a.binding.checkpoint(), idPrefix: a.editor.doc.identity.prefix,
      part: a.data.binding.chartPart, savedScope: current.chartId, expected });
  } finally { network.result.forEach(release); }
}

export async function resumeLegacyChartShape(context, payload) {
  const { assert, core, edit, migration, loadShared } = context;
  const input = readFileSync(`fixtures/${payload.fixture}.pptx`), source = await core.parse(input, options);
  const editor = new edit.Editor(edit.createDoc(source, { idPrefix: payload.idPrefix }), { recoveryFrames: payload.frames });
  const errors = [], binding = migration.bindCollaboration(editor, { documentId: payload.documentId,
    replicaId: 'a', replicaSlot: 0, checkpoint: payload.checkpoint,
    provider: { send() {}, subscribe() { return () => {}; } }, onError: error => errors.push(error) });
  try {
    const shared = await loadShared(); shared.registerSharedChartEditing();
    const savedScopes = [payload.savedScope];
    const actual = doc => shared.listEditableCharts(doc).filter(chart => chart.binding.chartPart === payload.part)
      .map(chart => content(shared.queryChartData(doc, chart.id), savedScopes));
    // JSON 协议不区分缺省属性与值为 undefined；比较前统一采用同一公开持久化表示。
    assert.deepEqual(JSON.parse(JSON.stringify(actual(editor.doc))), [payload.expected]);
    const frame = shared.listEditableCharts(editor.doc).find(chart => chart.binding.chartPart === payload.part);
    editor.exec({ type: 'DuplicateSlide', id: editor.doc.elements[frame.id].parent });
    savedScopes.push(...shared.listEditableCharts(editor.doc).filter(chart => chart.binding.chartPart === payload.part).map(chart => chart.id));
    const expected = [payload.expected, payload.expected];
    assert.deepEqual(JSON.parse(JSON.stringify(actual(editor.doc))), expected, '冷恢复后再次复制保留迁移后的结构与新增身份');
    const stem = `shape-${payload.name}-${payload.early ? 'early' : 'late'}`, files = [];
    for (const released of [false, true]) {
      if (released) source.dispose();
      const saved = await editor.save();
      const file = `${stem}-${released ? 'generated' : 'patched'}.pptx`;
      writeFileSync(join(context.outputDirectory, file), saved); files.push(file);
      const reopened = await core.parse(saved, options), doc = edit.createDoc(reopened);
      try { assert.deepEqual(JSON.parse(JSON.stringify(actual(doc))), expected); }
      finally { edit.disposeDoc(doc); reopened.dispose(); }
    }
    writeFileSync(join(context.outputDirectory, `${stem}.json`), JSON.stringify({ fixture: payload.fixture,
      part: payload.part, savedScopes, expected: payload.expected, frames: 2, files }, null, 2) + '\n');
    assert.deepEqual(errors, []);
  } finally { binding.dispose(); editor.dispose(); edit.disposeDoc(editor.doc); source.dispose(); }
}
