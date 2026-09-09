import { openEditor, createIndexedDbRecoveryStore } from '@web-ppt/editor';
import * as chart from '@web-ppt/edit-core/chart';

/** 在独立页面中使用旧入口生成真实日志；恢复产品只读取原生 IndexedDB。 */
export async function seedLegacyChartRecovery(url) {
  const store = createIndexedDbRecoveryStore({ databaseName: 'web-ppt-site-editor', namespace: 'site-editor', maxJournals: 8 });
  const bytes = await fetch(url).then(response => response.arrayBuffer());
  let session;
  try {
    session = await openEditor(bytes, { idPrefix: 'legacy-browser-', recovery: { store, decide: () => 'discard' } });
    const { editor } = session, data = chart.queryChartData(editor.doc, chart.listEditableCharts(editor.doc)[0].id);
    const api = chart.createChartDataEditor(editor), first = data.series[0];
    api.setSeriesName(data.chartId, first.id, 'Legacy recovered series');
    const id = data.kind === 'xy' ? api.addPoint(data.chartId, first.id, { x: 731, value: 729 })
      : api.addCategory(data.chartId, ['Recovered group', 'Recovered category']);
    api.setValue(data.chartId, first.id, id, 729);
    api.addSeries(data.chartId, 'Legacy added series');
    const source = editor.doc.elements[data.chartId].parent;
    editor.exec({ type: 'DuplicateSlide', id: source });
    editor.exec({ type: 'RemoveSlide', id: source });
    editor.exec({ type: 'DuplicateSlide', id: editor.doc.slideOrder[0] });
    editor.select({ kind: 'none' });
    if (editor.doc.extensions?.['chart-shared'] !== undefined
      || !Object.values(editor.doc.elements).some(record => record.ovr.extensions?.['chart-data'])) {
      throw new Error('种子必须保留未迁移的真实旧局部覆盖');
    }
    await session.recovery.flush();
    if (session.recovery.error) throw session.recovery.error;
    const journal = await store.load(session.recovery.source);
    if (!journal?.frames.length) throw new Error('旧日志必须实际提交到 IndexedDB');
    return { kind: data.kind, rows: first.points.length + 1, series: data.series.length + 1,
      pages: editor.doc.slideOrder.length, frames: journal.frames.length };
  } finally { session?.dispose(); await session?.recovery?.flush(); await store.close(); }
}

export async function seedUnresolvedChartRecovery(url) {
  const store = createIndexedDbRecoveryStore({ databaseName: 'web-ppt-site-editor', namespace: 'site-editor', maxJournals: 8 });
  const bytes = await fetch(url).then(response => response.arrayBuffer());
  const session = await openEditor(bytes, { recovery: { store, decide: () => 'discard' } });
  try {
    const data = chart.listEditableCharts(session.editor.doc)[0];
    // 未加载扩展时允许持久化未知字段；恢复加载后必须识别为未恢复，不能显示来源数值。
    session.editor.applyExternalPatches([{ op: 'set', origin: 'old-client',
      path: ['document', 'extensions', 'chart-shared', data.binding.chartPart, 'unknown'], value: true }]);
    await session.recovery.flush();
    if (session.recovery.error) throw session.recovery.error;
    const journal = await store.load(session.recovery.source);
    if (!journal?.frames.length) throw new Error('异常旧数据必须实际提交到 IndexedDB');
    return { frames: journal.frames.length };
  } finally { session.dispose(); await session.recovery.flush(); await store.close(); }
}
