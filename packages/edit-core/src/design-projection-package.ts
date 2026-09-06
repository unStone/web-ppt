import { inheritPptxParsingContext, type OpcPackage } from '@web-ppt/core';
import type { EditDoc, ElementRecord } from './types';
import { parseXmlTree, serializeXmlTreeBytes } from './xml/tree';
import { materializeElementTreeState } from './save/insertion';
import { patchMasterProperties } from './save/master-properties';
import { masterHasElementEdits } from './master-state';
import { themeProjectionPackage } from './theme-projection';

interface DesignProjectionCache {
  readonly source: OpcPackage;
  readonly package: OpcPackage;
}

const caches = new WeakMap<EditDoc, DesignProjectionCache>();
const masterSourceCaches = new WeakMap<EditDoc, DesignProjectionCache>();

function masterRecords(doc: EditDoc, masterId: string): ElementRecord[] {
  const records: ElementRecord[] = [];
  const visit = (id: string): void => {
    const record = doc.elements[id];
    if (!record) return;
    records.push(record);
    for (const child of record.children ?? []) visit(child);
  };
  for (const id of doc.masters[masterId]?.children ?? []) visit(id);
  return records;
}

/** 母版元素的来源只含主题与母版属性；元素覆盖必须留到 effectiveElement 统一应用一次。 */
export function masterSourceProjectionPackage(doc: EditDoc): OpcPackage | null {
  const source = themeProjectionPackage(doc);
  if (!source) return null;
  const cached = masterSourceCaches.get(doc);
  if (cached?.source === source) return cached.package;
  let parts: Record<string, Uint8Array> | null = null;
  for (const id of doc.masterOrder) {
    if (!Reflect.ownKeys(doc.masters[id].ovr).length) continue;
    const sourceBytes = source.parts[id];
    if (!sourceBytes) throw new Error(`母版 part 不存在：${id}`);
    const tree = parseXmlTree(sourceBytes);
    patchMasterProperties(tree, doc.masters[id]);
    (parts ??= { ...source.parts })[id] = serializeXmlTreeBytes(tree);
  }
  if (!parts) return source;
  const overlay = inheritPptxParsingContext(source, {
    format: 'pptx', bytes: source.bytes, parts,
    ...(source.assets ? { assets: source.assets } : {}),
    disposed: source.disposed,
  });
  masterSourceCaches.set(doc, { source, package: overlay });
  return overlay;
}

/**
 * 母版元素覆盖物化到页面/版式重解析专用 OPC 视图；来源查询改走上面的属性视图，
 * 因而页面能看到完整设计改动，母版元素自身又不会重复叠加同一份覆盖。
 */
export function designProjectionPackage(doc: EditDoc): OpcPackage | null {
  const source = masterSourceProjectionPackage(doc);
  if (!source) return null;
  const cached = caches.get(doc);
  if (cached?.source === source) return cached.package;
  let parts: Record<string, Uint8Array> | null = null;
  for (const id of doc.masterOrder) {
    if (!masterHasElementEdits(doc, id)) continue;
    const sourceBytes = source.parts[id];
    if (!sourceBytes) throw new Error(`母版 part 不存在：${id}`);
    const tree = parseXmlTree(sourceBytes);
    materializeElementTreeState(
      tree, doc, id, masterRecords(doc, id),
      Object.values(doc.removedElements).filter((record) => record.meta.origin?.part === id),
    );
    (parts ??= { ...source.parts })[id] = serializeXmlTreeBytes(tree);
  }
  if (!parts) return source;
  const overlay = inheritPptxParsingContext(source, {
    format: 'pptx', bytes: source.bytes, parts,
    ...(source.assets ? { assets: source.assets } : {}),
    disposed: source.disposed,
  });
  caches.set(doc, { source, package: overlay });
  return overlay;
}

export function releaseDesignProjectionPackage(doc: EditDoc): void {
  caches.delete(doc);
  masterSourceCaches.delete(doc);
}
