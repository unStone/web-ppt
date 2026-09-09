import type { ChartDatasetState } from './types';
import type { SharedGroup } from './shared-graph';
import type { CommandPatches, DocumentExtensionPatch, ExtensionPatch } from '../commands/types';
import { assertChartDictionary } from './validation';
import { decodeSharedDataset } from './shared-records';
import { sharedCacheCodec } from './shared-cache-codec';
import { validatePatchAgainstState } from './patch-validation';

export type AddedSeries = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export function addedSeriesCommand(source: ChartDatasetState, workbook: string, local: CommandPatches): CommandPatches | undefined {
  if (!local.forward.length || !local.forward.every(patch => patch.path[5] === 'series'
    && !Object.prototype.hasOwnProperty.call(source.series, String(patch.path[6])))) return;
  const codec = sharedCacheCodec(source);
  const map = (patch: CommandPatches['forward'][number]): DocumentExtensionPatch => {
    const converted = codec(patch as ExtensionPatch, true);
    const path: DocumentExtensionPatch['path'] = ['document', 'extensions', 'chart-shared', workbook,
      'addedSeries', source.binding.chartPart, ...converted.path.slice(6)];
    return converted.op === 'set' ? { ...converted, path } : { ...converted, path };
  };
  return { forward: local.forward.map(map), inverse: local.inverse.map(map) };
}

export function decodeAddedSeries(state: ChartDatasetState, added: AddedSeries | undefined) {
  const records = added?.[state.binding.chartPart];
  if (!records) return undefined;
  assertChartDictionary(records, '共享新增系列');
  if (Object.keys(records).some(key => !key.startsWith('n:'))) throw new Error('共享新增系列不能覆盖来源身份');
  return decodeSharedDataset(state, { series: records });
}

export function validateAddedSeries(shared: SharedGroup, added: unknown): void {
  assertChartDictionary(added, '共享新增系列部件');
  for (const part of Object.keys(added)) {
    const owners = shared.charts.filter(chart => chart.state.binding.chartPart === part);
    if (!owners.length) throw new Error('共享新增系列不属于此工作簿');
    for (const owner of owners) decodeAddedSeries(owner.state, added as AddedSeries);
  }
}

export function validateAddedSeriesPatch(shared: SharedGroup, patch: DocumentExtensionPatch): void {
  const owners = shared.charts.filter(chart => chart.state.binding.chartPart === patch.path[5]);
  if (patch.path.length < 8 || !owners.length || !patch.path[6].startsWith('n:')) {
    throw new Error('共享新增系列路径或身份无效');
  }
  for (const { state } of owners) {
    const path: ExtensionPatch['path'] = ['elements', 'shared-native', 'ovr', 'extensions', 'chart-data',
      'series', ...patch.path.slice(6)];
    validatePatchAgainstState(state, sharedCacheCodec(state)(patch.op === 'set' ? { ...patch, path } : { ...patch, path }, false), 0);
  }
}
