import type { EditDoc, ElementId } from '../types';
import type { ChartDatasetState } from './types';
import { parseXmlTree } from '@web-ppt/edit-core/xml';
import { chartRelationships, chartSourceBytes, chartRelationshipPart } from './context';
import { hydrateChartDataset, hydrateChartPart } from './source';
import { sharedCellFields } from './shared-fields';
import type { SharedCellField } from './shared-fields';
import { sharedChartTopology as nativeChartParts } from './shared-topology';
export { sharedChartTopology as nativeChartParts } from './shared-topology';
import { readChartIdentityManifest } from './identity';

export interface SharedGroup {
  readonly workbook: string;
  readonly reason?: string;
  readonly charts: readonly { id: ElementId; native?: true; state: ChartDatasetState; fields: readonly SharedCellField[] }[];
}

const scopes = new WeakMap<Uint8Array, boolean>();
export function hasSharedChartScopes(bytes: Uint8Array): boolean {
  let marked = scopes.get(bytes);
  if (marked === undefined) {
    try { marked = !!readChartIdentityManifest(parseXmlTree(bytes).root)?.scopes; } catch { marked = false; }
    scopes.set(bytes, marked);
  }
  return marked;
}


interface GraphSnapshot {
  readonly signature: string;
  readonly hasResource: boolean;
  readonly dependencies: readonly (Uint8Array | undefined)[];
  readonly group: SharedGroup | undefined;
}
const graphs = new WeakMap<Uint8Array, Map<string, GraphSnapshot>>();

export function sharedWorkbookParts(doc: EditDoc): string[] {
  const graph = nativeChartParts(doc);
  const workbooks = new Set(Object.keys(doc.extensions?.['chart-shared'] ?? {}).filter(part => !graph.charts.has(part)));
  for (const part of graph.charts) for (const relation of Object.values(chartRelationships(doc, part))) {
    if (!relation.external && relation.type.endsWith('/package')) workbooks.add(relation.target);
  }
  return [...workbooks];
}

/** 所有权来自 OPC 部件图；没有当前框架的图表仍然是工作簿的原生消费者。 */
export function sharedGroupForWorkbook(doc: EditDoc, workbook: string): SharedGroup | undefined {
  const graph = nativeChartParts(doc), manifest = chartSourceBytes(doc, '[Content_Types].xml');
  if (!manifest) return buildSharedGroup(doc, workbook, graph);
  let entries = graphs.get(manifest);
  if (!entries) { entries = new Map(); graphs.set(manifest, entries); }
  const signature = graph.signature;
  const hasResource = Object.prototype.hasOwnProperty.call(doc.extensions?.['chart-shared'] ?? {}, workbook);
  const dependencies = [chartSourceBytes(doc, workbook), ...graph.parts.flatMap(part =>
    [chartSourceBytes(doc, part), chartSourceBytes(doc, chartRelationshipPart(part)), doc.package?.parts[part]])];
  const cached = entries.get(workbook);
  if (cached?.signature === signature && cached.hasResource === hasResource && dependencies.length === cached.dependencies.length
    && dependencies.every((bytes, index) => bytes === cached.dependencies[index])) return cached.group;
  const group = buildSharedGroup(doc, workbook, graph);
  entries.set(workbook, { signature, hasResource, dependencies, group });
  return group;
}

function buildSharedGroup(doc: EditDoc, workbook: string, graph: ReturnType<typeof nativeChartParts>): SharedGroup | undefined {
  const charts: SharedGroup['charts'][number][] = [], referenced = new Set<string>();
  const dependency = (part: string, id?: ElementId): ChartDatasetState => {
    try { return id ? hydrateChartDataset(doc, id, true) : hydrateChartPart(doc, part); }
    catch (error) {
      return { kind: 'category', categories: {}, series: {}, binding: { chartPart: part, workbookPart: workbook,
        mode: 'readonly', reason: `无法读取共享图表部件 ${part}：${error instanceof Error ? error.message : String(error)}` } };
    }
  };
  for (const part of graph.charts) if (Object.values(chartRelationships(doc, part)).some(relation => !relation.external && relation.target === workbook)) referenced.add(part);
  for (const part of referenced) for (const id of graph.frames.get(part) ?? []) {
    const state = dependency(part, id);
    charts.push({ id, state, fields: sharedCellFields(state) });
  }
  for (const part of referenced) if (!charts.some(chart => chart.state.binding.chartPart === part)) {
    const state = dependency(part);
    charts.push({ id: part, native: true, state, fields: sharedCellFields(state) });
  }
  const unknown = graph.parts.find(part => !graph.charts.has(part)
    && Object.values(chartRelationships(doc, part)).some(relation => !relation.external && relation.target === workbook));
  const marked = [...referenced].some(part => {
    const current = doc.package?.parts[part];
    return current && hasSharedChartScopes(current);
  });
  const resource = (doc.extensions?.['chart-shared'] as Record<string, unknown> | undefined)?.[workbook];
  if (!charts.length || charts.length < 2 && !resource && !unknown && !marked) return undefined;
  charts.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { workbook, charts, ...(unknown ? { reason: `共享工作簿还被未支持的部件 ${unknown} 引用` } : {}) };
}

export function sharedGroupForFrame(doc: EditDoc, id: ElementId): SharedGroup | undefined {
  const workbook = hydrateChartDataset(doc, id, true).binding.workbookPart;
  return workbook ? sharedGroupForWorkbook(doc, workbook) : undefined;
}
