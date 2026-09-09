import type { EditDoc, ElementId } from '../types';
import type { CommandPatches } from '../commands/types';
import type { ChartDatasetState } from './types';
import { chartPartForElement } from './locator';
import { chartRelationships } from './context';
import { nativeChartParts } from './part-graph';
import type { ChartIdentityScopes } from './identity-scopes';

export interface SharedChartRuntime {
  readonly dataset: (doc: EditDoc, id: ElementId, state: ChartDatasetState) => ChartDatasetState;
  readonly command: (doc: EditDoc, id: ElementId, local: CommandPatches, origin: string) => CommandPatches;
  readonly active: (doc: EditDoc, workbook?: string) => boolean;
  readonly owns: (doc: EditDoc, id: ElementId) => boolean;
  readonly workbook?: (doc: EditDoc, id: ElementId) => boolean;
  readonly overrides?: (doc: EditDoc, id: ElementId) => unknown;
  readonly source?: (doc: EditDoc, id: ElementId, deferred: boolean, part: string | undefined,
    read: () => ChartDatasetState) => ChartDatasetState;
  readonly identityScopes?: (doc: EditDoc, part: string, source: Uint8Array, id: ElementId) => ChartIdentityScopes | undefined;
}

let runtime: SharedChartRuntime | undefined;
export const sharedChartRuntime = (): SharedChartRuntime | undefined => runtime;
export const setSharedChartRuntime = (value: SharedChartRuntime): void => { runtime = value; };

export const chartDatasetOverrides = (doc: EditDoc, id: ElementId): unknown =>
  runtime?.overrides?.(doc, id) ?? doc.elements[id]?.ovr.extensions?.['chart-data'];

export const SHARED_CHART_REASON = '共享图表数据需要加载 chart-shared 编辑入口';

export function sharedDatasetState(doc: EditDoc, id: ElementId, state: ChartDatasetState): ChartDatasetState {
  if (runtime) return runtime.dataset(doc, id, state);
  if (state.binding.mode === 'readonly') return state;
  const { chartPart, workbookPart } = state.binding;
  const linked = (part: string) => part !== chartPart && workbookPart && Object.values(chartRelationships(doc, part))
    .some(relationship => !relationship.external && relationship.target === workbookPart);
  if (Object.values(doc.elements).some(record => {
    if (record.id === id) return false;
    const part = chartPartForElement(doc, record.id);
    return part === chartPart || !!(part && linked(part));
  }) || workbookPart && nativeChartParts(doc).parts.some(linked)) {
    state.binding = { ...state.binding, mode: 'readonly', reason: SHARED_CHART_REASON };
  }
  return state;
}
