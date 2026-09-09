import type { ChartDatasetState } from './types';
import { sharedCacheCodec } from './shared-cache-codec';
import { validatePatchAgainstState } from './patch-validation';
import { assertChartDictionary } from './validation';
import { NATIVE_CHART_ID } from './source';

const NS = 'chart-shared';

export function decodeSharedDataset(source: ChartDatasetState, dataset: Record<string, unknown>,
  identities?: Readonly<Record<string, string>>): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null), codec = sharedCacheCodec(source, identities);
  let count = 0;
  const container = (path: string[]) => {
    const [root, , field] = path;
    const probe = path.length === 2 ? [root === 'categories' ? 'label' : 'name']
      : path.length === 3 && root === 'categories' && ['levels', 'levelClears'].includes(field) ? ['0']
        : path.length === 4 && root === 'series' && field === 'points' ? ['value']
          : path.length === 4 && root === 'series' && field === 'bindings' ? ['formula'] : undefined;
    if (probe) {
      validatePatchAgainstState(source, codec({ op: 'del', origin: NS,
        path: ['elements', NATIVE_CHART_ID, 'ovr', 'extensions', 'chart-data', ...path, ...probe] }, false), 0);
    } else if (!(path.length === 1 && ['categories', 'series'].includes(root)
      || path.length === 3 && root === 'series' && ['points', 'bindings'].includes(field))) {
      throw new Error('共享缓存字段容器无效');
    }
  };
  const visit = (node: Record<string, unknown>, tail: string[]) => {
    if (tail.length > 5) throw new Error('共享缓存覆盖层级过深');
    for (const [key, value] of Object.entries(node)) {
      if (++count > 100_000) throw new Error('共享缓存覆盖超过安全上限');
      const path = [...tail, key];
      if (value !== null && typeof value === 'object') {
        assertChartDictionary(value, '共享缓存字段'); container(path); visit(value, path); continue;
      }
      const patch = codec({ op: 'set', origin: NS,
        path: ['elements', NATIVE_CHART_ID, 'ovr', 'extensions', 'chart-data', ...path], value }, false);
      validatePatchAgainstState(source, patch, count);
      let target = result;
      for (const part of patch.path.slice(5, -1)) {
        target[part] ??= Object.create(null); target = target[part] as Record<string, unknown>;
      }
      target[patch.path[patch.path.length - 1]] = patch.op === 'set' ? patch.value : undefined;
    }
  };
  visit(dataset, []);
  return result;
}
