/**
 * 新建图表的保存计划：把 doc.chartResources 的部件按约定路径写出。
 *
 * 结构对齐嵌入字体的 fontEmbedSavePlan：created part 未出现在 changes 里会被
 * 保存计划当作回收删除，所以「已存在的部件仍要写回」；孤儿检测在 save/index
 * 侧按本计划的部件集合清理基线。图表部件与工作簿每次保存都从资源字节重写，
 * 幂等；现代图的回退经典图与图表关系（→内嵌工作簿）一并产出。
 */
import { base64ToBytes } from '../clipboard-binary';
import { relativeTarget } from '../clipboard-source';
import {
  parseXmlTree,
  serializeXmlTreeBytes,
  findXmlAttribute,
  insertXmlChild,
  removeXmlChild,
  xmlElementChildren,
} from '../xml';
import type { EditDoc } from '../types';
import type { ChartAuthoringResource } from '../types';
import { SEED_NS as NS, seedDocument, seedElement as element } from './seed-xml';

export interface ChartAuthoringSavePart {
  readonly part: string;
  readonly bytes: Uint8Array;
}

export interface ChartAuthoringSavePlan {
  readonly parts: readonly ChartAuthoringSavePart[];
  /** 内容类型 Override（part → mime）；xlsx 走 Default 由调用方登记 */
  readonly overrides: readonly { readonly part: string; readonly mime: string }[];
  /** 工作簿的 Default 扩展登记 */
  readonly hasWorkbook: boolean;
}

const CHART_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const CHARTEX_TYPE = 'application/vnd.ms-office.chartex+xml';
const WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 元素的插入关系是否引用该图表部件（owning 元素存活的唯一凭证） */
export function chartResourceReferenced(doc: EditDoc, part: string): boolean {
  for (const record of Object.values(doc.elements)) {
    const originPart = record.meta.origin?.part;
    if (!originPart) continue;
    const expected = relativeTarget(originPart, part);
    for (const relationship of record.meta.insertion?.relationships ?? []) {
      if (relationship.target === expected) return true;
    }
  }
  return false;
}

export function chartAuthoringSavePlan(doc: EditDoc): ChartAuthoringSavePlan {
  const resources = Object.values(doc.chartResources ?? {}).filter((resource) => chartResourceReferenced(doc, resource.part));
  if (!resources.length) return { parts: [], overrides: [], hasWorkbook: false };
  const parts: ChartAuthoringSavePart[] = [];
  const overrides: { part: string; mime: string }[] = [];
  let hasWorkbook = false;
  for (const resource of resources as readonly ChartAuthoringResource[]) {
    parts.push({ part: resource.part, bytes: base64ToBytes(resource.bytes) });
    overrides.push({ part: resource.part, mime: resource.mime });
    const relsPart = resource.part.replace('ppt/charts/', 'ppt/charts/_rels/') + '.rels';
    const workbookTarget = relativeTarget(resource.part, resource.workbook.part);
    const relationships = seedDocument('Relationships', { '': NS.relationships }, [
      element('Relationship', { Id: 'rIdWorkbook', Type: `${NS.office}/package`, Target: workbookTarget }),
    ]);
    parts.push({ part: relsPart, bytes: serializeXmlTreeBytes(relationships) });
    parts.push({ part: resource.workbook.part, bytes: base64ToBytes(resource.workbook.bytes) });
    hasWorkbook = true;
    if (resource.fallback) {
      parts.push({ part: resource.fallback.part, bytes: base64ToBytes(resource.fallback.bytes) });
      overrides.push({ part: resource.fallback.part, mime: CHART_TYPE });
      const fallbackRelsPart = resource.fallback.part.replace('ppt/charts/', 'ppt/charts/_rels/') + '.rels';
      parts.push({ part: fallbackRelsPart, bytes: serializeXmlTreeBytes(relationships) });
    }
  }
  return { parts, overrides, hasWorkbook };
}

export const CHART_AUTHORING_CONTENT_TYPES = { CHART_TYPE, CHARTEX_TYPE, WORKBOOK_TYPE } as const;

/** 内容类型登记：图表部件 Override + 工作簿 xlsx Default；已存在的条目原样保留。 */
export function patchChartContentTypes(source: Uint8Array, plan: ChartAuthoringSavePlan): Uint8Array {
  if (!plan.parts.length) return source;
  const tree = parseXmlTree(source);
  const defaults = xmlElementChildren(tree.root, { localName: 'Default', namespaceUri: NS.types });
  const overrides = xmlElementChildren(tree.root, { localName: 'Override', namespaceUri: NS.types });
  const attribute = (node: ReturnType<typeof xmlElementChildren>[number], name: string) =>
    findXmlAttribute(node, { localName: name, namespaceUri: null })?.value;
  if (plan.hasWorkbook && !defaults.some((node) => attribute(node, 'Extension')?.toLowerCase() === 'xlsx')) {
    insertXmlChild(tree.root, element('Default', { Extension: 'xlsx', ContentType: WORKBOOK_TYPE }), overrides[0] ?? null);
  }
  for (const override of plan.overrides) {
    const partName = `/${override.part}`;
    if (overrides.some((node) => attribute(node, 'PartName') === partName)) continue;
    insertXmlChild(tree.root, element('Override', { PartName: partName, ContentType: override.mime }), null);
  }
  return serializeXmlTreeBytes(tree);
}

/** 孤儿图表部件的内容类型 Override 剪除；工作簿 Default 留着无害。 */
export function pruneChartContentTypes(source: Uint8Array, orphanParts: readonly string[]): Uint8Array {
  const tree = parseXmlTree(source);
  const orphans = new Set(orphanParts.map((part) => `/${part}`));
  for (const node of xmlElementChildren(tree.root, { localName: 'Override', namespaceUri: NS.types })) {
    const partName = findXmlAttribute(node, { localName: 'PartName', namespaceUri: null })?.value;
    if (partName && orphans.has(partName)) removeXmlChild(tree.root, node);
  }
  return serializeXmlTreeBytes(tree);
}
