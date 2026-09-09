import type { EditDoc } from '../types';
import type { EditExtensionSavePlan } from '../extension-runtime';
import { parseXmlTree, serializeXmlTreeBytes } from '@web-ppt/edit-core/xml';
import { chartSourceBytes } from './context';
import { sharedGroupForWorkbook, sharedWorkbookParts } from './shared-graph';
import { projectSharedDataset, validateSharedDocument } from './shared';
import { sharedWorkbookPatch } from './shared-save';
import { materializeChartTree } from './materialize';
import { readChartIdentityManifest } from './identity';
import { NATIVE_CHART_ID } from './source';
import { sharedCacheSource } from './shared-cache';

/** 共享工作簿只由此扩展提交一次；未挂载的图表也使用同一份工作簿状态重建缓存。 */
export function saveSharedChartParts(doc: EditDoc): EditExtensionSavePlan | void {
  validateSharedDocument(doc);
  const changes: Record<string, Uint8Array> = Object.create(null), baselines: Record<string, Uint8Array> = Object.create(null);
  const resources = doc.extensions?.['chart-shared'] as Record<string, unknown> | undefined;
  for (const workbook of sharedWorkbookParts(doc)) {
    if (!resources?.[workbook] && !doc.saveState.baselines[workbook]) continue;
    const group = sharedGroupForWorkbook(doc, workbook);
    if (!group) continue;
    if (group.charts.some(chart => sharedCacheSource(doc, chart.state.binding.chartPart))) continue;
    const source = chartSourceBytes(doc, workbook);
    if (!source) throw new Error(`共享工作簿不存在：${workbook}`);
    const checked = projectSharedDataset(doc, group, structuredClone(group.charts[0].state));
    if (checked.binding.mode === 'readonly') throw new Error(checked.binding.reason ?? '共享图表只读');
    baselines[workbook] = doc.saveState.baselines[workbook] ?? source.slice();
    changes[workbook] = sharedWorkbookPatch(doc, workbook) ?? source;
    for (const chart of group.charts.filter(chart => chart.native)) {
      const part = chart.state.binding.chartPart, original = chartSourceBytes(doc, part);
      if (!original) throw new Error(`共享图表部件不存在：${part}`);
      const state = projectSharedDataset(doc, group, structuredClone(chart.state));
      if (JSON.stringify(state) === JSON.stringify(chart.state)) {
        if (doc.saveState.baselines[part]) { changes[part] = original; baselines[part] = original; }
        continue;
      }
      const manifest = readChartIdentityManifest(parseXmlTree(original).root, undefined, NATIVE_CHART_ID);
      changes[part] = serializeXmlTreeBytes(materializeChartTree(original, NATIVE_CHART_ID, state, undefined,
        { prefix: NATIVE_CHART_ID, frames: manifest?.scopes?.frames ?? [] }));
      baselines[part] = doc.saveState.baselines[part] ?? original.slice();
    }
  }
  return Object.keys(changes).length ? { changes, baselines } : undefined;
}
