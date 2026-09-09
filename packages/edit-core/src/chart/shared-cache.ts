import type { EditDoc, ElementId } from '../types';
import type { CommandPatches, DocumentExtensionPatch, ExtensionPatch } from '../commands/types';
import type { ChartDatasetState } from './types';
import { hydrateChartDataset, hydrateChartPart, NATIVE_CHART_ID } from './source';
import { chartPartForElement } from './locator';
import { chartSourceBytes, chartRelationships } from './context';
import { sharedCacheCodec } from './shared-cache-codec';
import { validatePatchAgainstState } from './patch-validation';
import { assertChartDictionary } from './validation';
import { decodeSharedDataset } from './shared-records';
import { nativeChartParts, hasSharedChartScopes } from './shared-graph';
import { workbookCanSync } from './workbook';
import { sharedCacheIdentities } from './shared-cache-identities';
import { localChartMigrationReason } from './shared-cache-migration';

const NS = 'chart-shared';
const resource = (doc: EditDoc, part: string): unknown =>
  (doc.extensions?.[NS] as Record<string, unknown> | undefined)?.[part];
const independent = new WeakMap<Uint8Array, { workbook: Uint8Array | undefined; ok: boolean }>();

function independentlyWritable(doc: EditDoc, state: ChartDatasetState): boolean {
  const bytes = chartSourceBytes(doc, state.binding.chartPart)!;
  const workbook = chartSourceBytes(doc, state.binding.workbookPart!);
  let checked = independent.get(bytes);
  if (!checked || checked.workbook !== workbook) {
    checked = { workbook, ok: workbookCanSync(workbook, state).ok };
    independent.set(bytes, checked);
  }
  return checked.ok;
}

export function sharedCacheSource(doc: EditDoc, part: string, allowLegacy = false): ChartDatasetState | undefined {
  const graph = nativeChartParts(doc);
  if (!graph.charts.has(part) || !chartSourceBytes(doc, part)) return;
  const frames = graph.frames.get(part) ?? [];
  let parent: string | undefined = doc.elements[frames[0]]?.parent;
  while (parent && doc.elements[parent]) parent = doc.elements[parent].parent;
  const copied = parent && doc.slides[parent]?.creation?.duplicateSourcePart;
  if (!allowLegacy && frames.length === 1 && resource(doc, part) === undefined
    && !copied && doc.elements[frames[0]].ovr.extensions?.['chart-data'] !== undefined) return;
  const state = hydrateChartPart(doc, part);
  if (state.binding.mode === 'cache') return state;
  const workbook = state.binding.workbookPart;
  if (state.binding.mode !== 'workbook' || !workbook || resource(doc, workbook) !== undefined) return;
  // 同一部件的新增框架只增加引用，不能改变首次编辑所用的历史地址。
  // 多部件消费者必须交给单元格模型；未挂载或未知消费者也不能被忽略。
  if (graph.parts.some(other => other !== part && Object.values(chartRelationships(doc, other))
    .some(relation => !relation.external && relation.target === workbook))) return;
  // 一个部件内部也可能共用 X 等数值范围；这种所有权仍由单元格模型统一处理。
  if (!independentlyWritable(doc, state)) return;
  return state;
}

export function ownsSharedCache(doc: EditDoc, id: ElementId): boolean {
  const part = chartPartForElement(doc, id);
  return !!(part && sharedCacheSource(doc, part));
}

export function sharedCacheTransactionsOnly(doc: EditDoc, id: ElementId): boolean {
  const part = chartPartForElement(doc, id);
  if (!part || !sharedCacheSource(doc, part)) return false;
  return resource(doc, part) !== undefined
    || sharedCacheIdentities(doc, part) !== undefined
    || (nativeChartParts(doc).frames.get(part)?.length ?? 0) > 1
    || hasSharedChartScopes(doc.package?.parts[part] ?? chartSourceBytes(doc, part)!);
}

function localPatch(part: string, patch: DocumentExtensionPatch): ExtensionPatch {
  if (patch.path[4] !== 'dataset' || patch.path.length < 8) throw new Error('共享缓存只接受数据集字段');
  const path: ExtensionPatch['path'] = ['elements', part, 'ovr', 'extensions', 'chart-data', ...patch.path.slice(5)];
  return patch.op === 'set' ? { ...patch, path } : { ...patch, path };
}

export function validateSharedCachePatch(doc: EditDoc, patch: DocumentExtensionPatch): void {
  const source = sharedCacheSource(doc, patch.path[3]);
  if (!source) throw new Error('图表没有共享缓存绑定');
  validatePatchAgainstState(source, sharedCacheCodec(source, sharedCacheIdentities(doc, source.binding.chartPart))(
    localPatch(NATIVE_CHART_ID, patch), false), 0);
}

export function sharedCacheOverrides(doc: EditDoc, source: ChartDatasetState): Record<string, unknown> | undefined {
  const local = (nativeChartParts(doc).frames.get(source.binding.chartPart) ?? [])
    .filter(id => doc.elements[id].ovr.extensions?.['chart-data'] !== undefined);
  if (local.length) throw new Error(localChartMigrationReason(doc, hydrateChartPart(doc, source.binding.chartPart), local));
  const raw = resource(doc, source.binding.chartPart);
  if (raw === undefined) return;
  assertChartDictionary(raw, '共享缓存覆盖');
  if (Object.keys(raw).some(key => key !== 'dataset')) throw new Error('共享缓存覆盖包含未知字段');
  assertChartDictionary(raw.dataset, '共享缓存数据集');
  return decodeSharedDataset(source, raw.dataset, sharedCacheIdentities(doc, source.binding.chartPart));
}

export function sharedCacheFrameOverrides(doc: EditDoc, id: ElementId): unknown {
  if (!ownsSharedCache(doc, id)) return;
  const local = doc.elements[id]?.ovr.extensions?.['chart-data'];
  if (local !== undefined) return local;
  try { return sharedCacheOverrides(doc, hydrateChartDataset(doc, id)) ?? {}; }
  catch { return doc.elements[id]?.ovr.extensions?.['chart-data'] ?? {}; }
}

export function sharedCacheDataset(doc: EditDoc, id: ElementId, state: ChartDatasetState): ChartDatasetState {
  try { sharedCacheOverrides(doc, hydrateChartDataset(doc, id)); }
  catch (error) {
    state.binding = { ...state.binding, mode: 'readonly', unresolved: true,
      reason: `共享缓存覆盖无效：${error instanceof Error ? error.message : String(error)}` };
    state.categories = {};
    state.series = {};
  }
  return state;
}

export function sharedCacheCommand(doc: EditDoc, id: ElementId, local: CommandPatches): CommandPatches {
  const source = hydrateChartDataset(doc, id);
  const codec = sharedCacheCodec(source, sharedCacheIdentities(doc, source.binding.chartPart));
  const map = (patch: CommandPatches['forward'][number]): DocumentExtensionPatch => {
    const converted = codec(patch as ExtensionPatch, true);
    const path: DocumentExtensionPatch['path'] = ['document', 'extensions', NS,
      source.binding.chartPart, 'dataset', ...converted.path.slice(5)];
    return converted.op === 'set' ? { ...converted, path } : { ...converted, path };
  };
  return { forward: local.forward.map(map), inverse: local.inverse.map(map) };
}
