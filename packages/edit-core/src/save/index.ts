import { commitSavedPackage } from '../document';
import { validateEditDoc } from '../model-invariants';
import { patchOpcPackage } from '../opc/patch';
import type { OpcPatchResult, OpcPartChanges } from '../opc/types';
import type { EditDoc, ElementRecord } from '../types';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import { hasXfrmOverrides, patchElementXfrm } from './xfrm';

function recordsByPart(doc: EditDoc): Map<string, ElementRecord[]> {
  const grouped = new Map<string, ElementRecord[]>();
  for (const record of Object.values(doc.elements)) {
    if (!hasXfrmOverrides(record)) continue;
    const origin = record.meta.origin;
    if (!origin) throw new Error(`元素 ${record.id} 缺少 OOXML 回写锚点`);
    const records = grouped.get(origin.part) ?? [];
    records.push(record);
    grouped.set(origin.part, records);
  }
  return grouped;
}

/** 保存现有 pptx；当前里程碑只落元素变换，生成式保存由后续命令集启用。 */
export function saveEditDoc(doc: EditDoc): OpcPatchResult {
  validateEditDoc(doc);
  if (doc.meta.readonly) throw new Error('只读编辑文档不能保存');
  if (doc.meta.source !== 'pptx' || !doc.package) {
    throw new Error('当前版本尚未实现生成式 PPTX 保存');
  }

  const grouped = recordsByPart(doc);
  const nextBaselines: Record<string, Uint8Array> = Object.assign(
    Object.create(null), doc.saveState.baselines,
  );
  for (const part of grouped.keys()) {
    if (nextBaselines[part]) continue;
    const source = doc.package.parts[part];
    if (!source) throw new Error(`找不到待写回的 OPC part：${part}`);
    nextBaselines[part] = source.slice();
  }

  const changes: Record<string, Uint8Array> = Object.create(null);
  for (const [part, source] of Object.entries(nextBaselines)) {
    const tree = parseXmlTree(source);
    const records = grouped.get(part) ?? [];
    for (const record of records) patchElementXfrm(tree, record);
    changes[part] = serializeXmlTreeBytes(tree);
  }

  const result = patchOpcPackage(doc.package, changes satisfies OpcPartChanges);
  commitSavedPackage(doc, result.package, nextBaselines);
  return result;
}

export type { OpcFallbackReason, OpcPatchResult, OpcSaveMode } from '../opc/types';
