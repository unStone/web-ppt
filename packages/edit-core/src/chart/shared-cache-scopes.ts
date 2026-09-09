import { parseXmlTree } from '@web-ppt/edit-core/xml';
import type { EditDoc, ElementRecord } from '../types';
import { chartSourceBytes } from './context';
import { readChartIdentityManifest } from './identity';
import { NATIVE_CHART_ID } from './source';

/** 来源归属取自原生框架与复制出处；自定义新增 ID 即使同尾缀也不能被猜成来源记录。 */
export function sharedCacheScopeIds(doc: EditDoc, part: string, native: Readonly<Record<string, string>>,
  identities: Readonly<Record<string, string>>) {
  const manifest = readChartIdentityManifest(parseXmlTree(chartSourceBytes(doc, part)!).root);
  const prefixes = new Map(manifest?.scopes?.frames ?? []);
  const roots = new Map<string, string>();
  const retired = new Map<string, Array<{ id: string; part: string; spid: number; sourcePart?: string }>>();
  for (const [id, origin] of Object.entries(doc.retainedElementOrigins ?? {})) {
    roots.set(`${origin.part}#${origin.spid}`, id);
    const key = `${origin.sourcePart ?? origin.part}#${origin.spid}`;
    const group = retired.get(key) ?? [];
    group.push({ id, ...origin }); retired.set(key, group);
  }
  for (const record of [...Object.values(doc.elements), ...Object.values(doc.removedElements)]) {
    const origin = record.meta.origin;
    if (origin && record.meta.editable === 'frame') roots.set(`${origin.part}#${origin.spid}`, record.id);
  }
  const scoped = (id: string, origin: string) => {
    const prefix = prefixes.get(origin) ?? id;
    return Object.fromEntries(Object.entries(native).map(([key, value]) => [
      (!manifest || manifest.scopes) && value.startsWith(`${NATIVE_CHART_ID}:`)
        ? prefix + value.slice(NATIVE_CHART_ID.length) : value, identities[key]]));
  };
  const sourceScope = (sourcePart: string | undefined, spid: number) => {
    if (!sourcePart) return;
    const key = `${sourcePart}#${spid}`, owner = roots.get(key);
    // 缺少原记录及结构日志的旧裸模型无法证明出处，不能把旧来源误解为新增记录。
    if (!owner) throw new Error('复制图表的原页身份已不可定位');
    return { key, owner, ids: scoped(owner, key) };
  };
  return (record: ElementRecord) => {
    const origin = record.meta.origin!;
    const ids = scoped(record.id, `${origin.part}#${origin.spid}`);
    let parent = record.parent;
    while (doc.elements[parent]) parent = doc.elements[parent].parent;
    const source = sourceScope(doc.slides[parent]?.creation?.duplicateSourcePart, origin.spid);
    if (source) Object.assign(ids, source.ids);
    const local = record.ovr.extensions?.['chart-data'] as {
      categories?: Record<string, { id?: string }>;
      series?: Record<string, { id?: string; points?: Record<string, { id?: string }> }>;
    } | undefined;
    const introduced = [...Object.values(local?.categories ?? {}), ...Object.values(local?.series ?? {}),
      ...Object.values(local?.series ?? {}).flatMap(series => Object.values(series.points ?? {}))];
    // 新增身份来自显式记录声明；若撞上副本的来源身份，地址本身已无法无歧义解释两者。
    if (introduced.some(item => item.id !== undefined && Object.prototype.hasOwnProperty.call(ids, item.id))) {
      throw new Error('新增记录身份与复制来源身份冲突');
    }
    const sourceKey = source?.key ?? `${origin.part}#${origin.spid}`;
    const removed = (retired.get(sourceKey) ?? []).map(item => ({
      id: item.id, ids: { ...scoped(item.id, `${item.part}#${item.spid}`),
        ...sourceScope(item.sourcePart, item.spid)?.ids },
    }));
    if (source && !doc.elements[source.owner] && !removed.some(item => item.id === source.owner)) {
      removed.push({ id: source.owner, ids: source.ids });
    }
    // 每组只消费一次已删除框架，不能把 N 个旧副本重复展开进 N 个活副本的地址。
    retired.delete(sourceKey);
    return { ids, removed };
  };
}
