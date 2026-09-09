import type { ChartDatasetState } from './types';
import type { ExtensionPatch } from '../commands/types';
import { assertChartIdentity } from './validation';

/** 来源身份用原生序号寻址；新增身份保留创建者分配的唯一 ID，不依赖任何框架的生命周期。 */
export function sharedCacheIdentityMap(source: ChartDatasetState): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  Object.keys(source.categories).forEach((id, index) => { result[`c${index}`] = id; });
  Object.values(source.series).forEach((series, index) => {
    result[`s${index}`] = series.id;
    if (series.plotKind === 'scatter' || series.plotKind === 'bubble') {
      Object.keys(series.points).forEach((id, point) => { result[`p${index}_${point}`] = id; });
    }
  });
  return result;
}

export function sharedCacheCodec(source: ChartDatasetState, identities?: Readonly<Record<string, string>>) {
  const encoded = new Map<string, string>(), decoded = new Map<string, string>();
  const add = (id: string, key: string) => { encoded.set(id, key); decoded.set(key, id); };
  for (const [key, id] of Object.entries(sharedCacheIdentityMap(source))) {
    const stored = identities ? identities[key] : key;
    if (!stored || decoded.has(stored)) throw new Error('共享缓存来源身份映射不完整或重复');
    add(id, stored);
  }
  const identity = (id: unknown, encode: boolean): string => {
    if (typeof id !== 'string') throw new Error('共享缓存身份无效');
    if (encode) return encoded.get(id) ?? (identities ? id : `n:${id}`);
    const original = decoded.get(id);
    if (original) return original;
    if (!identities && !id.startsWith('n:')) throw new Error('共享缓存来源身份无效');
    const added = identities ? id : id.slice(2);
    if (!added) throw new Error('共享缓存新增身份不能为空');
    assertChartIdentity(added, added, '共享缓存新增记录');
    if (encoded.has(added)) throw new Error('共享缓存新增身份与来源记录冲突');
    return added;
  };
  return (patch: ExtensionPatch, encode: boolean): ExtensionPatch => {
    const tail = [...patch.path.slice(5)];
    if (tail.length > 1) tail[1] = identity(tail[1], encode);
    if (tail[2] === 'points' && tail.length > 3) tail[3] = identity(tail[3], encode);
    const value = patch.op === 'set' ? patch.value : undefined;
    const leaf = tail[tail.length - 1];
    const mapped = patch.op === 'set' && value !== null && (leaf === 'id'
      || leaf === 'levelParent' || tail[0] === 'categories' && tail[2] === 'levelClears')
      ? identity(value, encode) : value;
    const path: ExtensionPatch['path'] = ['elements', patch.path[1], 'ovr', 'extensions', 'chart-data', ...tail];
    return patch.op === 'set' ? { ...patch, path, value: mapped } : { ...patch, path };
  };
}
