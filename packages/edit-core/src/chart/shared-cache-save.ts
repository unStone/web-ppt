import type { EditDoc } from '../types';
import type { EditExtensionSavePlan } from '../extension-runtime';
import { parseXmlTree, serializeXmlTreeBytes } from '@web-ppt/edit-core/xml';
import { chartSourceBytes } from './context';
import { chartPartForElement } from './locator';
import { materializeChartTree } from './materialize';
import { readChartIdentityManifest } from './identity';
import { NATIVE_CHART_ID, chartDatasetStatesEqual } from './source';
import { mergeChartDatasetState } from './dataset-merge';
import { sharedCacheSource, sharedCacheOverrides } from './shared-cache';
import { saveSharedChartParts } from './shared-save-plan';
import { nativeChartParts } from './shared-graph';
import { patchChartWorkbook } from './workbook';

export function saveSharedData(doc: EditDoc): EditExtensionSavePlan | void {
  const workbookPlan = saveSharedChartParts(doc);
  const changes = { ...workbookPlan?.changes }, baselines = { ...workbookPlan?.baselines };
  const mounted = new Set(Object.values(doc.elements).map(record => chartPartForElement(doc, record.id)));
  for (const part of nativeChartParts(doc).charts) {
    // 挂载中的部件由基础图表扩展保存；最后一个框架被删除后，文档仍需提交并可撤销缓存数据。
    if (mounted.has(part)) continue;
    const source = sharedCacheSource(doc, part);
    if (!source) continue;
    const state = mergeChartDatasetState(structuredClone(source), sharedCacheOverrides(doc, source)).state;
    const original = chartSourceBytes(doc, part)!;
    const workbook = state.binding.workbookPart;
    if (chartDatasetStatesEqual(state, mergeChartDatasetState(structuredClone(source), undefined).state)) {
      if (doc.saveState.baselines[part]) { changes[part] = original; baselines[part] = original; }
      if (workbook && doc.saveState.baselines[workbook]) {
        changes[workbook] = baselines[workbook] = chartSourceBytes(doc, workbook)!;
      }
      continue;
    }
    if (workbook) {
      const bytes = chartSourceBytes(doc, workbook);
      if (!bytes) throw new Error(`内嵌工作簿不存在：${workbook}`);
      const result = patchChartWorkbook(bytes, state);
      Object.assign(state, result.state);
      changes[workbook] = result.bytes;
      baselines[workbook] = doc.saveState.baselines[workbook] ?? bytes.slice();
    }
    const manifest = readChartIdentityManifest(parseXmlTree(original).root, undefined, NATIVE_CHART_ID);
    changes[part] = serializeXmlTreeBytes(materializeChartTree(original, NATIVE_CHART_ID, state, undefined,
      { prefix: NATIVE_CHART_ID, frames: manifest?.scopes?.frames ?? [] }));
    baselines[part] = doc.saveState.baselines[part] ?? original.slice();
  }
  return Object.keys(changes).length ? { changes, baselines } : undefined;
}
