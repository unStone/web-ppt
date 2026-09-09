import type { EditDoc, ElementId } from '../types';
import { chartPartForElement, chartFrameKey } from './locator';
import { chartSourceBytes } from './context';
import { nativeChartParts } from './part-graph';

interface ChartTopology extends ReturnType<typeof nativeChartParts> {
  readonly frames: ReadonlyMap<string, readonly ElementId[]>;
  readonly signature: string;
}
const snapshots = new WeakMap<EditDoc, WeakMap<EditDoc['elements'], WeakMap<object, {
  manifest?: Uint8Array; topology: ChartTopology;
}>>>();

/** 结构补丁替换记录集合，保存替换来源包；数据覆盖不改变原生消费者关系。 */
export function sharedChartTopology(doc: EditDoc): ChartTopology {
  let collections = snapshots.get(doc);
  if (!collections) snapshots.set(doc, collections = new WeakMap());
  let packages = collections.get(doc.elements);
  if (!packages) collections.set(doc.elements, packages = new WeakMap());
  // 被删除的记录目录与被替换的包都是弱键，停止图表查询也能回收旧树和资源。
  const source = doc.package ?? doc.saveState.baselines;
  const previous = packages.get(source), manifest = chartSourceBytes(doc, '[Content_Types].xml');
  if (previous && previous.manifest === manifest) return previous.topology;
  const graph = nativeChartParts(doc), frames = new Map<string, ElementId[]>(), identities = [];
  for (const record of Object.values(doc.elements)) {
    const part = chartPartForElement(doc, record.id);
    if (!part) continue;
    let ids = frames.get(part);
    if (!ids) frames.set(part, ids = []);
    ids.push(record.id); identities.push([record.id, chartFrameKey(doc, record.id), part]);
  }
  const topology = { ...graph, frames, signature: JSON.stringify([identities, graph.parts]) };
  packages.set(source, { manifest, topology });
  return topology;
}
