import type { EditDoc } from '../types';
import type { DocumentExtensionPatch, Patch } from '../commands/types';
import type { ExtensionMigrationResolver } from '../extension-runtime';
import { EXTENSION_ADDRESSES, extensionAddressPatches, readExtensionAddress } from '../extension-addresses';
import { mergeExtensionValue, type ExtensionIdentityRemap } from '../extension-address-remap';
import { chartPartForElement } from './locator';
import { sharedCacheSource } from './shared-cache';
import { sharedCacheIdentityMap } from './shared-cache-codec';
import { sharedCacheScopeIds } from './shared-cache-scopes';
import type { ChartDatasetState } from './types';
import { chartSourceBytes } from './context';

const diagnostics = new WeakMap<EditDoc, WeakMap<Uint8Array, Map<string, { signature: string; reason: string }>>>();

export function migrateLocalChartData(doc: EditDoc, pending: readonly Patch[] = [],
  resolve?: ExtensionMigrationResolver): DocumentExtensionPatch[] {
  const candidates = new Map<string, string[]>();
  const arriving = new Set(pending.filter(patch => patch.path[0] === 'elements'
    && patch.path[2] === 'ovr' && patch.path[3] === 'extensions' && patch.path[4] === 'chart-data')
    .map(patch => patch.path[1]));
  for (const record of Object.values(doc.elements)) {
    if (record.ovr.extensions?.['chart-data'] === undefined && !arriving.has(record.id)) continue;
    if ((doc.extensions?.[EXTENSION_ADDRESSES] as Record<string, Record<string, unknown>> | undefined)
      ?.[record.id]?.['chart-data']) continue;
    const part = chartPartForElement(doc, record.id);
    if (!part) continue;
    const ids = candidates.get(part) ?? [];
    ids.push(record.id); candidates.set(part, ids);
  }
  const patches: DocumentExtensionPatch[] = [];
  for (const [part, ids] of candidates) {
    const source = sharedCacheSource(doc, part, true);
    if (!source) continue;
    const plan = prepareLocalChartMigration(doc, source, ids, resolve);
    // 先验证整组，防止前几个框架搬走后才发现最后一个框架存在无时钟可判定的冲突。
    try { patches.push(...plan()); }
    catch { continue; }
  }
  return patches;
}

function prepareLocalChartMigration(doc: EditDoc, source: ChartDatasetState, ids: readonly string[],
  resolve?: ExtensionMigrationResolver): () => readonly DocumentExtensionPatch[] {
  const part = source.binding.chartPart;
  const frames = Object.values(doc.elements).filter(record => chartPartForElement(doc, record.id) === part);
  const target = ['document', 'extensions', 'chart-shared', part, 'dataset'] as const;
  const existing = (doc.extensions?.['chart-shared'] as Record<string, { dataset?: unknown }> | undefined)?.[part];
  const installed = extensionAddressPatches(doc, 'chart-shared').map(patch =>
    readExtensionAddress(patch.op === 'set' ? patch.value : undefined))
    .find(address => JSON.stringify(address.target) === JSON.stringify(target));
  const native = sharedCacheIdentityMap(source);
  const identities = installed?.identities ?? Object.fromEntries(Object.keys(native).map(key => [key, key]));
  if (Object.keys(native).some(key => !identities[key])) throw new Error('扩展迁移目标的来源身份映射不完整');
  const scopeIds = sharedCacheScopeIds(doc, part, native, identities);
  const remap = (ids: Record<string, string>): ExtensionIdentityRemap => ({
    ids,
    prefix: installed ? installed.remap?.prefix ?? '' : 'n:',
    paths: [['categories', '*'], ['series', '*'], ['series', '*', 'points', '*']],
    values: [['categories', '*', 'id'], ['categories', '*', 'levelParent'], ['categories', '*', 'levelClears', '*'],
      ['series', '*', 'id'], ['series', '*', 'points', '*', 'id']],
  });
  return () => {
    const mappings = new Map<string, ExtensionIdentityRemap>();
    for (const record of frames) {
      const scope = scopeIds(record);
      mappings.set(record.id, remap(scope.ids));
      // 原件的旧地址仍可出现在撤销快照、恢复日志和迟到消息中。
      for (const removed of scope.removed) mappings.set(removed.id, remap(removed.ids));
    }
    const group: DocumentExtensionPatch[] = [];
    for (const [id, mapping] of mappings) {
      group.push({ op: 'set', origin: 'chart-shared',
        path: ['document', 'extensions', EXTENSION_ADDRESSES, id, 'chart-data'],
        value: JSON.stringify({ target, identities, remap: mapping, merge: 'equal' }) });
    }
    const resolved = resolve?.(doc, group);
    if (resolved) return resolved;
    let merged = existing?.dataset;
    for (const id of ids) merged = mergeExtensionValue(merged, doc.elements[id].ovr.extensions?.['chart-data'], mappings.get(id));
    return group.filter(patch => !(doc.extensions?.[EXTENSION_ADDRESSES] as Record<string, Record<string, unknown>> | undefined)
      ?.[patch.path[3]]?.['chart-data']);
  };
}

/** 查询复用迁移规划器的身份校验；不调用协同时钟裁决器，也不安装地址或改写文档。 */
export function localChartMigrationReason(doc: EditDoc, source: ChartDatasetState, ids: readonly string[]): string {
  const part = source.binding.chartPart, bytes = chartSourceBytes(doc, part)!;
  let sources = diagnostics.get(doc);
  if (!sources) diagnostics.set(doc, sources = new WeakMap());
  let entries = sources.get(bytes);
  if (!entries) sources.set(bytes, entries = new Map());
  const owners = new Set(ids);
  // 裸模型允许原地更新字段，容器引用不能证明未变；只保留值摘要，不持有旧框架或覆盖对象。
  const frames = [...Object.values(doc.elements), ...Object.values(doc.removedElements)]
    .filter(record => record.meta.editable === 'frame').map(record => {
      let parent = record.parent;
      while (doc.elements[parent]) parent = doc.elements[parent].parent;
      return [record.id, record.meta.origin, doc.slides[parent]?.creation?.duplicateSourcePart,
        owners.has(record.id) ? doc.elements[record.id]?.ovr.extensions?.['chart-data'] : undefined];
    });
  const signature = JSON.stringify([source, ids, frames, doc.retainedElementOrigins,
    doc.extensions?.[EXTENSION_ADDRESSES],
    (doc.extensions?.['chart-shared'] as Record<string, unknown> | undefined)?.[part]]);
  const known = entries.get(part);
  if (known?.signature === signature) return known.reason;
  let reason = '旧图表编辑缺少可验证的合并结果';
  try { prepareLocalChartMigration(doc, source, ids)(); }
  catch (error) { reason = error instanceof Error ? error.message : String(error); }
  entries.set(part, { signature, reason });
  return reason;
}
