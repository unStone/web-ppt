import type { EditDoc, ElementId } from '../types';
import { registerEditExtension } from '../extension-runtime';
import { projectChartElement } from '../chart/projection';
import * as chart from '../chart/index';
import { chartPartForElement } from '../chart/locator';
import { setSharedChartRuntime } from '../chart/shared-runtime';
import { sharedCommandPatches, sharedDatasetState, sharedChartElements, validateSharedChartPatch, ownsSharedChart } from '../chart/shared';
import { saveSharedData } from '../chart/shared-cache-save';
import { ownsSharedCache, sharedCacheCommand, sharedCacheDataset, sharedCacheFrameOverrides, sharedCacheTransactionsOnly } from '../chart/shared-cache';
import { cachedSharedSource } from '../chart/shared-source-cache';
import { chartIdentityScopes } from '../chart/identity-frames';
import { migrateLocalChartData } from '../chart/shared-cache-migration';
import { projectUnresolvedChart } from '../chart/shared-unresolved';

export type * from '../chart/index';
let registered = false;
function generateParts(doc: EditDoc, parts: Record<string, Uint8Array>): void {
  const plan = saveSharedData(doc);
  for (const [part, bytes] of Object.entries(plan?.changes ?? {})) if (bytes && parts[part]) parts[part] = bytes;
}

export function registerSharedChartEditing(): void {
  if (registered) return;
  registered = true;
  setSharedChartRuntime({
    dataset: (doc, id, state) => ownsSharedCache(doc, id) ? sharedCacheDataset(doc, id, state) : sharedDatasetState(doc, id, state),
    command: (doc, id, local, origin) => ownsSharedCache(doc, id) ? sharedCacheCommand(doc, id, local) : sharedCommandPatches(doc, id, local, origin),
    overrides: sharedCacheFrameOverrides,
    source: cachedSharedSource,
    identityScopes: chartIdentityScopes,
    workbook: (doc, id) => !ownsSharedCache(doc, id) && ownsSharedChart(doc, id),
    active: (doc, workbook) => {
      const resources = doc.extensions?.['chart-shared'] as Record<string, unknown> | undefined;
      return workbook ? !!resources?.[workbook] : !!resources;
    }, owns: (doc, id) => sharedCacheTransactionsOnly(doc, id) || ownsSharedChart(doc, id) });
  registerEditExtension('chart-shared', {
    migrate: migrateLocalChartData,
    command: () => { throw new Error('共享图表通过 ChartDataEditor 发出语义命令'); },
    validateDocumentPatch: validateSharedChartPatch,
    documentElements: sharedChartElements,
    projectSource: projectUnresolvedChart,
    beforeSave: saveSharedData,
    generateParts,
    copyParts: generateParts,
    projectDocument: (doc, id, element) => {
      if (element.kind !== 'group' || !chartPartForElement(doc, id)) return element;
      return projectChartElement(doc, id, element);
    },
  });
}

export function listEditableCharts(doc: EditDoc) {
  registerSharedChartEditing(); return chart.listEditableCharts(doc);
}
export function queryChartData(doc: EditDoc, id: ElementId) {
  registerSharedChartEditing(); return chart.queryChartData(doc, id);
}
export function createChartDataEditor(editor: Parameters<typeof chart.createChartDataEditor>[0]) {
  registerSharedChartEditing(); return chart.createChartDataEditor(editor);
}
export function chartProjection(doc: EditDoc, id: ElementId) {
  registerSharedChartEditing(); return chart.chartProjection(doc, id);
}
