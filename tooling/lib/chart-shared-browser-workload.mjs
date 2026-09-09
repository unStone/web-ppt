import { core, edit, editor as sdk } from '/out/chart-shared-browser/bundle/sdk.js';
import { sampleAnimationFrameEnvironment } from './browser-performance-contract.mjs';

let session, chart, initial, targets, api, configuration;
const check = (condition, message) => { if (!condition) throw new Error(message); };
const time = action => { const start = performance.now(); action(); return performance.now() - start; };
const columnIndex = value => [...value].reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0);
function columnName(index) {
  let name = '';
  for (; index; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + (index - 1) % 26) + name;
  return name;
}
// 原始短缓存可省末尾空值；从来源方向和实际记录数推导保存范围，不能照抄旧终点。
function bindings(data, series, saved) {
  return Object.fromEntries(Object.entries(series.bindings).map(([role, binding]) => {
    if (!binding.formula) return [role, binding];
    let formula = binding.formula.replace(/\$/g, '');
    const match = /^(Sheet1)!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(formula);
    check(match, '成本固件只能使用明确的 Sheet1 单元格范围');
    if (!saved && role !== 'name') {
      const count = role === 'categories' ? data.categories.length : series.points.length;
      const horizontal = binding.hierarchy ? binding.hierarchy.orientation === 'columns'
        : match[3] === match[5] && match[2] !== match[4];
      const end = horizontal ? `${columnName(columnIndex(match[2]) + count - 1)}${match[5] ?? match[3]}`
        : `${match[4] ?? match[2]}${Number(match[3]) + count - 1}`;
      formula = `${match[1]}!${match[2]}${match[3]}:${end}`;
    }
    return [role, { ...binding, formula }];
  }));
}
const summary = (data, saved = false) => ({ kind: data.kind, plotKinds: data.plotKinds, binding: data.binding,
  categories: data.categories.map(({ label, levels }) => ({ label, levels })),
  series: data.series.map(series => ({ name: series.name, plotKind: series.plotKind, bindings: bindings(data, series, saved),
    points: series.points.map(({ x, value, size }) => ({ x, value, size })) })) });
const same = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected), message);
const datasets = (doc, frames = chart.listEditableCharts(doc), saved = false) => frames
  .map(frame => summary(chart.queryChartData(doc, frame.id), saved))
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const network = () => performance.getEntriesByType('resource').filter(entry => /\/bundle\/.*\.js$/.test(new URL(entry.name).pathname))
  .map(({ name, duration, transferSize, encodedBodySize, decodedBodySize }) => ({ path: new URL(name).pathname,
    duration, transferSize, encodedBodySize, decodedBodySize }));

export const environment = sampleAnimationFrameEnvironment;
export const memory = () => performance.memory ? { used: performance.memory.usedJSHeapSize,
  total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null;

export async function prepare({ scenario, pages, registered = false }) {
  configuration = { scenario, pages };
  const legacy = scenario === 'legacy';
  if (legacy) chart = await import('/out/chart-shared-browser/bundle/basic.js');
  else if (!chart) { chart = await import('/out/chart-shared-browser/bundle/shared.js'); chart.registerSharedChartEditing(); }
  const fixture = legacy ? 'sample-chart-hierarchy.pptx' : 'sample-chart-shared-mixed-records.pptx';
  const bytes = await fetch(`/fixtures/${fixture}`).then(response => response.arrayBuffer());
  const started = performance.now(); session = await sdk.openEditor(bytes, { idPrefix: 'measured-chart-' });
  initial = chart.queryChartData(session.editor.doc, chart.listEditableCharts(session.editor.doc)[0].id);
  api = chart.createChartDataEditor(session.editor);
  const source = session.editor.doc.elements[initial.chartId].parent;
  const setup = performance.now();
  if (legacy) {
    api.setValue(initial.chartId, initial.series[0].id, initial.categories[0].id, 619);
    const point = api.addCategory(initial.chartId, ['Measured legacy', 'Measured category']);
    api.setValue(initial.chartId, initial.series[0].id, point, 729);
  }
  while (session.editor.doc.slideOrder.length < pages) session.editor.exec({ type: 'DuplicateSlide', id: source });
  const oldOwners = Object.values(session.editor.doc.elements).filter(element => element.ovr.extensions?.['chart-data']).length;
  if (legacy && !registered) check(oldOwners > 0 && !session.editor.doc.extensions?.['chart-shared'], '迁移输入必须保留旧局部覆盖');
  session.editor.history.clear();
  return { fixture, inputBytes: bytes.byteLength, openMs: setup - started, setupMs: performance.now() - setup,
    pages: session.editor.doc.slideOrder.length, oldOwners, registered, elements: Object.keys(session.editor.doc.elements).length };
}

export async function activate() {
  performance.clearResourceTimings();
  const started = performance.now(); chart = await import('/out/chart-shared-browser/bundle/shared.js');
  const importMs = performance.now() - started;
  const registerMs = time(() => chart.registerSharedChartEditing());
  const beforeQuery = performance.now();
  const frames = chart.listEditableCharts(session.editor.doc);
  targets = configuration.scenario === 'legacy' ? frames.filter(frame => frame.binding.chartPart === initial.binding.chartPart) : frames;
  const views = targets.map(frame => chart.queryChartData(session.editor.doc, frame.id));
  if (configuration.scenario === 'legacy') check(views.every(view => view.series[0].points[0].value === 619
    && view.series[0].points.at(-1).value === 729), '迁移后全部副本保留旧数值及新增类别');
  initial = views[0]; api = chart.createChartDataEditor(session.editor);
  const queryAllMs = performance.now() - beforeQuery;
  const mounts = [document.querySelector('#first'), document.querySelector('#last')];
  const ids = [targets[0].id, targets.at(-1).id];
  const mountMs = time(() => ids.forEach((id, index) => session.mount(mounts[index], {
    slideId: session.editor.doc.elements[id].parent, mode: 'edit', textMode: 'svg',
  })));
  check(mounts.every(mount => mount.querySelector('svg')), '首尾两个关联视图实际挂载');
  return { importMs, registerMs, queryAllMs, mountMs, frames: targets.length, resources: network(),
    obsoleteOwners: Object.values(session.editor.doc.elements).filter(element => element.ovr.extensions?.['chart-data']).length };
}

export async function coldImport() {
  performance.clearResourceTimings(); const start = performance.now();
  chart = await import('/out/chart-shared-browser/bundle/shared.js');
  const importMs = performance.now() - start;
  const registerMs = time(() => chart.registerSharedChartEditing());
  return { importMs, registerMs, resources: network() };
}

export function step(index) {
  const value = 700 + index, point = initial.categories[0].id;
  const commandMs = time(() => api.setValue(initial.chartId, initial.series[0].id, point, value));
  const layoutMs = time(() => document.querySelectorAll('.mount svg').forEach(svg => svg.getBoundingClientRect()));
  const projectionAllMs = time(() => targets.forEach(frame => session.editor.effectiveElement(frame.id)));
  check(targets.every(frame => chart.queryChartData(session.editor.doc, frame.id).series[0].points[0].value === value), '编辑须覆盖所有关联框架');
  return { commandMs, layoutMs, projectionAllMs, memory: memory() };
}

export function duplicate() {
  const editor = session.editor, count = editor.doc.slideOrder.length;
  const previous = new Set(Object.keys(editor.doc.elements)), source = editor.doc.elements[initial.chartId].parent;
  const before = datasets(editor.doc), expected = datasets(editor.doc, chart.listEditableCharts(editor.doc)
    .filter(frame => editor.doc.elements[frame.id].parent === source));
  const duplicateMs = time(() => editor.exec({ type: 'DuplicateSlide', id: source }));
  check(editor.doc.slideOrder.length === count + 1, '复制新增原生页面');
  const added = chart.listEditableCharts(editor.doc).filter(frame => !previous.has(frame.id));
  same(datasets(editor.doc, added), expected, '复制保留全部类别、系列、XY 数值及共享部件');
  checkWritableCopy(added[0].id);
  const undoMs = time(() => editor.undo()); check(editor.doc.slideOrder.length === count, '复制撤销恢复页数');
  same(datasets(editor.doc), before, '复制撤销恢复全部图表内容');
  return { duplicateMs, undoMs, memory: memory() };
}

function checkWritableCopy(id) {
  const doc = session.editor.doc, data = chart.queryChartData(doc, id), expected = datasets(doc);
  check(data.binding.mode === 'workbook', '新副本保持可写工作簿绑定');
  api.setValue(id, data.series[0].id, data.categories[0].id, 1801);
  check(targets.every(frame => chart.queryChartData(doc, frame.id).series[0].points[0].value === 1801), '从副本编辑仍联动所有原框架');
  session.editor.undo(); same(datasets(doc), expected, '副本编辑可整次撤销');
}

export async function clipboard() {
  const portable = await import('/out/chart-shared-browser/bundle/portable.js');
  let payload;
  const copyMs = time(() => { payload = portable.copyPortableElements(session.editor.doc, [initial.chartId]); });
  const frames = chart.listEditableCharts(session.editor.doc), previous = new Set(frames.map(frame => frame.id));
  const before = datasets(session.editor.doc, frames), expected = summary(chart.queryChartData(session.editor.doc, initial.chartId));
  const pasteMs = time(() => session.editor.exec({ type: 'PasteElements', payload,
    at: { parentId: session.editor.doc.elements[initial.chartId].parent, x: 30, y: 30 } }));
  const added = chart.listEditableCharts(session.editor.doc).filter(frame => !previous.has(frame.id));
  check(added.length === 1, '复制图表须立即出现可编辑框架');
  same(datasets(session.editor.doc, added), [expected], '粘贴保留完整类别、系列、XY 数值及共享部件');
  checkWritableCopy(added[0].id);
  const undoMs = time(() => session.editor.undo());
  same(datasets(session.editor.doc), before, '粘贴撤销移除框架并恢复全部内容');
  return { copyMs, pasteMs, undoMs, payloadBytes: new TextEncoder().encode(JSON.stringify(payload)).length, memory: memory() };
}

export async function save() {
  const expected = datasets(session.editor.doc);
  const started = performance.now(), bytes = await session.editor.save(), saveMs = performance.now() - started;
  const memoryAfterSave = memory();
  const source = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(source);
  try {
    same(datasets(doc, undefined, true), expected, '成本样本保存重开必须保留全部框架、类别、系列、XY 数值及共享部件');
  } finally { edit.disposeDoc(doc); source.dispose(); }
  return { saveMs, outputBytes: bytes.length, memoryAfterSave };
}

export function dispose() {
  session?.dispose(); session = initial = targets = api = undefined;
  document.querySelectorAll('.mount').forEach(mount => mount.replaceChildren());
  check(!document.querySelector('.mount svg'), '释放归还已挂载视图');
}
