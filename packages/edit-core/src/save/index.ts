import { commitSavedPackage } from '../document';
import { validateEditDoc } from '../model-invariants';
import { patchOpcPackage } from '../opc/patch';
import type { OpcPatchResult, OpcPartChanges } from '../opc/types';
import type { EditDoc, ElementRecord, RemovedElementRecord } from '../types';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import { hasXfrmOverrides, patchElementXfrm } from './xfrm';
import { patchRemovedElement } from './remove-element';
import { hasTextOverrides, patchElementText } from './text';

function recordsByPart(doc: EditDoc): Map<string, ElementRecord[]> {
  const grouped = new Map<string, ElementRecord[]>();
  for (const record of Object.values(doc.elements)) {
    if (!hasXfrmOverrides(record) && !hasTextOverrides(record)) continue;
    const origin = record.meta.origin;
    if (!origin) throw new Error(`元素 ${record.id} 缺少 OOXML 回写锚点`);
    const records = grouped.get(origin.part) ?? [];
    records.push(record);
    grouped.set(origin.part, records);
  }
  return grouped;
}

function removalsByPart(doc: EditDoc): Map<string, RemovedElementRecord[]> {
  const grouped = new Map<string, RemovedElementRecord[]>();
  for (const record of Object.values(doc.removedElements)) {
    const origin = record.meta.origin;
    // 会话中新建又删除的节点没有源宿主；生成保存只需忽略它，不应伪造删除。
    if (!origin) continue;
    const records = grouped.get(origin.part) ?? [];
    records.push(record);
    grouped.set(origin.part, records);
  }
  return grouped;
}

/** 始终从首次触碰的基线重建 part，避免连续保存把旧覆盖烘进源树而破坏撤销。 */
export function saveEditDoc(doc: EditDoc): OpcPatchResult {
  validateEditDoc(doc);
  if (doc.meta.readonly) throw new Error('只读编辑文档不能保存');
  if (doc.meta.source !== 'pptx' || !doc.package) {
    throw new Error('当前版本尚未实现生成式 PPTX 保存');
  }

  const grouped = recordsByPart(doc);
  const removals = removalsByPart(doc);
  const nextBaselines: Record<string, Uint8Array> = Object.assign(
    Object.create(null), doc.saveState.baselines,
  );
  for (const part of new Set([...grouped.keys(), ...removals.keys()])) {
    if (nextBaselines[part]) continue;
    const source = doc.package.parts[part];
    if (!source) throw new Error(`找不到待写回的 OPC part：${part}`);
    nextBaselines[part] = source.slice();
  }

  const changes: Record<string, Uint8Array> = Object.create(null);
  for (const [part, source] of Object.entries(nextBaselines)) {
    const tree = parseXmlTree(source);
    for (const record of removals.get(part) ?? []) patchRemovedElement(tree, record);
    const records = grouped.get(part) ?? [];
    for (const record of records) {
      patchElementXfrm(tree, record);
      patchElementText(tree, record);
    }
    changes[part] = serializeXmlTreeBytes(tree);
  }

  const result = patchOpcPackage(doc.package, changes satisfies OpcPartChanges);
  commitSavedPackage(doc, result.package, nextBaselines);
  return result;
}

export type { OpcFallbackReason, OpcPatchResult, OpcSaveMode } from '../opc/types';
